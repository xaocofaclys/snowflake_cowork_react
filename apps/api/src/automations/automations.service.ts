import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Automation, AutomationRun, AutomationTargetKind } from '@cowork/shared';
import type { AuthContext } from '../auth/auth.types';
import { newId, nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';
import { AutomationRunner } from './automation-runner';
import { EmailService } from './email.service';
import { DEFAULT_TZ, nextRun, validateCron } from './schedule';

export type AutomationInput = Pick<Automation, 'name' | 'prompt' | 'target' | 'schedule' | 'email' | 'enabled'>;

const KINDS: AutomationTargetKind[] = ['agent', 'workflow', 'research'];

@Injectable()
export class AutomationsService {
  constructor(
    private readonly store: DocStore,
    private readonly runner: AutomationRunner,
  ) {}

  list(a: AuthContext) {
    return this.store.list<Automation>('AUTOMATIONS', { userId: a.user.id, limit: 500 });
  }

  async get(a: AuthContext, id: string): Promise<Automation> {
    const x = await this.store.get<Automation>('AUTOMATIONS', id);
    if (!x || x.userId !== a.user.id) throw new NotFoundException('Automation not found');
    return x;
  }

  runs(a: AuthContext, id: string) {
    return this.get(a, id).then(() => this.store.list<AutomationRun>('AUTOMATION_RUNS', { parentId: id, limit: 50 }));
  }

  async create(a: AuthContext, b: Partial<AutomationInput>): Promise<Automation> {
    const clean = this.clean(b, true);
    const now = nowIso();
    const x: Automation = {
      id: newId('aut'),
      userId: a.user.id,
      ownerName: a.user.name,
      ...(clean as AutomationInput),
      nextRunAt: clean.enabled ? nextRun(clean.schedule!.cron, clean.schedule!.timezone) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert('AUTOMATIONS', x);
  }

  async update(a: AuthContext, id: string, b: Partial<AutomationInput>): Promise<Automation> {
    const cur = await this.get(a, id);
    const clean = this.clean(b, false);
    const merged = { ...cur, ...clean };
    const reschedule = clean.schedule !== undefined || clean.enabled !== undefined;
    return (await this.store.patch<Automation>('AUTOMATIONS', id, {
      ...clean,
      ...(reschedule ? { nextRunAt: merged.enabled ? nextRun(merged.schedule.cron, merged.schedule.timezone) : undefined } : {}),
    }))!;
  }

  async remove(a: AuthContext, id: string) {
    await this.get(a, id);
    await this.store.deleteByParent('AUTOMATION_RUNS', id);
    await this.store.delete('AUTOMATIONS', id);
  }

  /** Runs now, waits for completion and returns the run (the UI shows progress meanwhile). */
  async runNow(a: AuthContext, id: string) {
    return this.runner.execute(await this.get(a, id), 'manual');
  }

  private clean(b: Partial<AutomationInput>, creating: boolean): Partial<AutomationInput> {
    const out: Partial<AutomationInput> = {};
    if (b.name !== undefined || creating) {
      if (!b.name?.trim()) throw new BadRequestException('Name is required');
      out.name = b.name.trim().slice(0, 120);
    }
    if (b.prompt !== undefined || creating) {
      if (!b.prompt?.trim()) throw new BadRequestException('Prompt is required');
      out.prompt = b.prompt.trim().slice(0, 4000);
    }
    if (b.target !== undefined || creating) {
      if (!b.target || !KINDS.includes(b.target.kind) || !b.target.agentId) throw new BadRequestException('Pick what should run');
      out.target = { kind: b.target.kind, agentId: b.target.agentId };
    }
    if (b.schedule !== undefined || creating) {
      const cron = b.schedule?.cron?.trim() ?? '';
      const timezone = b.schedule?.timezone || DEFAULT_TZ;
      try {
        validateCron(cron, timezone);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      out.schedule = { cron, timezone };
    }
    if (b.email !== undefined) {
      const to = EmailService.validRecipients(b.email?.to ?? []);
      if (b.email?.enabled && !to.length) throw new BadRequestException('Add at least one valid email address');
      out.email = { enabled: !!b.email?.enabled, to };
    }
    if (b.enabled !== undefined || creating) out.enabled = b.enabled ?? true;
    return out;
  }
}
