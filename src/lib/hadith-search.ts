import type { Hadith } from "../data";

type IndexedHadith = {
  hadith: Hadith;
  normalizedText: string;
  words: string[];
  sourceIndex: number;
};

const NUMBER_LABELS = new Set(["حديث", "الحديث", "رقم"]);

export function normalizeHadithSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function indexHadiths(hadiths: Hadith[]): IndexedHadith[] {
  return hadiths.map((hadith, sourceIndex) => {
    const normalizedText = normalizeHadithSearchText(hadith.text);
    return {
      hadith,
      normalizedText,
      words: normalizedText.split(" "),
      sourceIndex,
    };
  });
}

export function searchHadiths(index: IndexedHadith[], rawQuery: string): Hadith[] {
  const query = normalizeHadithSearchText(rawQuery);
  if (!query) return index.map(({ hadith }) => hadith);

  const queryWords = query.split(" ");
  const numberWords = queryWords.filter((word) => /^\d+$/.test(word));
  const labelWords = queryWords.filter((word) => !/^\d+$/.test(word));
  if (
    numberWords.length === 1 &&
    labelWords.every((word) => NUMBER_LABELS.has(word))
  ) {
    const number = Number(numberWords[0]);
    if (Number.isSafeInteger(number)) {
      return index
        .filter(({ hadith }) => hadith.hadithnumber === number)
        .map(({ hadith }) => hadith);
    }
  }

  const results = index.flatMap((entry) => {
    const tokenScores = queryWords.map((token) => {
      if (entry.words.includes(token)) return 8;
      if (entry.words.some((word) => word.startsWith(token) || word.endsWith(token))) return 5;
      if (entry.words.some((word) => word.includes(token))) return 2;
      return 0;
    });
    if (tokenScores.some((score) => score === 0)) return [];

    const phraseScore = entry.normalizedText === query
      ? 2000
      : entry.normalizedText.includes(query)
        ? 1000
        : 0;
    return [{
      hadith: entry.hadith,
      score: phraseScore + tokenScores.reduce<number>((sum, score) => sum + score, 0),
      sourceIndex: entry.sourceIndex,
    }];
  });

  return results
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map(({ hadith }) => hadith);
}
