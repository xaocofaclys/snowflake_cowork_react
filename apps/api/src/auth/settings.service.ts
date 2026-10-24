import { Injectable } from '@nestjs/common';
import type { UserSettings } from '@cowork/shared';
import { nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';

const DEFAULTS: UserSettings = { memoryEnabled: true, autoChart: true };
type SettingsDoc = UserSettings & { id: string; userId: string; createdAt: string; updatedAt: string };

@Injectable()
export class SettingsService {
  constructor(private readonly store: DocStore) {}

  async get(userId: string): Promise<UserSettings> {
    const doc = await this.store.get<SettingsDoc>('SETTINGS', `set_${userId}`);
    if (!doc) return DEFAULTS;
    const { memoryEnabled, defaultAgentId, autoChart } = doc;
    return { ...DEFAULTS, memoryEnabled, defaultAgentId, autoChart };
  }

  async update(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    const id = `set_${userId}`;
    const cur = await this.store.get<SettingsDoc>('SETTINGS', id);
    const now = nowIso();
    const next: SettingsDoc = { ...DEFAULTS, ...cur, ...patch, id, userId, createdAt: cur?.createdAt ?? now, updatedAt: now };
    if (cur) await this.store.put('SETTINGS', next);
    else await this.store.insert('SETTINGS', next);
    return this.get(userId);
  }
}
