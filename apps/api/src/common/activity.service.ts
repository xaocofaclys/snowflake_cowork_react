import { Injectable, Logger } from '@nestjs/common';
import { nowIso } from './ids';
import { DocStore } from '../store/doc-store';

const THROTTLE_MS = 5 * 60_000;

/**
 * Records that the app is in use (at most every 5 minutes). The idle auto-suspend task in
 * snowflake/06_phase2.sql reads COWORK_APP.CORE.ACTIVITY to decide when to stop the service.
 */
@Injectable()
export class ActivityService {
  private readonly log = new Logger(ActivityService.name);
  private last = 0;

  constructor(private readonly store: DocStore) {}

  touch(): void {
    const now = Date.now();
    if (now - this.last < THROTTLE_MS) return;
    this.last = now;
    this.write().catch((e) => this.log.warn(`activity write failed: ${e.message}`));
  }

  private async write() {
    const ts = nowIso();
    const doc = { id: 'app', userId: 'system', createdAt: ts, updatedAt: ts };
    if (await this.store.get('ACTIVITY', 'app')) await this.store.put('ACTIVITY', doc);
    else await this.store.insert('ACTIVITY', doc);
  }
}
