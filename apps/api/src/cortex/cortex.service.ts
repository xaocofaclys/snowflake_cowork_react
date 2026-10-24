import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AgentInfo, StreamEvent } from '@cowork/shared';
import { CacheService } from '../common/cache.service';
import { env } from '../config/env';
import { SfCredential, SnowflakeClient } from '../snowflake/snowflake.client';
import { MOCK_AGENTS, mockAgentStream, mockThreadId } from './mock-cortex';
import { normalizeCortexEvent } from './normalize';
import { parseSse } from './sse';

export interface RunInput {
  agentId: string;
  text: string;
  threadId?: number;
  parentMessageId?: number;
  /** Prior turns, used only when Cortex threads are unavailable. */
  history?: { role: 'user' | 'assistant'; text: string }[];
  signal?: AbortSignal;
}

function splitId(agentId: string) {
  const [database, schema, name] = agentId.split('.');
  if (!database || !schema || !name) throw new NotFoundException(`Bad agent id ${agentId}`);
  return { database, schema, name };
}

const q = (s: string) => encodeURIComponent(s);

@Injectable()
export class CortexService {
  private readonly log = new Logger(CortexService.name);

  constructor(
    private readonly sf: SnowflakeClient,
    private readonly cache: CacheService,
  ) {}

  /** Agents visible to the caller's role. */
  async listAgents(cred: SfCredential | undefined, cacheKey: string): Promise<AgentInfo[]> {
    if (env.CORTEX_MOCK || !cred) {
      return MOCK_AGENTS.map((a) => ({ ...a, id: `${a.database}.${a.schema}.${a.name}`, kind: 'agent' as const }));
    }
    return this.cache.wrap(`agents:${cacheKey}`, 300, async () => {
      const found: { database: string; schema: string; name: string; comment?: string; profile?: string }[] = [];
      const locations = env.AGENT_LOCATIONS.split(',').map((s) => s.trim()).filter(Boolean);
      if (locations.length) {
        for (const loc of locations) {
          const [db, sc] = loc.split('.');
          const list = await this.sf.json<any[]>(`/api/v2/databases/${q(db)}/schemas/${q(sc)}/agents`, cred);
          for (const a of list) found.push({ database: db, schema: sc, name: a.name, comment: a.comment, profile: a.profile });
        }
      } else {
        const r = await this.sf.sql('SHOW AGENTS IN ACCOUNT', [], cred);
        const col = (n: string) => r.columns.findIndex((c) => c.name.toLowerCase() === n);
        for (const row of r.rows) {
          found.push({
            database: String(row[col('database_name')]),
            schema: String(row[col('schema_name')]),
            name: String(row[col('name')]),
            comment: row[col('comment')] as string | undefined,
            profile: row[col('profile')] as string | undefined,
          });
        }
      }
      return Promise.all(found.map((a) => this.describe(cred, a).catch(() => this.toInfo(a, {}))));
    });
  }

  private async describe(cred: SfCredential, a: { database: string; schema: string; name: string; comment?: string; profile?: string }) {
    const d = await this.sf.json<any>(
      `/api/v2/databases/${q(a.database)}/schemas/${q(a.schema)}/agents/${q(a.name)}`,
      cred,
    );
    const spec = typeof d.agent_spec === 'string' ? JSON.parse(d.agent_spec) : (d.agent_spec ?? d);
    return this.toInfo({ ...a, comment: d.comment ?? a.comment, profile: d.profile ?? a.profile }, spec);
  }

  private toInfo(a: { database: string; schema: string; name: string; comment?: string; profile?: any }, spec: any): AgentInfo {
    let profile = a.profile;
    if (typeof profile === 'string') {
      try {
        profile = JSON.parse(profile);
      } catch {
        profile = {};
      }
    }
    const samples = spec?.instructions?.sample_questions ?? spec?.sample_questions ?? [];
    return {
      id: `${a.database}.${a.schema}.${a.name}`,
      database: a.database,
      schema: a.schema,
      name: a.name,
      displayName: profile?.display_name ?? a.name.replace(/_/g, ' '),
      description: a.comment ?? undefined,
      sampleQuestions: samples.map((s: any) => (typeof s === 'string' ? s : s.question)).filter(Boolean),
      kind: 'agent',
    };
  }

  /** Creates a Cortex thread so the agent keeps server-side conversation context. */
  async createThread(cred: SfCredential | undefined): Promise<number | undefined> {
    if (env.CORTEX_MOCK || !cred) return mockThreadId();
    try {
      const res = await this.sf.json<any>('/api/v2/cortex/threads', cred, {
        method: 'POST',
        body: JSON.stringify({ origin_application: 'cowork_clone' }),
      });
      const id = typeof res === 'object' ? (res.thread_id ?? res.id) : res;
      return id !== undefined ? Number(id) : undefined;
    } catch (e) {
      this.log.warn(`Cortex threads unavailable, falling back to client-side history: ${(e as Error).message}`);
      return undefined;
    }
  }

  /** Runs an agent and yields normalized events as they stream in. */
  async *run(cred: SfCredential | undefined, input: RunInput): AsyncGenerator<StreamEvent> {
    let body: AsyncIterable<Uint8Array>;
    if (env.CORTEX_MOCK || !cred) {
      body = mockAgentStream(input.text, input.signal);
    } else {
      const { database, schema, name } = splitId(input.agentId);
      const messages = [
        ...(input.threadId === undefined ? (input.history ?? []) : []).map((m) => ({
          role: m.role,
          content: [{ type: 'text', text: m.text }],
        })),
        { role: 'user', content: [{ type: 'text', text: input.text }] },
      ];
      const payload: Record<string, unknown> = { messages, stream: true };
      if (input.threadId !== undefined) {
        payload.thread_id = input.threadId;
        payload.parent_message_id = input.parentMessageId ?? 0;
      }
      const res = await this.sf.request(
        `/api/v2/databases/${q(database)}/schemas/${q(schema)}/agents/${q(name)}:run`,
        cred,
        { method: 'POST', body: JSON.stringify(payload), accept: 'text/event-stream', signal: input.signal },
      );
      if (!res.body) throw new Error('Cortex returned no stream body');
      body = res.body as unknown as AsyncIterable<Uint8Array>;
    }

    let streamedText = false;
    for await (const rec of parseSse(body)) {
      // The final aggregate only matters if nothing was streamed (e.g. non-streaming proxies).
      if (rec.event === 'response' && streamedText) continue;
      for (const ev of normalizeCortexEvent(rec.event, rec.data)) {
        if (ev.type === 'text_delta') streamedText = true;
        yield ev;
      }
    }
  }
}
