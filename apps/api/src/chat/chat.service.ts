import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BlockBuilder, blocksToText, isWorkflowAgentId, type ContentBlock, type Message, type StreamEvent, type Thread } from '@cowork/shared';
import type { AuthContext } from '../auth/auth.types';
import { SettingsService } from '../auth/settings.service';
import { ChartService } from '../charts/chart.service';
import { newId, nowIso } from '../common/ids';
import { QueueService } from '../common/queue.service';
import { CortexService } from '../cortex/cortex.service';
import { LlmService } from '../llm/llm.service';
import { MemoryService } from '../memory/memory.service';
import { DocStore } from '../store/doc-store';
import { WorkflowsService } from '../workflows/workflows.service';

export interface StreamRequest {
  threadId?: string;
  agentId: string;
  text: string;
}

const MEMORY_WAIT_MS = 10_000;

function heuristicTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New chat';
}

@Injectable()
export class ChatService implements OnModuleInit {
  private readonly log = new Logger(ChatService.name);

  constructor(
    private readonly store: DocStore,
    private readonly cortex: CortexService,
    private readonly charts: ChartService,
    private readonly memory: MemoryService,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly queue: QueueService,
    private readonly workflows: WorkflowsService,
  ) {}

  onModuleInit() {
    this.queue.register('thread.title', (job) => this.generateTitle(job));
  }

  // ---- threads ----

  async listThreads(userId: string, search?: string): Promise<Thread[]> {
    const threads = await this.store.list<Thread>('THREADS', { userId, limit: 300 });
    const s = search?.toLowerCase().trim();
    return threads
      .filter((t) => !s || t.title.toLowerCase().includes(s))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }

  async getThread(userId: string, id: string): Promise<Thread> {
    const t = await this.store.get<Thread>('THREADS', id);
    if (!t || t.userId !== userId) throw new NotFoundException('Thread not found');
    return t;
  }

  async getThreadWithMessages(userId: string, id: string) {
    const thread = await this.getThread(userId, id);
    const messages = await this.store.list<Message & { userId: string; updatedAt: string }>('MESSAGES', {
      parentId: id,
      order: 'asc',
      limit: 1000,
    });
    return { thread, messages };
  }

  async updateThread(userId: string, id: string, patch: { title?: string; pinned?: boolean }) {
    await this.getThread(userId, id);
    return this.store.patch<Thread>('THREADS', id, {
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 120) } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    });
  }

  async deleteThread(userId: string, id: string) {
    await this.getThread(userId, id);
    await this.store.deleteByParent('MESSAGES', id);
    await this.store.delete('THREADS', id);
  }

  async feedback(userId: string, messageId: string, feedback: 'up' | 'down' | null, note?: string) {
    const m = await this.store.get<Message & { userId: string; updatedAt: string }>('MESSAGES', messageId);
    if (!m || m.userId !== userId) throw new NotFoundException();
    return this.store.patch<Message & { userId: string; updatedAt: string }>('MESSAGES', messageId, { feedback, feedbackNote: note });
  }

  // ---- streaming turn ----

  async streamTurn(auth: AuthContext, body: StreamRequest, req: Request, res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    const send = (ev: StreamEvent) => {
      if (!res.writableEnded) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    };
    const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

    const userId = auth.user.id;
    const builder = new BlockBuilder();
    let thread: Thread | undefined;
    try {
      const settings = await this.settings.get(userId);
      const isNew = !body.threadId;
      thread = isNew ? await this.createThread(auth, body) : await this.getThread(userId, body.threadId!);
      send({ type: 'thread', threadId: thread.id, title: thread.title });

      const prior = isNew ? [] : await this.history(thread.id);
      const now = nowIso();
      await this.store.insert(
        'MESSAGES',
        { id: newId('msg'), userId, threadId: thread.id, role: 'user', content: [{ type: 'text', text: body.text }], createdAt: now, updatedAt: now },
        thread.id,
      );

      const isWorkflow = isWorkflowAgentId(thread.agentId);
      if (isWorkflow) {
        // Workflows compose agents; each node runs statelessly with the templated input.
        const relay = (ev: StreamEvent) => {
          builder.add(ev);
          send(ev);
        };
        await this.workflows.runForChat(auth, thread.agentId, body.text, relay, abort.signal, settings.autoChart);
      } else {
        const memories = settings.memoryEnabled ? await this.memory.retrieve(userId, body.text, auth.cred) : [];
        const agentText = this.memory.formatContext(memories) + body.text;

        for await (const ev of this.cortex.run(auth.cred, {
          agentId: thread.agentId,
          text: agentText,
          threadId: thread.cortexThreadId,
          parentMessageId: thread.lastCortexMessageId ?? 0,
          history: prior,
          signal: abort.signal,
        })) {
          builder.add(ev);
          send(ev);
        }
      }

      // The chart fix: if Cortex returned a table but no chart, synthesize one.
      if (settings.autoChart && !isWorkflow) {
        for (const t of builder.tablesWithoutCharts()) {
          const spec = await this.charts.fallback(t.table, body.text, auth.cred);
          if (!spec) continue;
          const ev: StreamEvent = { type: 'chart', index: 10_000 + builder.blocks.length, toolUseId: t.toolUseId, spec, generated: true };
          builder.add(ev);
          send(ev);
        }
      }

      const messageId = await this.saveAssistant(userId, thread, builder.finalize());
      await this.store.patch<Thread>('THREADS', thread.id, {
        ...(builder.assistantMessageId !== undefined ? { lastCortexMessageId: builder.assistantMessageId } : {}),
      });
      send({ type: 'done', messageId });

      if (isNew) await this.queue.enqueue('thread.title', { threadId: thread.id, text: body.text, cred: auth.cred });
      if (settings.memoryEnabled && !isWorkflow) {
        const saved = await Promise.race([
          this.memory.extract({ userId, threadId: thread.id, userText: body.text, assistantText: blocksToText(builder.blocks), cred: auth.cred }),
          new Promise<string[]>((r) => setTimeout(() => r([]), MEMORY_WAIT_MS)),
        ]).catch(() => []);
        if (saved.length) send({ type: 'memory', saved });
      }
    } catch (e) {
      const err = e as Error;
      if (abort.signal.aborted) {
        this.log.log('client cancelled stream');
        builder.add({ type: 'error', message: 'Stopped by user' });
      } else {
        this.log.error(err.stack ?? err.message);
        builder.add({ type: 'error', message: err.message });
        send({ type: 'error', message: err.message });
      }
      if (thread && builder.blocks.length) await this.saveAssistant(userId, thread, builder.finalize()).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  private async createThread(auth: AuthContext, body: StreamRequest): Promise<Thread> {
    const now = nowIso();
    const thread: Thread = {
      id: newId('thr'),
      userId: auth.user.id,
      title: heuristicTitle(body.text),
      agentId: body.agentId,
      cortexThreadId: isWorkflowAgentId(body.agentId) ? undefined : await this.cortex.createThread(auth.cred),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert('THREADS', thread);
  }

  /** Text-only history, used when Cortex threads aren't available. */
  private async history(threadId: string) {
    const msgs = await this.store.list<Message & { userId: string; updatedAt: string }>('MESSAGES', {
      parentId: threadId,
      order: 'asc',
      limit: 1000,
    });
    return msgs.slice(-12).map((m) => ({ role: m.role, text: blocksToText(m.content) || '(no text)' }));
  }

  private async saveAssistant(userId: string, thread: Thread, content: ContentBlock[]): Promise<string> {
    const now = nowIso();
    const id = newId('msg');
    await this.store.insert('MESSAGES', { id, userId, threadId: thread.id, role: 'assistant', content, createdAt: now, updatedAt: now }, thread.id);
    await this.store.patch<Thread>('THREADS', thread.id, {});
    return id;
  }

  private async generateTitle(job: { threadId: string; text: string; cred?: AuthContext['cred'] }) {
    const title = await this.llm.complete(
      `Write a 3-6 word title for a conversation that starts with: "${job.text.slice(0, 500)}". Reply with the title only, no quotes.`,
      job.cred,
    );
    const clean = title?.trim().replace(/^["']|["']$/g, '').slice(0, 80);
    if (clean) await this.store.patch<Thread>('THREADS', job.threadId, { title: clean });
  }
}
