import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  extractRoutePlanBlock,
  parseRoutePlan,
  PLAN_ACTIONS,
  stripRoutePlanBlock,
  type FieldRep,
  type PlanAction,
  type RoutePlan,
  type StreamEvent,
  type TerritoryHcp,
} from '@cowork/shared';
import type { AuthContext } from '../auth/auth.types';
import { CacheService } from '../common/cache.service';
import { env } from '../config/env';
import { CortexService } from '../cortex/cortex.service';
import { SfCredential, SnowflakeClient } from '../snowflake/snowflake.client';
import { MOCK_FIRST_DATE, mockAdjust, mockPlan, mockReps, mockTerritory } from './mock-planner';
import { mockPlannerReply } from './mock-chat';

export interface PlannerContext {
  agentId: string;
  reps: FieldRep[];
  defaultRepId?: string;
  /** Today in the account's time zone: what the procedures mean by "today". */
  today: string;
  live: boolean;
}

export interface AdjustRequest {
  repId: string;
  date: string;
  action: PlanAction;
  hcpId?: string;
  param?: string;
}

export interface PlannerChatRequest {
  repId: string;
  date: string;
  text: string;
  /** Stops currently on screen, so "stop C" or a doctor's name resolves to the right HCP. */
  stops?: { stop: string; hcpId: string; hcpName: string }[];
}

const ID = /^[A-Za-z0-9_-]{1,32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PARAM = /^[\w :.\-]{0,32}$/;
const PLAN_TOOLS = new Set(['plan_route', 'adjust_plan']);

/**
 * Route planner on top of the FIELD_REP_DAY_PLANNER agent and its procedures. Map edits call
 * FR_ADJUST_PLAN directly (instant, deterministic); chat goes through the agent. Both write
 * FR_PLAN_OVERRIDES, so they always agree on the plan.
 */
@Injectable()
export class PlannerService {
  private readonly log = new Logger(PlannerService.name);

  constructor(
    private readonly sf: SnowflakeClient,
    private readonly cortex: CortexService,
    private readonly cache: CacheService,
  ) {}

  private get schema(): string {
    const parts = env.PLANNER_AGENT.split('.');
    if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_$]+$/.test(p))) throw new Error(`Bad PLANNER_AGENT ${env.PLANNER_AGENT}`);
    return `${parts[0]}.${parts[1]}`;
  }

  private live(cred?: SfCredential): cred is SfCredential {
    return !env.CORTEX_MOCK && !!cred;
  }

  async context(auth: AuthContext): Promise<PlannerContext> {
    const agentId = env.PLANNER_AGENT;
    if (!this.live(auth.cred)) {
      return { agentId, reps: mockReps(), defaultRepId: 'R001', today: MOCK_FIRST_DATE, live: false };
    }
    const cred = auth.cred;
    const { reps, today } = await this.cache.wrap(`planner:reps:${auth.user.role ?? ''}`, 300, async () => {
      const r = await this.sf.sql(
        `SELECT REP_ID, REP_NAME, TERRITORY, START_LOCATION, START_LAT, START_LON, SHIFT_START, SHIFT_END, SNOWFLAKE_USER, CURRENT_DATE()::VARCHAR AS TODAY
         FROM ${this.schema}.FR_REPS ORDER BY REP_ID`,
        [],
        cred,
      );
      return {
        today: String(r.rows[0]?.[9] ?? new Date().toISOString().slice(0, 10)),
        reps: r.rows.map((row) => ({
          repId: String(row[0]),
          name: String(row[1]),
          territory: row[2] as string,
          startLocation: row[3] as string,
          lat: Number(row[4]),
          lon: Number(row[5]),
          shiftStart: row[6] as string,
          shiftEnd: row[7] as string,
          snowflakeUser: row[8] as string,
        })),
      };
    });
    const me = auth.user.name.toUpperCase();
    return { agentId, reps, defaultRepId: (reps.find((r) => r.snowflakeUser?.toUpperCase() === me) ?? reps[0])?.repId, today, live: true };
  }

  async territory(auth: AuthContext, repId: string): Promise<TerritoryHcp[]> {
    this.check({ repId });
    if (!this.live(auth.cred)) return mockTerritory(repId);
    const cred = auth.cred;
    return this.cache.wrap(`planner:hcps:${repId}`, 300, async () => {
      const r = await this.sf.sql(
        `SELECT HCP_ID, HCP_NAME, SPECIALTY, TIER, AREA, CLINIC_NAME, LAT, LON, AVAIL_START, AVAIL_END
         FROM ${this.schema}.FR_HCPS WHERE REP_ID = ? ORDER BY HCP_ID`,
        [repId],
        cred,
      );
      return r.rows.map((row) => ({
        hcpId: String(row[0]),
        hcpName: String(row[1]),
        specialty: row[2] as string,
        tier: row[3] as string,
        area: row[4] as string,
        clinic: row[5] as string,
        lat: Number(row[6]),
        lon: Number(row[7]),
        availStart: row[8] as string,
        availEnd: row[9] as string,
      }));
    });
  }

  async plan(auth: AuthContext, repId: string, date: string, startTime?: string): Promise<RoutePlan> {
    this.check({ repId, date, param: startTime });
    if (!this.live(auth.cred)) return mockPlan(repId, date, startTime);
    try {
      return this.toPlan(await this.call(auth.cred, 'FR_PLAN_ROUTE', [repId, date, startTime ?? null]), date);
    } catch (e) {
      // Without USAGE on the procedure the agent may still be able to plan (it runs its tools itself).
      this.log.warn(`FR_PLAN_ROUTE failed, asking the agent instead: ${(e as Error).message}`);
      return this.planViaAgent(auth.cred, `rep_id: ${repId}. Plan my day for ${date}${startTime ? ` starting at ${startTime}` : ''}.`, date);
    }
  }

  async adjust(auth: AuthContext, b: AdjustRequest): Promise<RoutePlan> {
    this.check({ repId: b.repId, date: b.date, hcpId: b.hcpId, param: b.param });
    if (!PLAN_ACTIONS.includes(b.action)) throw new BadRequestException(`Unknown action ${b.action}`);
    if (b.action === 'RESET') await this.cache.del(this.sessionKey(auth, b.repId, b.date));
    if (!this.live(auth.cred)) return mockAdjust(b.repId, b.date, { action: b.action, hcpId: b.hcpId, param: b.param });
    const out = await this.call(auth.cred, 'FR_ADJUST_PLAN', [b.repId, b.date, b.action, b.hcpId ?? null, b.param ?? null]);
    return this.toPlan(out, b.date);
  }

  /** One chat turn with the planner agent, streamed as SSE; plan changes arrive as route_plan events. */
  async chat(auth: AuthContext, b: PlannerChatRequest, req: Request, res: Response) {
    this.check({ repId: b.repId, date: b.date });
    if (!b.text?.trim()) throw new BadRequestException('Empty message');
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => !res.writableFinished && abort.abort());
    const send = (ev: StreamEvent) => !res.writableEnded && res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

    try {
      if (!this.live(auth.cred)) {
        for await (const ev of mockPlannerReply(b, abort.signal)) send(ev);
        send({ type: 'done', messageId: '' });
        return;
      }
      const cred = auth.cred;
      const key = this.sessionKey(auth, b.repId, b.date);
      const session = (await this.cache.get<{ threadId?: number; parentMessageId?: number }>(key)) ?? { threadId: await this.cortex.createThread(cred) };
      const onScreen = b.stops?.length ? ` Current plan on screen: ${b.stops.map((s) => `${s.stop}=${s.hcpId} ${s.hcpName}`).join('; ')}.` : '';
      const text = `[rep_id: ${b.repId}. plan_date: ${b.date}.${onScreen}]\n${b.text.trim()}`;

      let planned: RoutePlan | null = null;
      let reply = '';
      for await (const ev of this.cortex.run(cred, { agentId: env.PLANNER_AGENT, text, threadId: session.threadId, parentMessageId: session.parentMessageId ?? 0, signal: abort.signal })) {
        if (ev.type === 'tool_result') {
          const { output, ...rest } = ev;
          send(rest);
          const p = PLAN_TOOLS.has(ev.name) && ev.status !== 'error' ? parseRoutePlan(output) : null;
          if (p) {
            planned = { ...p, planDate: p.planDate || b.date };
            send({ type: 'route_plan', plan: planned });
          }
          continue;
        }
        if (ev.type === 'text_delta') reply += ev.text;
        if (ev.type === 'text') reply = ev.text;
        if (ev.type === 'metadata' && ev.role === 'assistant') session.parentMessageId = ev.messageId;
        send(ev);
      }
      // The reply's route_plan block is the fallback when no tool output could be parsed.
      if (!planned) {
        const p = extractRoutePlanBlock(reply);
        if (p) send({ type: 'route_plan', plan: { ...p, planDate: p.planDate || b.date } });
      }
      await this.cache.set(key, session, 12 * 3600);
      send({ type: 'done', messageId: '' });
    } catch (e) {
      if (!abort.signal.aborted) {
        this.log.error((e as Error).message);
        send({ type: 'error', message: (e as Error).message });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  // ---- helpers ----

  private sessionKey(auth: AuthContext, repId: string, date: string) {
    return `planner:chat:${auth.user.id}:${repId}:${date}`;
  }

  private check(v: { repId?: string; date?: string; hcpId?: string; param?: string }) {
    if (v.repId !== undefined && !ID.test(v.repId)) throw new BadRequestException('Bad rep id');
    if (v.date !== undefined && !DATE.test(v.date)) throw new BadRequestException('Date must be YYYY-MM-DD');
    if (v.hcpId && !ID.test(v.hcpId)) throw new BadRequestException('Bad HCP id');
    if (v.param && !PARAM.test(v.param)) throw new BadRequestException('Bad parameter');
  }

  private async call(cred: SfCredential, proc: string, args: unknown[]): Promise<unknown> {
    const r = await this.sf.sql(`CALL ${this.schema}.${proc}(${args.map(() => '?').join(', ')})`, args, cred, { timeoutSeconds: 60 });
    return r.rows[0]?.[0];
  }

  private toPlan(raw: unknown, date: string): RoutePlan {
    const p = parseRoutePlan(raw);
    if (!p) {
      const err = typeof raw === 'object' && raw && 'error' in raw ? String((raw as { error: unknown }).error) : 'The planner returned no route';
      throw new BadRequestException(err);
    }
    return { ...p, planDate: p.planDate || date };
  }

  private async planViaAgent(cred: SfCredential, text: string, date: string): Promise<RoutePlan> {
    let reply = '';
    let fromTool: RoutePlan | null = null;
    for await (const ev of this.cortex.run(cred, { agentId: env.PLANNER_AGENT, text })) {
      if (ev.type === 'tool_result' && PLAN_TOOLS.has(ev.name)) fromTool = parseRoutePlan(ev.output) ?? fromTool;
      if (ev.type === 'text_delta') reply += ev.text;
      if (ev.type === 'text') reply = ev.text;
    }
    const p = fromTool ?? extractRoutePlanBlock(reply);
    if (!p) throw new BadRequestException(stripRoutePlanBlock(reply).slice(0, 400) || 'The planner agent returned no route');
    return { ...p, planDate: p.planDate || date };
  }
}
