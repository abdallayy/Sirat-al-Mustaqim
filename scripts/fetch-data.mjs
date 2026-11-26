import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(root, "public", "data");
const output = async (name, value) =>
  writeFile(resolve(dataDirectory, name), `${JSON.stringify(value)}\n`, "utf8");

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}

await mkdir(dataDirectory, { recursive: true });

const quranResponse = await getJson("https://api.alquran.cloud/v1/quran/quran-uthmani");
const sourceSurahs = quranResponse?.data?.surahs;
if (!Array.isArray(sourceSurahs)) throw new Error("Quran source returned an invalid response.");

const quran = sourceSurahs.map((surah) => ({
  number: surah.number,
  name: surah.name,
  englishName: surah.englishName,
  englishNameTranslation: surah.englishNameTranslation,
  revelationType: surah.revelationType,
  ayahs: surah.ayahs.map((ayah) => ({
    numberInSurah: ayah.numberInSurah,
    text: ayah.text,
    juz: ayah.juz,
    page: ayah.page,
  })),
}));
const ayahCount = quran.reduce((sum, surah) => sum + surah.ayahs.length, 0);
if (quran.length !== 114 || ayahCount !== 6236) {
  throw new Error(`Quran integrity check failed: ${quran.length} surahs, ${ayahCount} ayahs.`);
}
await output("quran.json", {
  metadata: {
    source: "Tanzil Project via AlQuran Cloud (quran-uthmani edition)",
    copyright: "Tanzil Quran Text Copyright (C) 2007-2021 Tanzil Project",
    license: "Creative Commons Attribution 3.0",
    url: "https://tanzil.net",
    notice: "Quran text is included verbatim and must not be changed.",
  },
  surahs: quran,
});
console.log(`Quran verified: ${quran.length} surahs, ${ayahCount} ayahs.`);

for (const [edition, filename] of [
  ["ara-bukhari", "hadith-bukhari.json"],
  ["ara-muslim", "hadith-muslim.json"],
]) {
  const response = await getJson(
    `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${edition}.min.json`,
  );
  const sourceHadiths = response?.hadiths;
  const sections = response?.metadata?.sections;
  if (
    !Array.isArray(sourceHadiths) ||
    sourceHadiths.length < 1000 ||
    sourceHadiths.some((hadith) => !Number.isFinite(hadith?.hadithnumber)) ||
    typeof sections !== "object" ||
    sections === null ||
    Array.isArray(sections)
  ) {
    throw new Error(`${edition} integrity check failed.`);
  }
  const hadiths = sourceHadiths.filter((hadith) => typeof hadith.text === "string" && hadith.text.trim());
  await output(filename, {
    metadata: {
      name: response.metadata?.name ?? edition,
      section: sections,
    },
    hadiths: hadiths.map(({ hadithnumber, text, reference }) => ({
      hadithnumber,
      text,
      reference,
    })),
  });
  console.log(
    `${response.metadata?.name ?? edition} verified: ${hadiths.length} narrations` +
      (hadiths.length < sourceHadiths.length ? ` (${sourceHadiths.length - hadiths.length} empty records omitted).` : "."),
  );
}
