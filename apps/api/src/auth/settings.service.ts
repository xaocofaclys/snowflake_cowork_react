import { Injectable } from '@nestjs/common';
import type { Pin, UserSettings } from '@cowork/shared';
import { nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';

const DEFAULTS: UserSettings = { memoryEnabled: true, autoChart: true, responseStyle: 'balanced', numberFormat: 'international', currency: 'USD', accent: 'snow', pins: [], onboarded: false };
type SettingsDoc = UserSettings & { id: string; userId: string; createdAt: string; updatedAt: string };

const STYLES = ['concise', 'balanced', 'detailed'];
const FORMATS = ['international', 'indian'];
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP'];
const ACCENTS = ['snow', 'glacier', 'aurora', 'violet', 'rose', 'amber'];

/** Keeps only provided, valid fields, so saving one setting never clears the others. */
function sanitize(p: Partial<UserSettings>): Partial<UserSettings> {
  const out: Partial<UserSettings> = {};
  if (typeof p.memoryEnabled === 'boolean') out.memoryEnabled = p.memoryEnabled;
  if (typeof p.autoChart === 'boolean') out.autoChart = p.autoChart;
  if (typeof p.onboarded === 'boolean') out.onboarded = p.onboarded;
  if ('defaultAgentId' in p) out.defaultAgentId = p.defaultAgentId || undefined;
  if (p.responseStyle && STYLES.includes(p.responseStyle)) out.responseStyle = p.responseStyle;
  if (p.numberFormat && FORMATS.includes(p.numberFormat)) out.numberFormat = p.numberFormat;
  if (p.currency && CURRENCIES.includes(p.currency)) out.currency = p.currency;
  if (p.accent && ACCENTS.includes(p.accent)) out.accent = p.accent;
  if (Array.isArray(p.pins)) {
    out.pins = p.pins
      .filter((x): x is Pin => !!x && (x.kind === 'dashboard' || x.kind === 'artifact') && typeof x.id === 'string')
      .slice(0, 24)
      .map((x) => ({ kind: x.kind, id: x.id, title: String(x.title ?? '').slice(0, 120) }));
  }
  return out;
}

@Injectable()
export class SettingsService {
  constructor(private readonly store: DocStore) {}

  async get(userId: string): Promise<UserSettings> {
    const doc = await this.store.get<SettingsDoc>('SETTINGS', `set_${userId}`);
    if (!doc) return DEFAULTS;
    const { id: _i, userId: _u, createdAt: _c, updatedAt: _up, ...settings } = doc;
    return { ...DEFAULTS, ...sanitize(settings) };
  }

  async update(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    const id = `set_${userId}`;
    const cur = await this.store.get<SettingsDoc>('SETTINGS', id);
    const now = nowIso();
    const next: SettingsDoc = { ...DEFAULTS, ...cur, ...sanitize(patch), id, userId, createdAt: cur?.createdAt ?? now, updatedAt: now };
    if (cur) await this.store.put('SETTINGS', next);
    else await this.store.insert('SETTINGS', next);
    return this.get(userId);
  }
}
