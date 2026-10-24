import { parseExpression } from 'cron-parser';

export const DEFAULT_TZ = 'Asia/Kolkata';
const MIN_INTERVAL_MIN = 15;

/** Next run (ISO, UTC) strictly after `from` for a 5-field cron in `tz`. */
export function nextRun(cron: string, tz = DEFAULT_TZ, from = new Date()): string {
  return parseExpression(cron, { tz, currentDate: from }).next().toDate().toISOString();
}

/** Throws a readable error for invalid crons or schedules more frequent than every 15 minutes. */
export function validateCron(cron: string, tz = DEFAULT_TZ): void {
  if (cron.trim().split(/\s+/).length !== 5) throw new Error('Use a 5-field cron: minute hour day-of-month month day-of-week');
  let it;
  try {
    it = parseExpression(cron, { tz });
  } catch (e) {
    throw new Error(`Invalid schedule: ${(e as Error).message}`);
  }
  const a = it.next().toDate().getTime();
  const b = it.next().toDate().getTime();
  if ((b - a) / 60_000 < MIN_INTERVAL_MIN) throw new Error(`Automations can run at most every ${MIN_INTERVAL_MIN} minutes`);
}
