export type Ayah = {
  numberInSurah: number;
  text: string;
  juz: number;
  page: number;
};

export type Surah = {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  revelationType: "Meccan" | "Medinan";
  ayahs: Ayah[];
};

export type Quran = Surah[];

type QuranFile = {
  metadata: {
    source: string;
    copyright: string;
    license: string;
    url: string;
    notice: string;
  };
  surahs: Quran;
};

export type Hadith = {
  hadithnumber: number;
  text: string;
  reference?: {
    book?: number;
    hadith?: number;
  };
};

export type HadithCollection = {
  metadata?: {
    name?: string;
    section?: Record<string, string>;
  };
  hadiths: Hadith[];
};

const requestCache = new Map<string, Promise<unknown>>();
const APP_BASE_URL = import.meta.env?.BASE_URL ?? "/";

function loadJson<T>(path: string): Promise<T> {
  const cached = requestCache.get(path);
  if (cached) return cached as Promise<T>;

  const request = fetch(path).then(async (response) => {
    if (!response.ok) {
      throw new Error(`تعذر تحميل البيانات (${response.status}): ${path}`);
    }
    return (await response.json()) as T;
  });
  requestCache.set(path, request);
  void request.catch(() => {
    if (requestCache.get(path) === request) requestCache.delete(path);
  });
  return request;
}

export function loadQuran(): Promise<Quran> {
  return loadJson<QuranFile>(`${APP_BASE_URL}data/quran.json`).then((data) => data.surahs);
}

export function loadHadith(collection: "bukhari" | "muslim"): Promise<HadithCollection> {
  return loadJson<HadithCollection>(`${APP_BASE_URL}data/hadith-${collection}.json`);
}

export function normalizeArabic(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .trim()
    .toLocaleLowerCase();
}

export function readStoredList(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(stored) && stored.every((item) => typeof item === "string")
      ? stored
      : [];
  } catch (error) {
    console.error(`Could not read saved items "${key}".`, error);
    return [];
  }
}

export function writeStoredList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch (error) {
    console.error(`Could not save items "${key}".`, error);
  }
}

export function readLastRead(): { surah: number; ayah: number } | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem("sirat.last-read") ?? "null");
    if (
      typeof stored === "object" &&
      stored !== null &&
      "surah" in stored &&
      "ayah" in stored &&
      typeof stored.surah === "number" &&
      typeof stored.ayah === "number"
    ) {
      return { surah: stored.surah, ayah: stored.ayah };
    }
  } catch (error) {
    console.error("Could not read the last reading position.", error);
  }
  return null;
}

export function writeLastRead(surah: number, ayah: number): void {
  try {
    localStorage.setItem("sirat.last-read", JSON.stringify({ surah, ayah }));
  } catch (error) {
    console.error("Could not save the last reading position.", error);
  }
}
