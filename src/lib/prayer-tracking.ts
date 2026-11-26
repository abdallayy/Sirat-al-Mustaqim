import {
  dateInTimezone,
  PRAYERS,
  prayerTimes,
  type LocationSettings,
  type PrayerKey,
} from "./prayer";

export type PrayerLog = {
  completedByDate: Record<string, PrayerKey[]>;
};

type PrayerLogStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "sirat.prayer-log";
const PRAYER_KEYS = new Set<string>(PRAYERS);
export const DEFAULT_PRAYER_LOG: PrayerLog = { completedByDate: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prayerDateKey(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function dateKeyInTimezone(timezone: string, timestamp: number): string {
  return prayerDateKey(dateInTimezone(timezone, timestamp));
}

export function normalizePrayerLog(value: unknown): PrayerLog {
  if (!isRecord(value) || !isRecord(value.completedByDate)) return DEFAULT_PRAYER_LOG;
  const completedByDate: Record<string, PrayerKey[]> = {};
  for (const [date, prayers] of Object.entries(value.completedByDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(prayers)) continue;
    const validPrayers = [...new Set(prayers.filter(
      (prayer): prayer is PrayerKey => typeof prayer === "string" && PRAYER_KEYS.has(prayer),
    ))];
    if (validPrayers.length > 0) completedByDate[date] = validPrayers;
  }
  return { completedByDate };
}

export function loadPrayerLog(storage?: PrayerLogStorage): PrayerLog {
  const raw = (storage ?? window.localStorage).getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PRAYER_LOG;
  return normalizePrayerLog(JSON.parse(raw) as unknown);
}

export function savePrayerLog(log: PrayerLog, storage?: PrayerLogStorage): void {
  (storage ?? window.localStorage).setItem(
    STORAGE_KEY,
    JSON.stringify(normalizePrayerLog(log)),
  );
}

export function currentPrayerWindow(
  settings: LocationSettings,
  timestamp: number,
): { prayer: PrayerKey; dateKey: string } | null {
  const today = dateInTimezone(settings.timezone, timestamp);
  const todayKey = prayerDateKey(today);
  const todayTimes = prayerTimes(settings, today.year, today.month, today.day);
  const tomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrowTimes = prayerTimes(
    settings,
    tomorrowDate.getUTCFullYear(),
    tomorrowDate.getUTCMonth() + 1,
    tomorrowDate.getUTCDate(),
  );

  for (let index = 0; index < PRAYERS.length; index += 1) {
    const prayer = PRAYERS[index];
    const start = todayTimes[prayer];
    const end = index === PRAYERS.length - 1
      ? tomorrowTimes.fajr
      : todayTimes[PRAYERS[index + 1]];
    if (Number.isFinite(start) && Number.isFinite(end) && timestamp >= start && timestamp < end) {
      return { prayer, dateKey: todayKey };
    }
  }
  return null;
}

export function completedPrayerCount(log: PrayerLog, dateKey: string): number {
  return new Set(log.completedByDate[dateKey] ?? []).size;
}

export function markPrayerComplete(
  log: PrayerLog,
  settings: LocationSettings,
  prayer: PrayerKey,
  timestamp: number,
): PrayerLog {
  const activeWindow = currentPrayerWindow(settings, timestamp);
  if (!activeWindow || activeWindow.prayer !== prayer) {
    throw new RangeError("A prayer can only be recorded before the next prayer begins.");
  }

  const completed = new Set(log.completedByDate[activeWindow.dateKey] ?? []);
  completed.add(prayer);
  return {
    completedByDate: {
      ...log.completedByDate,
      [activeWindow.dateKey]: [...completed],
    },
  };
}

function previousDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return prayerDateKey({
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  });
}

export function prayerStreak(log: PrayerLog, todayKey: string): number {
  const todayIsComplete = completedPrayerCount(log, todayKey) === PRAYERS.length;
  let dateKey = todayIsComplete ? todayKey : previousDateKey(todayKey);
  let streak = 0;
  const maxDays = Object.keys(log.completedByDate).length;
  while (streak < maxDays && completedPrayerCount(log, dateKey) === PRAYERS.length) {
    streak += 1;
    dateKey = previousDateKey(dateKey);
  }
  return streak;
}
