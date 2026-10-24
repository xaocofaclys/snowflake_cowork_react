import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import {
  DEFAULT_MAX_STEPS,
  validateGraph,
  WORKFLOW_ID_PREFIX,
  type AgentInfo,
  type StreamEvent,
  type Workflow,
  type WorkflowGraph,
} from '@cowork/shared';
import type { AuthContext } from '../auth/auth.types';
import { PermissionsService } from '../auth/permissions.service';
import { newId, nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';
import { WorkflowExecutor } from './workflow-executor';

export type WorkflowInput = Pick<Workflow, 'name' | 'description' | 'graph' | 'published' | 'maxSteps'>;

/** Workflow CRUD + runs. Building (create/edit/publish/test-run) is gated by PermissionsService. */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly store: DocStore,
    private readonly permissions: PermissionsService,
    private readonly executor: WorkflowExecutor,
  ) {}

  private async assertBuilder(a: AuthContext) {
    if (!(await this.permissions.forUser(a.user)).buildWorkflows) {
      throw new ForbiddenException('Your role is not allowed to build workflows');
    }
  }

  /** Published workflows from everyone plus your own drafts. */
  async list(a: AuthContext): Promise<Workflow[]> {
    const all = await this.store.list<Workflow>('WORKFLOWS', { limit: 1000 });
    return all.filter((w) => w.published || w.userId === a.user.id).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  }

  async get(a: AuthContext, id: string): Promise<Workflow> {
    const w = await this.store.get<Workflow>('WORKFLOWS', id);
    if (!w || (!w.published && w.userId !== a.user.id)) throw new NotFoundException('Workflow not found');
    return w;
  }

  async create(a: AuthContext, b: Partial<WorkflowInput>): Promise<Workflow> {
    await this.assertBuilder(a);
    const now = nowIso();
    const w: Workflow = {
      id: newId('wf'),
      userId: a.user.id,
      ownerName: a.user.name,
      name: (b.name ?? 'Untitled workflow').slice(0, 120),
      description: b.description,
      graph: b.graph ?? { nodes: [], edges: [] },
      published: false,
      maxSteps: this.clampSteps(b.maxSteps),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert('WORKFLOWS', w);
  }

  async update(a: AuthContext, id: string, b: Partial<WorkflowInput>): Promise<Workflow> {
    await this.assertBuilder(a);
    const w = await this.owned(a, id);
    const graph = b.graph ?? w.graph;
    const published = b.published ?? w.published;
    if (published) {
      const problems = validateGraph(graph);
      if (problems.length) throw new BadRequestException(`Fix before publishing: ${problems.join(' ')}`);
    }
    return (await this.store.patch<Workflow>('WORKFLOWS', id, {
      ...(b.name !== undefined ? { name: b.name.slice(0, 120) } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.maxSteps !== undefined ? { maxSteps: this.clampSteps(b.maxSteps) } : {}),
      graph,
      published,
      version: w.version + 1,
    }))!;
  }

  async remove(a: AuthContext, id: string) {
    await this.assertBuilder(a);
    await this.owned(a, id);
    await this.store.delete('WORKFLOWS', id);
  }

  /** Published workflows shown in the chat agent picker. */
  async asAgents(a: AuthContext): Promise<AgentInfo[]> {
    return (await this.list(a))
      .filter((w) => w.published)
      .map((w) => ({
        id: `${WORKFLOW_ID_PREFIX}${w.id}`,
        database: '',
        schema: '',
        name: w.name,
        displayName: w.name,
        description: w.description,
        sampleQuestions: [],
        kind: 'workflow' as const,
        owner: w.ownerName,
      }));
  }

  /** Test-runs a (possibly unsaved) graph and streams events as SSE. */
  async streamDraft(a: AuthContext, body: { graph: WorkflowGraph; input: string; maxSteps?: number }, res: Response) {
    await this.assertBuilder(a);
    const problems = validateGraph(body.graph);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => !res.writableFinished && abort.abort());
    const send = (ev: StreamEvent) => !res.writableEnded && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);
    try {
      const output = await this.executor.run(body.graph, {
        cred: a.cred,
        input: body.input,
        maxSteps: this.clampSteps(body.maxSteps),
        emit: send,
        signal: abort.signal,
      });
      send({ type: 'text', index: 0, text: output });
      send({ type: 'done', messageId: '' });
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  /** Used by chat when the selected "agent" is a workflow. */
  async runForChat(a: AuthContext, workflowId: string, input: string, emit: (ev: StreamEvent) => void, signal: AbortSignal, autoChart: boolean) {
    const w = await this.get(a, workflowId.slice(WORKFLOW_ID_PREFIX.length));
    if (!w.published && w.userId !== a.user.id) throw new ForbiddenException();
    const output = await this.executor.run(w.graph, { cred: a.cred, input, maxSteps: w.maxSteps, emit, signal, autoChart });
    emit({ type: 'text', index: 0, text: output });
  }

  private async owned(a: AuthContext, id: string) {
    const w = await this.store.get<Workflow>('WORKFLOWS', id);
    if (!w) throw new NotFoundException('Workflow not found');
    if (w.userId !== a.user.id) throw new ForbiddenException('Only the owner can change this workflow');
    return w;
  }

  private clampSteps(n?: number) {
    return Math.max(1, Math.min(Number(n) || DEFAULT_MAX_STEPS, 50));
  }
}
