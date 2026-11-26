export type ReadingProgress = {
  dailyGoal: number;
  readByDate: Record<string, string[]>;
};

const STORAGE_KEY = "sirat.reading-progress";
export const DEFAULT_READING_PROGRESS: ReadingProgress = {
  dailyGoal: 20,
  readByDate: {},
};

type ReadingStorage = Pick<Storage, "getItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function normalizeReadingProgress(value: unknown): ReadingProgress {
  if (!isRecord(value)) return DEFAULT_READING_PROGRESS;
  const dailyGoal =
    typeof value.dailyGoal === "number" &&
    Number.isInteger(value.dailyGoal) &&
    value.dailyGoal >= 1 &&
    value.dailyGoal <= 1000
      ? value.dailyGoal
      : DEFAULT_READING_PROGRESS.dailyGoal;
  const storedDays = isRecord(value.readByDate) ? value.readByDate : {};
  const readByDate: Record<string, string[]> = {};

  for (const [date, entries] of Object.entries(storedDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(entries)) continue;
    const validEntries = entries.filter(
      (entry): entry is string => {
        if (typeof entry !== "string") return false;
        const [surah, ayah, extra] = entry.split(":").map(Number);
        return (
          extra === undefined &&
          Number.isInteger(surah) &&
          surah >= 1 &&
          surah <= 114 &&
          Number.isInteger(ayah) &&
          ayah >= 1 &&
          ayah <= 286
        );
      },
    );
    if (validEntries.length > 0) readByDate[date] = [...new Set(validEntries)];
  }

  return { dailyGoal, readByDate };
}

export function loadReadingProgress(storage?: ReadingStorage): ReadingProgress {
  try {
    const raw = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READING_PROGRESS;
    const parsed: unknown = JSON.parse(raw);
    return normalizeReadingProgress(parsed);
  } catch (error) {
    console.error("Could not load Quran reading progress.", error);
    return DEFAULT_READING_PROGRESS;
  }
}

export function saveReadingProgress(progress: ReadingProgress, storage?: ReadingStorage): void {
  (storage ?? window.localStorage).setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeReadingProgress(progress)),
  );
}

export function markAyahRead(
  progress: ReadingProgress,
  surah: number,
  ayah: number,
  date = new Date(),
): ReadingProgress {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    throw new RangeError("Surah number must be between 1 and 114.");
  }
  if (!Number.isInteger(ayah) || ayah < 1 || ayah > 286) {
    throw new RangeError("Ayah number must be between 1 and 286.");
  }

  const key = localDateKey(date);
  const readByDate = { ...progress.readByDate };
  const entries = new Set(readByDate[key] ?? []);
  entries.add(`${surah}:${ayah}`);
  readByDate[key] = [...entries];

  return { ...progress, readByDate };
}

export function setDailyReadingGoal(progress: ReadingProgress, goal: number): ReadingProgress {
  if (!Number.isInteger(goal) || goal < 1 || goal > 1000) {
    throw new RangeError("Daily reading goal must be between 1 and 1000 ayahs.");
  }
  return { ...progress, dailyGoal: goal };
}

export function readAyahCount(progress: ReadingProgress, date = new Date()): number {
  return new Set(progress.readByDate[localDateKey(date)] ?? []).size;
}
