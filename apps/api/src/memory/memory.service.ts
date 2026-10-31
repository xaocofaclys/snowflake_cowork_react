import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { Memory, MemoryCategory, UserSettings } from '@cowork/shared';
import { CacheService } from '../common/cache.service';
import { newId, nowIso } from '../common/ids';
import { QueueService } from '../common/queue.service';
import { LlmService } from '../llm/llm.service';
import type { SfCredential } from '../snowflake/snowflake.client';
import { DocStore } from '../store/doc-store';
import { extractWithRules } from './rules';

const CATEGORIES: MemoryCategory[] = ['preference', 'fact', 'role', 'goal', 'other'];
const MAX_INJECTED = 8;

export interface ExtractJob {
  userId: string;
  threadId: string;
  userText: string;
  assistantText: string;
  cred?: SfCredential;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) (dot += a[i] * b[i]), (na += a[i] * a[i]), (nb += b[i] * b[i]);
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

function overlap(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  let n = 0;
  wa.forEach((w) => wb.has(w) && n++);
  return n / Math.max(1, Math.min(wa.size, wb.size));
}

/**
 * User memory: durable facts and preferences extracted from conversations
 * (or saved explicitly), retrieved by relevance and injected into each turn.
 */
@Injectable()
export class MemoryService implements OnModuleInit {
  constructor(
    private readonly store: DocStore,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly llm: LlmService,
  ) {}

  onModuleInit() {
    this.queue.register('memory.extract', (job: ExtractJob) => this.extract(job).then(() => undefined));
  }

  async list(userId: string): Promise<Memory[]> {
    return this.cache.wrap(`mem:${userId}`, 600, () => this.store.list<Memory>('MEMORIES', { userId, limit: 1000 }));
  }

  /** Client-facing list without embeddings. */
  async listPublic(userId: string): Promise<Memory[]> {
    return (await this.list(userId)).map(({ embedding: _e, ...m }) => m as Memory);
  }

  async create(userId: string, text: string, category: MemoryCategory, source: Memory['source'], cred?: SfCredential, threadId?: string) {
    const now = nowIso();
    const m: Memory = {
      id: newId('mem'),
      userId,
      text: text.trim(),
      category: CATEGORIES.includes(category) ? category : 'other',
      source,
      threadId,
      embedding: (await this.llm.embed(text, cred)) ?? undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insert('MEMORIES', m);
    await this.cache.del(`mem:${userId}`);
    const { embedding: _e, ...pub } = m;
    return pub;
  }

  async update(userId: string, id: string, patch: { text?: string; category?: MemoryCategory }, cred?: SfCredential) {
    const cur = await this.store.get<Memory>('MEMORIES', id);
    if (!cur || cur.userId !== userId) throw new NotFoundException();
    const next: Partial<Memory> = { ...patch };
    if (patch.text && patch.text !== cur.text) next.embedding = (await this.llm.embed(patch.text, cred)) ?? undefined;
    await this.store.patch<Memory>('MEMORIES', id, next);
    await this.cache.del(`mem:${userId}`);
    return { ok: true };
  }

  async remove(userId: string, id: string) {
    const cur = await this.store.get<Memory>('MEMORIES', id);
    if (!cur || cur.userId !== userId) throw new NotFoundException();
    await this.store.delete('MEMORIES', id);
    await this.cache.del(`mem:${userId}`);
  }

  async clear(userId: string) {
    for (const m of await this.list(userId)) await this.store.delete('MEMORIES', m.id);
    await this.cache.del(`mem:${userId}`);
  }

  /** Most relevant memories for a prompt: embedding similarity, else word overlap, plus recency. */
  async retrieve(userId: string, prompt: string, cred?: SfCredential): Promise<Memory[]> {
    const all = await this.list(userId);
    if (all.length <= MAX_INJECTED) return all;
    const qv = all.some((m) => m.embedding) ? await this.llm.embed(prompt, cred) : null;
    const scored = all.map((m, i) => {
      const sim = qv && m.embedding ? cosine(qv, m.embedding) : overlap(prompt, m.text);
      // Preferences apply broadly, so they get a boost regardless of topic.
      const boost = m.category === 'preference' || m.category === 'role' ? 0.15 : 0;
      return { m, score: sim + boost + (all.length - i) * 0.001 };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX_INJECTED).map((s) => s.m);
  }

  /** Memories plus the user's answer preferences, prepended to the agent's input. */
  formatContext(memories: Memory[], prefs: Partial<UserSettings> = {}): string {
    const style =
      prefs.responseStyle === 'concise'
        ? 'Answer briefly: the key result in 1-3 sentences, no extra commentary.'
        : prefs.responseStyle === 'detailed'
          ? 'Answer in depth: explain the result, notable patterns and caveats.'
          : '';
    const numbers =
      prefs.numberFormat === 'indian'
        ? `Write large numbers in lakh/crore (e.g. 2.6 Cr, 45 L)${prefs.currency === 'INR' ? ' and money in ₹' : ''}.`
        : prefs.currency && prefs.currency !== 'USD'
          ? `Show money in ${prefs.currency}.`
          : '';
    const lines = [...memories.map((m) => `- ${m.text}`), ...(style ? [`- ${style}`] : []), ...(numbers ? [`- ${numbers}`] : [])];
    if (!lines.length) return '';
    return `<user_context>\nKnown about this user and how they want answers (apply when relevant, do not mention unless asked):\n${lines.join('\n')}\n</user_context>\n\n`;
  }

  /** Background job: pull new durable facts out of a finished turn. Returns the saved texts. */
  async extract(job: ExtractJob): Promise<string[]> {
    const existing = await this.list(job.userId);
    let candidates: { text: string; category: MemoryCategory }[] | null = null;
    if (this.llm.enabled) {
      candidates = await this.llm.completeJson<{ text: string; category: MemoryCategory }[]>(
        `Extract durable facts or preferences about the USER from this exchange that would help in future, unrelated conversations
(e.g. their role, team, region of focus, preferred chart types, units, formats, recurring goals).
Ignore one-off questions, data values from answers, and anything about the assistant.
Already known: ${JSON.stringify(existing.map((m) => m.text))}
User: """${job.userText.slice(0, 2000)}"""
Assistant: """${job.assistantText.slice(0, 1500)}"""
Return ONLY a JSON array (possibly empty) of {"text": "<third-person fact, e.g. 'Prefers bar charts'>", "category": "preference|fact|role|goal|other"}.`,
        job.cred,
      );
    }
    candidates ??= extractWithRules(job.userText);
    const saved: string[] = [];
    for (const c of candidates.slice(0, 5)) {
      if (!c?.text || c.text.length < 4) continue;
      const dup = existing.some((m) => m.text.toLowerCase() === c.text.toLowerCase() || overlap(m.text, c.text) > 0.8);
      if (dup) continue;
      await this.create(job.userId, c.text, c.category, 'auto', job.cred, job.threadId);
      saved.push(c.text);
    }
    return saved;
  }
}
