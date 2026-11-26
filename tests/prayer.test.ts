import assert from "node:assert/strict";
import test from "node:test";
import {
  CITIES,
  dateInTimezone,
  nextPrayer,
  prayerTimes,
  PRAYERS,
  timezoneOffset,
  type LocationSettings,
} from "../src/lib/prayer";
import { buildPrayerEvents, DEFAULT_SETTINGS } from "../src/lib/notify";
import {
  DEFAULT_READING_PROGRESS,
  loadReadingProgress,
  markAyahRead,
  normalizeReadingProgress,
  readAyahCount,
  saveReadingProgress,
  setDailyReadingGoal,
} from "../src/lib/reading";
import {
  currentPrayerWindow,
  markPrayerComplete,
  normalizePrayerLog,
  prayerStreak,
  type PrayerLog,
} from "../src/lib/prayer-tracking";
import { selectDailyItems } from "../src/lib/dhikr";
import { hijriDateLabel, qiblaBearing } from "../src/lib/qibla";
import { loadHadith } from "../src/data";
import { indexHadiths, normalizeHadithSearchText, searchHadiths } from "../src/lib/hadith-search";
import { QURAN_RECITERS, quranAudioUrl, quranQueueFromVerse } from "../src/lib/quran-audio";
import { buildQuranPages, findPageForVerse } from "../src/lib/quran-pages";
import type { Quran } from "../src/data";

const cairo: LocationSettings = {
  latitude: 30.0444,
  longitude: 31.2357,
  timezone: "Africa/Cairo",
  method: "egypt",
  asrFactor: 1,
};

test("provides 20 city presets and timezone offsets across daylight saving", () => {
  assert.equal(CITIES.length, 20);
  assert.equal(timezoneOffset("Europe/London", new Date("2026-01-15T12:00:00Z")), 0);
  assert.equal(timezoneOffset("Europe/London", new Date("2026-07-15T12:00:00Z")), 1);
});

test("calculates a chronologically ordered Cairo prayer day with timezone-aware times", () => {
  const times = prayerTimes(cairo, 2026, 11, 25);
  const ordered = [times.fajr, times.sunrise, times.dhuhr, times.asr, times.maghrib, times.isha];
  assert.ok(ordered.every(Number.isFinite));
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b));
  const localDate = dateInTimezone(cairo.timezone, times.dhuhr);
  assert.deepEqual(localDate, { year: 2026, month: 11, day: 25 });
  const fajrHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: cairo.timezone, hour: "2-digit" })
      .format(times.fajr),
  );
  assert.ok(fajrHour >= 4 && fajrHour <= 5, `Unexpected Cairo Fajr hour: ${fajrHour}`);
});

test("Hanafi Asr is later and next prayer rolls to tomorrow's Fajr", () => {
  const standard = prayerTimes(cairo, 2026, 11, 25).asr;
  const hanafi = prayerTimes({ ...cairo, asrFactor: 2 }, 2026, 11, 25).asr;
  assert.ok(hanafi > standard);

  const today = prayerTimes(cairo, 2026, 11, 25);
  const afterIsha = today.isha + 60_000;
  const next = nextPrayer(cairo, afterIsha);
  const tomorrow = prayerTimes(cairo, 2026, 11, 26).fajr;
  assert.equal(next.prayer, "fajr");
  assert.equal(next.at, tomorrow);
});

test("reports polar-season prayer angles that are not reached instead of fabricating times", () => {
  const london: LocationSettings = {
    latitude: 51.5074,
    longitude: -0.1278,
    timezone: "Europe/London",
    method: "mwl",
    asrFactor: 1,
  };
  const times = prayerTimes(london, 2026, 6, 21);
  assert.ok(Number.isNaN(times.fajr));
  assert.ok(Number.isNaN(times.isha));
});

test("builds ordered, unique notification events and honours disabled prayers", () => {
  const now = Date.now();
  const settings = structuredClone(DEFAULT_SETTINGS);
  const events = buildPrayerEvents(settings, 2, now);
  assert.ok(events.length > 0);
  assert.deepEqual(events.map((event) => event.at), [...events.map((event) => event.at)].sort((a, b) => a - b));
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);

  for (const prayer of Object.keys(settings.alerts) as Array<keyof typeof settings.alerts>) {
    settings.alerts[prayer].enabled = false;
  }
  assert.deepEqual(buildPrayerEvents(settings, 2, now), []);
});

test("notification pre-alerts use the requested offset and invalid horizons are rejected", () => {
  const now = Date.now();
  const settings = structuredClone(DEFAULT_SETTINGS);
  const events = buildPrayerEvents(settings, 3, now);
  const reminder = events.find((event) => event.id.endsWith(":fajr:before:20"));
  assert.ok(reminder);
  const prayer = events.find((event) => event.id === reminder.id.replace(":before:20", ":at"));
  assert.ok(prayer);
  assert.equal(prayer.at - reminder.at, 20 * 60_000);
  assert.throws(() => buildPrayerEvents(settings, 0, now), RangeError);
});

test("prayer check-ins are available only from that prayer until the next one", () => {
  const times = prayerTimes(cairo, 2026, 11, 25);
  const window = currentPrayerWindow(cairo, times.asr);
  assert.deepEqual(window, { prayer: "asr", dateKey: "2026-11-25" });
  assert.throws(
    () => markPrayerComplete({ completedByDate: {} }, cairo, "dhuhr", times.asr),
    RangeError,
  );
  const updated = markPrayerComplete({ completedByDate: {} }, cairo, "asr", times.asr);
  assert.deepEqual(updated.completedByDate["2026-11-25"], ["asr"]);

  const tomorrow = prayerTimes(cairo, 2026, 11, 26);
  assert.deepEqual(
    currentPrayerWindow(cairo, times.isha),
    { prayer: "isha", dateKey: "2026-11-25" },
  );
  assert.deepEqual(
    currentPrayerWindow(cairo, tomorrow.fajr),
    { prayer: "fajr", dateKey: "2026-11-26" },
  );
});

test("prayer streak counts only consecutive complete days and normalizes saved history", () => {
  const complete = [...PRAYERS];
  const log: PrayerLog = {
    completedByDate: {
      "2026-11-23": complete,
      "2026-11-24": complete,
      "2026-11-25": ["fajr", "dhuhr"],
      "2025-01-01": ["fajr"],
    },
  };
  assert.equal(prayerStreak(log, "2026-11-25"), 2);
  assert.deepEqual(
    normalizePrayerLog({ completedByDate: { ...log.completedByDate, "2026-11-22": ["invalid"] } })
      .completedByDate["2025-01-01"],
    ["fajr"],
  );
});

test("daily remembrance selection is stable for the date and changes by day or session", () => {
  const items = ["a", "b", "c", "d", "e"];
  const morning = selectDailyItems(items, "2026-11-25", "morning", 3);
  assert.deepEqual(selectDailyItems(items, "2026-11-25", "morning", 3), morning);
  assert.equal(new Set(morning).size, 3);
  assert.notDeepEqual(selectDailyItems(items, "2026-11-26", "morning", 3), morning);
  assert.notDeepEqual(selectDailyItems(items, "2026-11-25", "evening", 3), morning);
});

test("rejects invalid coordinates and time zones", () => {
  assert.throws(() => prayerTimes({ ...cairo, latitude: 91 }, 2026, 11, 25), RangeError);
  assert.throws(() => prayerTimes({ ...cairo, timezone: "Not/A_Timezone" }, 2026, 11, 25));
});

test("calculates Qibla bearings for known locations and rejects invalid coordinates", () => {
  const atKaaba = qiblaBearing({ latitude: 21.422487, longitude: 39.826206 });
  assert.ok(Math.min(atKaaba, 360 - atKaaba) < 0.001);
  assert.ok(Math.abs(qiblaBearing({ latitude: 51.5074, longitude: -0.1278 }) - 118.99) < 0.1);
  assert.throws(() => qiblaBearing({ latitude: 91, longitude: 0 }), RangeError);
});

test("formats a Hijri date when the runtime includes the Umm al-Qura calendar", () => {
  const label = hijriDateLabel(new Date("2026-11-25T12:00:00+02:00"));
  assert.equal(typeof label, "string");
  assert.match(label ?? "", /[٠-٩]/);
});

test("counts unique daily Quran reading and persists a bounded goal", () => {
  const date = new Date(2026, 10, 25, 12);
  const once = markAyahRead(DEFAULT_READING_PROGRESS, 2, 255, date);
  const repeated = markAyahRead(once, 2, 255, date);
  const twice = markAyahRead(repeated, 2, 256, date);
  assert.equal(readAyahCount(twice, date), 2);
  assert.equal(setDailyReadingGoal(twice, 30).dailyGoal, 30);
  assert.throws(() => setDailyReadingGoal(twice, 0), RangeError);
  assert.equal(normalizeReadingProgress({ dailyGoal: 5000 }).dailyGoal, 20);
});

test("retains Quran reading records older than 90 days", () => {
  const oldDate = new Date(2025, 0, 1, 12);
  const currentDate = new Date(2026, 10, 25, 12);
  const old = markAyahRead(DEFAULT_READING_PROGRESS, 1, 1, oldDate);
  const updated = markAyahRead(old, 2, 255, currentDate);
  assert.deepEqual(updated.readByDate["2025-01-01"], ["1:1"]);
  assert.deepEqual(updated.readByDate["2026-11-25"], ["2:255"]);
});

test("saves and reloads Quran reading progress through storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const date = new Date(2026, 10, 25);
  const progress = setDailyReadingGoal(markAyahRead(DEFAULT_READING_PROGRESS, 1, 1, date), 10);
  saveReadingProgress(progress, storage);
  assert.deepEqual(loadReadingProgress(storage), progress);
});

test("retries a failed text download after connectivity returns", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (_input) => {
    void _input;
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return new Response(JSON.stringify({ hadiths: [] }), { status: 200 });
  };
  try {
    await assert.rejects(loadHadith("muslim"), /offline/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const data = await loadHadith("muslim");
    assert.deepEqual(data.hadiths, []);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("groups Mushaf pages without changing verse order or global audio numbering", () => {
  const quran: Quran = [
    {
      number: 1,
      name: "الفاتحة",
      englishName: "Al-Fatiha",
      englishNameTranslation: "The Opening",
      revelationType: "Meccan",
      ayahs: [
        { numberInSurah: 1, text: "بسم الله", juz: 1, page: 1 },
        { numberInSurah: 2, text: "الحمد لله", juz: 1, page: 1 },
        { numberInSurah: 3, text: "الرحمن الرحيم", juz: 1, page: 2 },
      ],
    },
  ];
  const pages = buildQuranPages(quran);
  assert.deepEqual(pages.map((page) => page.number), [1, 2]);
  assert.deepEqual(pages[0].verses.map((verse) => verse.globalNumber), [1, 2]);
  assert.equal(findPageForVerse(pages, 1, 3), 2);
  assert.throws(() => findPageForVerse(pages, 1, 4), RangeError);

  const queue = quranQueueFromVerse(pages.flatMap((page) => page.verses), pages[0].verses[1]);
  assert.deepEqual(queue.map(({ ayah }) => ayah.numberInSurah), [2, 3]);
});

test("builds validated CDN URLs for supported Quran reciters", () => {
  assert.equal(QURAN_RECITERS.length, 6);
  assert.equal(
    quranAudioUrl("ar.alafasy", 1),
    "https://cdn.islamic.network/quran/audio/128/ar.alafasy/1.mp3",
  );
  assert.equal(
    quranAudioUrl("ar.abdurrahmaansudais", 1),
    "https://cdn.islamic.network/quran/audio/192/ar.abdurrahmaansudais/1.mp3",
  );
  assert.throws(() => quranAudioUrl("ar.alafasy", 0), RangeError);
});

test("continues ayah playback from the selected verse to the end of its surah", () => {
  const firstSurah: Quran = [
    {
      number: 1,
      name: "الفاتحة",
      englishName: "Al-Fatiha",
      englishNameTranslation: "The Opening",
      revelationType: "Meccan",
      ayahs: [
        { numberInSurah: 1, text: "آية ١", juz: 1, page: 1 },
        { numberInSurah: 2, text: "آية ٢", juz: 1, page: 1 },
        { numberInSurah: 3, text: "آية ٣", juz: 1, page: 1 },
      ],
    },
  ];
  const secondSurah = {
    ...firstSurah[0],
    number: 2,
    name: "البقرة",
    englishName: "Al-Baqara",
    ayahs: [{ numberInSurah: 1, text: "آية أخرى", juz: 1, page: 2 }],
  };
  const verses = buildQuranPages([...firstSurah, secondSurah]).flatMap((page) => page.verses);
  const queue = quranQueueFromVerse(verses, verses[1]);

  assert.deepEqual(queue.map(({ surah, ayah }) => `${surah.number}:${ayah.numberInSurah}`), ["1:2", "1:3"]);
});

test("searches hadith by normalized Arabic words and ranks phrase matches first", () => {
  const index = indexHadiths([
    { hadithnumber: 1, text: "إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ." },
    { hadithnumber: 2, text: "تكون النية مع الأعمال، وبالنيات يعرف القصد." },
    { hadithnumber: 3, text: "إن إقامة الصلاة من الخير." },
  ]);

  assert.equal(normalizeHadithSearchText("إقامة الصلاة"), "اقامه الصلاه");
  assert.deepEqual(
    searchHadiths(index, "الأعمال بالنيات").map(({ hadithnumber }) => hadithnumber),
    [1, 2],
  );
  assert.deepEqual(
    searchHadiths(index, "اقامة الصلاه").map(({ hadithnumber }) => hadithnumber),
    [3],
  );
});

test("searches hadith numbers in Arabic digits and with number labels", () => {
  const index = indexHadiths([
    { hadithnumber: 5027, text: "حديث في فضل القرآن." },
    { hadithnumber: 27, text: "حديث آخر." },
  ]);

  assert.deepEqual(searchHadiths(index, "٥٠٢٧").map(({ hadithnumber }) => hadithnumber), [5027]);
  assert.deepEqual(searchHadiths(index, "رقم الحديث ٢٧").map(({ hadithnumber }) => hadithnumber), [27]);
});
