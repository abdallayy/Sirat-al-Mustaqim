import type { Ayah, Quran, Surah } from "../data";

export type QuranPageVerse = {
  surah: Surah;
  ayah: Ayah;
  globalNumber: number;
};

export type QuranPage = {
  number: number;
  verses: QuranPageVerse[];
};

export function buildQuranPages(quran: Quran): QuranPage[] {
  const pages = new Map<number, QuranPage>();
  let globalNumber = 0;

  for (const surah of quran) {
    for (const ayah of surah.ayahs) {
      globalNumber += 1;
      if (!Number.isInteger(ayah.page) || ayah.page < 1 || ayah.page > 604) {
        throw new RangeError(`Invalid Mushaf page number at ${surah.number}:${ayah.numberInSurah}.`);
      }
      const page = pages.get(ayah.page) ?? { number: ayah.page, verses: [] };
      page.verses.push({ surah, ayah, globalNumber });
      pages.set(ayah.page, page);
    }
  }

  return [...pages.values()].sort((left, right) => left.number - right.number);
}

export function findPageForVerse(
  pages: QuranPage[],
  surahNumber: number,
  ayahNumber: number,
): number {
  for (const page of pages) {
    if (page.verses.some(({ surah, ayah }) =>
      surah.number === surahNumber && ayah.numberInSurah === ayahNumber,
    )) {
      return page.number;
    }
  }
  throw new RangeError(`Could not find Quran verse ${surahNumber}:${ayahNumber}.`);
}
