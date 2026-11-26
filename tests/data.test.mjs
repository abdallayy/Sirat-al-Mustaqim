import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataDirectory = resolve(import.meta.dirname, "../public/data");

async function load(name) {
  return JSON.parse(await readFile(resolve(dataDirectory, name), "utf8"));
}

test("Quran data contains all 114 surahs and 6,236 numbered ayahs", async () => {
  const data = await load("quran.json");
  const surahs = data.surahs;
  assert.equal(data.metadata.source, "Tanzil Project via AlQuran Cloud (quran-uthmani edition)");
  assert.equal(data.metadata.copyright, "Tanzil Quran Text Copyright (C) 2007-2021 Tanzil Project");
  assert.equal(data.metadata.license, "Creative Commons Attribution 3.0");
  assert.equal(data.metadata.url, "https://tanzil.net");
  assert.equal(surahs.length, 114);
  assert.equal(surahs.reduce((sum, surah) => sum + surah.ayahs.length, 0), 6236);
  assert.equal(surahs[0].name, "سُورَةُ ٱلْفَاتِحَةِ");
  assert.equal(surahs[0].ayahs.length, 7);
  assert.ok(surahs.every((surah, index) => surah.number === index + 1));
  assert.ok(surahs.every((surah) => surah.ayahs.every((ayah, index) => ayah.numberInSurah === index + 1)));
  const pageNumbers = new Set(surahs.flatMap((surah) => surah.ayahs.map((ayah) => ayah.page)));
  assert.equal(pageNumbers.size, 604);
  assert.ok([...pageNumbers].every((page) => Number.isInteger(page) && page >= 1 && page <= 604));
  assert.deepEqual(surahs[0].ayahs.map((ayah) => ayah.page), Array(7).fill(1));
});

for (const [collection, filename] of [
  ["Sahih al-Bukhari", "hadith-bukhari.json"],
  ["Sahih Muslim", "hadith-muslim.json"],
]) {
  test(`${collection} data has sourced, numbered Arabic narrations`, async () => {
    const data = await load(filename);
    assert.ok(data.hadiths.length > 1000);
    assert.equal(data.metadata.name.replace("al-", "al "), collection.replace("al-", "al "));
    assert.ok(Object.keys(data.metadata.section).length > 1);
    assert.ok(data.hadiths.every((hadith) => Number.isFinite(hadith.hadithnumber)));
    assert.ok(data.hadiths.every((hadith) => typeof hadith.text === "string" && hadith.text.trim().length > 0));
    assert.ok(data.hadiths.some((hadith) => Number.isInteger(hadith.reference?.book)));
    assert.ok(data.hadiths[0].hadithnumber > 0);
  });
}

test("featured Bukhari quotation matches its cited hadith number", async () => {
  const data = await load("hadith-bukhari.json");
  const hadith = data.hadiths.find((item) => item.hadithnumber === 5027);
  assert.ok(hadith);
  assert.ok(hadith.text.includes("خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ"));
});

test("the daily tasbih citation includes the cited Bukhari remembrance", async () => {
  const data = await load("hadith-bukhari.json");
  const hadith = data.hadiths.find((item) => item.hadithnumber === 6405);
  assert.ok(hadith);
  const normalized = hadith.text
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670-\u06ED\u0640]/g, "");
  assert.ok(normalized.includes("سبحان الله وبحمده"));
});
