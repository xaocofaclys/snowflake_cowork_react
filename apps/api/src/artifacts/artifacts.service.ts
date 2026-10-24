import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { withTableData, type Artifact } from '@cowork/shared';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../common/cache.service';
import { newId, nowIso } from '../common/ids';
import { env } from '../config/env';
import { mockRerun } from '../cortex/mock-cortex';
import { SnowflakeClient } from '../snowflake/snowflake.client';
import { DocStore } from '../store/doc-store';

export type CreateArtifact = Pick<
  Artifact,
  'type' | 'title' | 'description' | 'spec' | 'table' | 'text' | 'sql' | 'queryId' | 'agentId' | 'threadId' | 'messageId'
>;

/**
 * Artifacts are saved charts, tables and answers. They keep their SQL, so
 * "refresh" re-runs it with the *viewer's* credential: live data that still
 * respects each viewer's Snowflake role.
 */
@Injectable()
export class ArtifactsService {
  constructor(
    private readonly store: DocStore,
    private readonly sf: SnowflakeClient,
    private readonly cache: CacheService,
  ) {}

  async create(auth: AuthContext, b: CreateArtifact): Promise<Artifact> {
    if (!b.title?.trim()) throw new BadRequestException('title is required');
    if (!['chart', 'table', 'answer'].includes(b.type)) throw new BadRequestException('bad type');
    const now = nowIso();
    const a: Artifact = {
      id: newId('art'),
      userId: auth.user.id,
      type: b.type,
      title: b.title.trim().slice(0, 200),
      description: b.description,
      spec: b.spec,
      table: b.table,
      text: b.text,
      sql: b.sql,
      queryId: b.queryId,
      agentId: b.agentId,
      threadId: b.threadId,
      messageId: b.messageId,
      sharedWith: [],
      refreshedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert('ARTIFACTS', a);
  }

  list(userId: string) {
    return this.store.list<Artifact>('ARTIFACTS', { userId, limit: 500 });
  }

  async get(auth: AuthContext, id: string): Promise<Artifact> {
    const a = await this.store.get<Artifact>('ARTIFACTS', id);
    if (!a) throw new NotFoundException();
    const shared = a.sharedWith?.includes('*') || a.sharedWith?.includes(auth.user.name.toUpperCase());
    if (a.userId !== auth.user.id && !shared) throw new ForbiddenException();
    return a;
  }

  async update(auth: AuthContext, id: string, b: { title?: string; description?: string; sharedWith?: string[] }) {
    const a = await this.get(auth, id);
    if (a.userId !== auth.user.id) throw new ForbiddenException();
    return this.store.patch<Artifact>('ARTIFACTS', id, {
      ...(b.title ? { title: b.title.slice(0, 200) } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.sharedWith ? { sharedWith: b.sharedWith.map((s) => (s === '*' ? s : s.toUpperCase())) } : {}),
    });
  }

  async remove(auth: AuthContext, id: string) {
    const a = await this.get(auth, id);
    if (a.userId !== auth.user.id) throw new ForbiddenException();
    await this.store.delete('ARTIFACTS', id);
  }

  async refresh(auth: AuthContext, id: string, force = false): Promise<Artifact> {
    const a = await this.get(auth, id);
    if (!a.sql || !a.table) throw new BadRequestException('This artifact has no query to refresh');
    const key = `art:${id}:${auth.user.id}`;
    if (force) await this.cache.del(key);
    const table = await this.cache.wrap(key, env.ARTIFACT_CACHE_TTL, async () => {
      if (env.CORTEX_MOCK || !auth.cred) return { columns: a.table!.columns, rows: mockRerun(a.table!.columns, a.table!.rows) };
      const r = await this.sf.sql(a.sql!, [], auth.cred, { timeoutSeconds: 300 });
      return { columns: r.columns, rows: r.rows };
    });
    const refreshed: Artifact = {
      ...a,
      table,
      spec: a.spec ? withTableData(a.spec, table) : undefined,
      refreshedAt: nowIso(),
    };
    // Only the owner's copy is persisted; viewers get a live view without writing.
    if (a.userId === auth.user.id) await this.store.put('ARTIFACTS', { ...refreshed, updatedAt: nowIso() });
    return refreshed;
  }
}
