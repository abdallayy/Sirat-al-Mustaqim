import type { QuranPageVerse } from "./quran-pages";

export const QURAN_RECITERS = [
  { id: "ar.alafasy", name: "مشاري العفاسي" },
  { id: "ar.abdurrahmaansudais", name: "عبدالرحمن السديس" },
  { id: "ar.husary", name: "محمود خليل الحصري" },
  { id: "ar.minshawi", name: "محمد صديق المنشاوي" },
  { id: "ar.mahermuaiqly", name: "ماهر المعيقلي" },
  { id: "ar.hudhaify", name: "علي الحذيفي" },
] as const;

export type QuranReciterId = (typeof QURAN_RECITERS)[number]["id"];

const RECITER_BITRATES: Record<QuranReciterId, number> = {
  "ar.alafasy": 128,
  "ar.abdurrahmaansudais": 192,
  "ar.husary": 128,
  "ar.minshawi": 128,
  "ar.mahermuaiqly": 128,
  "ar.hudhaify": 128,
};

export function quranQueueFromVerse(
  verses: QuranPageVerse[],
  start: QuranPageVerse,
): QuranPageVerse[] {
  return verses.filter(({ surah, ayah }) =>
    surah.number === start.surah.number && ayah.numberInSurah >= start.ayah.numberInSurah,
  );
}

export function quranAudioUrl(reciter: QuranReciterId, globalAyahNumber: number): string {
  if (!Number.isInteger(globalAyahNumber) || globalAyahNumber < 1 || globalAyahNumber > 6236) {
    throw new RangeError("Global Quran ayah number must be between 1 and 6236.");
  }
  return `https://cdn.islamic.network/quran/audio/${RECITER_BITRATES[reciter]}/${reciter}/${globalAyahNumber}.mp3`;
}

export function isQuranReciterId(value: string): value is QuranReciterId {
  return QURAN_RECITERS.some((reciter) => reciter.id === value);
}
