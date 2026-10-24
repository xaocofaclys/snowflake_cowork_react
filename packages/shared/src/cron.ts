export type Freq = 'daily' | 'weekdays' | 'weekly' | 'custom';
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface SchedulePick {
  freq: Freq;
  time: string; // HH:MM
  day: number; // 0-6, for weekly
  cron: string; // for custom
}

export function toCron(p: SchedulePick): string {
  if (p.freq === 'custom') return p.cron.trim();
  const [h, m] = p.time.split(':').map((x) => Number(x) || 0);
  if (p.freq === 'daily') return `${m} ${h} * * *`;
  if (p.freq === 'weekdays') return `${m} ${h} * * 1-5`;
  return `${m} ${h} * * ${p.day}`;
}

/** Parses crons produced by toCron back into the picker; anything else is "custom". */
export function fromCron(cron: string): SchedulePick {
  const m = cron.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/);
  const base = { time: '09:00', day: 1, cron };
  if (!m) return { ...base, freq: 'custom' };
  const time = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
  if (m[3] === '*') return { ...base, freq: 'daily', time };
  if (m[3] === '1-5') return { ...base, freq: 'weekdays', time };
  return { ...base, freq: 'weekly', time, day: Number(m[3]) };
}

export function describeCron(cron: string): string {
  const p = fromCron(cron);
  if (p.freq === 'daily') return `Every day at ${p.time} IST`;
  if (p.freq === 'weekdays') return `Weekdays at ${p.time} IST`;
  if (p.freq === 'weekly') return `Every ${DAYS[p.day]} at ${p.time} IST`;
  return `Cron "${cron}" (IST)`;
}

export function istTime(iso?: string): string {
  if (!iso) return '—';
  return `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;
}

const DAY_WORDS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Reads a schedule out of plain English ("every Monday at 8am", "weekdays at 18:30",
 * "daily at 9"). Returns null when no recurrence is stated. Used when no LLM is available.
 */
export function parseScheduleText(text: string): SchedulePick | null {
  const t = text.toLowerCase();
  let time = '09:00';
  const tm = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ?? t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/) ?? t.match(/\b(\d{1,2})()\s*(am|pm)\b/);
  if (tm) {
    let h = Number(tm[1]);
    const m = tm[2] ? Number(tm[2]) : 0;
    if (tm[3] === 'pm' && h < 12) h += 12;
    if (tm[3] === 'am' && h === 12) h = 0;
    if (h <= 23 && m <= 59) time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else if (/\bevening\b/.test(t)) time = '18:00';
  else if (/\b(noon|afternoon)\b/.test(t)) time = '13:00';

  if (/\b(weekdays?|every working day)\b/.test(t)) return { freq: 'weekdays', time, day: 1, cron: '' };
  const day = t.match(/\b(?:every|each|on)\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/) ?? t.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*days\b/);
  if (day) return { freq: 'weekly', time, day: DAY_WORDS[day[1]], cron: '' };
  if (/\b(weekly|every week)\b/.test(t)) return { freq: 'weekly', time, day: 1, cron: '' };
  if (/\b(daily|every day|each day|every morning|every evening|each morning)\b/.test(t)) return { freq: 'daily', time, day: 1, cron: '' };
  return null;
}
