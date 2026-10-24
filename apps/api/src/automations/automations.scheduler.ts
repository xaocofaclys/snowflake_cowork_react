import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Automation, AutomationRun } from '@cowork/shared';
import { nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';
import { AutomationRunner } from './automation-runner';
import { DEFAULT_TZ, nextRun } from './schedule';

const TICK_MS = 60_000;
/** Runs more than this late (app was down) are recorded as missed instead of executed. */
const MAX_LATENESS_MS = 6 * 60 * 60_000;

/**
 * In-app scheduler: every minute, run automations whose nextRunAt has passed, one at a time.
 * The Snowflake task COWORK_IDLE_STOP wakes the service ahead of due automations and keeps
 * it up while a run is in progress (see snowflake/06_phase2.sql).
 */
@Injectable()
export class AutomationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AutomationScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly store: DocStore,
    private readonly runner: AutomationRunner,
  ) {}

  onModuleInit() {
    setTimeout(() => this.recover().finally(() => this.tick()), 10_000);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Runs left "running" by a previous process can't finish; close them. */
  private async recover() {
    try {
      const stale = (await this.store.list<AutomationRun>('AUTOMATION_RUNS', { limit: 5000 })).filter((r) => r.status === 'running');
      for (const r of stale) {
        await this.store.put('AUTOMATION_RUNS', { ...r, status: 'error', error: 'Interrupted: the app restarted during this run', finishedAt: nowIso(), updatedAt: nowIso() });
      }
    } catch (e) {
      this.log.warn(`recover failed: ${(e as Error).message}`);
    }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const due = (await this.store.list<Automation>('AUTOMATIONS', { limit: 2000 }))
        .filter((a) => a.enabled && a.nextRunAt && Date.parse(a.nextRunAt) <= now)
        .sort((x, y) => x.nextRunAt!.localeCompare(y.nextRunAt!));
      for (const a of due) {
        const dueAt = a.nextRunAt!;
        if (now - Date.parse(dueAt) > MAX_LATENESS_MS) {
          await this.runner.markMissed(a, dueAt);
          continue;
        }
        // Advance first so a crash mid-run doesn't repeat it.
        await this.store.patch<Automation>('AUTOMATIONS', a.id, { nextRunAt: nextRun(a.schedule.cron, a.schedule.timezone || DEFAULT_TZ) });
        this.log.log(`running automation ${a.id} "${a.name}" (due ${dueAt})`);
        await this.runner.execute(a, 'schedule');
      }
    } catch (e) {
      this.log.error(`scheduler tick failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
