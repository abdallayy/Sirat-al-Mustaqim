export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerKey = (typeof PRAYERS)[number];
export type PrayerMoment = PrayerKey | "sunrise";
export type CalculationMethod = "egypt" | "mwl" | "makkah" | "karachi" | "isna";

export const NAMES: Record<PrayerMoment, string> = {
  fajr: "الفجر",
  sunrise: "الشروق",
  dhuhr: "الظهر",
  asr: "العصر",
  maghrib: "المغرب",
  isha: "العشاء",
};

export const METHODS: Record<CalculationMethod, { name: string; fajr: number; isha: number; ishaMinutes?: number }> = {
  egypt: { name: "الهيئة المصرية العامة للمساحة", fajr: 19.5, isha: 17.5 },
  mwl: { name: "رابطة العالم الإسلامي", fajr: 18, isha: 17 },
  makkah: { name: "أم القرى — مكة المكرمة", fajr: 18.5, isha: 0, ishaMinutes: 90 },
  karachi: { name: "جامعة العلوم الإسلامية — كراتشي", fajr: 18, isha: 18 },
  isna: { name: "أمريكا الشمالية — ISNA", fajr: 15, isha: 15 },
};

export type City = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export const CITIES: City[] = [
  { id: "cairo", name: "القاهرة", latitude: 30.0444, longitude: 31.2357, timezone: "Africa/Cairo" },
  { id: "giza", name: "الجيزة", latitude: 30.0131, longitude: 31.2089, timezone: "Africa/Cairo" },
  { id: "alex", name: "الإسكندرية", latitude: 31.2001, longitude: 29.9187, timezone: "Africa/Cairo" },
  { id: "mansoura", name: "المنصورة", latitude: 31.0409, longitude: 31.3785, timezone: "Africa/Cairo" },
  { id: "tanta", name: "طنطا", latitude: 30.7865, longitude: 31, timezone: "Africa/Cairo" },
  { id: "portsaid", name: "بورسعيد", latitude: 31.2653, longitude: 32.3019, timezone: "Africa/Cairo" },
  { id: "suez", name: "السويس", latitude: 29.9668, longitude: 32.5498, timezone: "Africa/Cairo" },
  { id: "asyut", name: "أسيوط", latitude: 27.1783, longitude: 31.1859, timezone: "Africa/Cairo" },
  { id: "luxor", name: "الأقصر", latitude: 25.6872, longitude: 32.6396, timezone: "Africa/Cairo" },
  { id: "aswan", name: "أسوان", latitude: 24.0889, longitude: 32.8998, timezone: "Africa/Cairo" },
  { id: "sharm", name: "شرم الشيخ", latitude: 27.9158, longitude: 34.33, timezone: "Africa/Cairo" },
  { id: "makkah", name: "مكة المكرمة", latitude: 21.3891, longitude: 39.8579, timezone: "Asia/Riyadh" },
  { id: "madinah", name: "المدينة المنورة", latitude: 24.4709, longitude: 39.6122, timezone: "Asia/Riyadh" },
  { id: "riyadh", name: "الرياض", latitude: 24.7136, longitude: 46.6753, timezone: "Asia/Riyadh" },
  { id: "dubai", name: "دبي", latitude: 25.2048, longitude: 55.2708, timezone: "Asia/Dubai" },
  { id: "istanbul", name: "إسطنبول", latitude: 41.0082, longitude: 28.9784, timezone: "Europe/Istanbul" },
  { id: "london", name: "لندن", latitude: 51.5074, longitude: -0.1278, timezone: "Europe/London" },
  { id: "new-york", name: "نيويورك", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York" },
  { id: "kuala-lumpur", name: "كوالالمبور", latitude: 3.139, longitude: 101.6869, timezone: "Asia/Kuala_Lumpur" },
  { id: "jakarta", name: "جاكرتا", latitude: -6.2088, longitude: 106.8456, timezone: "Asia/Jakarta" },
];

export type LocationSettings = {
  latitude: number;
  longitude: number;
  timezone: string;
  method: CalculationMethod;
  asrFactor: 1 | 2;
};

const radians = Math.PI / 180;
const sin = (degrees: number) => Math.sin(degrees * radians);
const cos = (degrees: number) => Math.cos(degrees * radians);
const tan = (degrees: number) => Math.tan(degrees * radians);
const asin = (value: number) => Math.asin(value) / radians;
const acos = (value: number) => Math.acos(value) / radians;
const atan2 = (y: number, x: number) => Math.atan2(y, x) / radians;
const acot = (value: number) => Math.atan(1 / value) / radians;

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function julianDay(year: number, month: number, day: number): number {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const century = Math.floor(year / 100);
  const correction = 2 - century + Math.floor(century / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    correction -
    1524.5
  );
}

function sunPosition(julian: number): { declination: number; equationOfTime: number } {
  const days = julian - 2451545;
  const meanAnomaly = modulo(357.529 + 0.98560028 * days, 360);
  const meanLongitude = modulo(280.459 + 0.98564736 * days, 360);
  const eclipticLongitude =
    modulo(meanLongitude + 1.915 * sin(meanAnomaly) + 0.02 * sin(2 * meanAnomaly), 360);
  const obliquity = 23.439 - 3.6e-7 * days;
  return {
    declination: asin(sin(obliquity) * sin(eclipticLongitude)),
    equationOfTime:
      meanLongitude / 15 -
      modulo(
        atan2(cos(obliquity) * sin(eclipticLongitude), cos(eclipticLongitude)) / 15,
        24,
      ),
  };
}

export function timezoneOffset(timezone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ) -
    Math.floor(date.getTime() / 1000) * 1000
  ) / 3_600_000;
}

export function dateInTimezone(timezone: string, timestamp: number): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(timestamp)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function validateLocation(location: LocationSettings, year: number, month: number, day: number): void {
  if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90) {
    throw new RangeError("Latitude must be between -90 and 90 degrees.");
  }
  if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
    throw new RangeError("Longitude must be between -180 and 180 degrees.");
  }
  if (!(location.method in METHODS)) {
    throw new RangeError("Choose a supported prayer-time calculation method.");
  }
  if (location.asrFactor !== 1 && location.asrFactor !== 2) {
    throw new RangeError("Asr factor must be 1 (standard) or 2 (Hanafi).");
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError("Prayer date must use integer year, month and day values.");
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError("Prayer date is outside the supported calendar range.");
  }
  new Intl.DateTimeFormat("en-US", { timeZone: location.timezone });
}

/**
 * Returns absolute timestamps for a local civil date. A NaN value means that
 * the sun does not reach that prayer's angle at this latitude and season.
 */
export function prayerTimes(
  location: LocationSettings,
  year: number,
  month: number,
  day: number,
): Record<PrayerMoment, number> {
  validateLocation(location, year, month, day);
  const method = METHODS[location.method];
  const utcOffset = timezoneOffset(
    location.timezone,
    new Date(Date.UTC(year, month - 1, day, 12)),
  );
  const julian = julianDay(year, month, day) - location.longitude / 360;
  const solarNoon = (fraction: number) =>
    modulo(12 - sunPosition(julian + fraction).equationOfTime, 24);
  const hourAngle = (angle: number, fraction: number, morning = false) => {
    const declination = sunPosition(julian + fraction).declination;
    const cosine =
      (-sin(angle) - sin(declination) * sin(location.latitude)) /
      (cos(declination) * cos(location.latitude));
    if (cosine > 1 || cosine < -1) return Number.NaN;
    const hours = acos(cosine) / 15;
    return solarNoon(fraction) + (morning ? -hours : hours);
  };
  const asrHourAngle = (fraction: number) => {
    const declination = sunPosition(julian + fraction).declination;
    const angle = -acot(location.asrFactor + tan(Math.abs(location.latitude - declination)));
    return hourAngle(angle, fraction);
  };

  let fractions = {
    fajr: 5 / 24,
    sunrise: 6 / 24,
    dhuhr: 0.5,
    asr: 13 / 24,
    maghrib: 18 / 24,
  };
  for (let iteration = 0; iteration < 2; iteration += 1) {
    fractions = {
      fajr: hourAngle(method.fajr, fractions.fajr, true) / 24,
      sunrise: hourAngle(0.833, fractions.sunrise, true) / 24,
      dhuhr: solarNoon(fractions.dhuhr) / 24,
      asr: asrHourAngle(fractions.asr) / 24,
      maghrib: hourAngle(0.833, fractions.maghrib) / 24,
    };
  }

  const localHour = (fraction: number) => fraction * 24 + utcOffset - location.longitude / 15;
  const maghrib = localHour(fractions.maghrib);
  const isha = method.ishaMinutes
    ? maghrib + method.ishaMinutes / 60
    : localHour(hourAngle(method.isha, 18 / 24, false) / 24);
  const timestamp = (hour: number) =>
    Math.round((Date.UTC(year, month - 1, day) + (hour - utcOffset) * 3_600_000) / 60_000) *
    60_000;

  return {
    fajr: timestamp(localHour(fractions.fajr)),
    sunrise: timestamp(localHour(fractions.sunrise)),
    dhuhr: timestamp(localHour(fractions.dhuhr)),
    asr: timestamp(localHour(fractions.asr)),
    maghrib: timestamp(maghrib),
    isha: timestamp(isha),
  };
}

export function nextPrayer(
  location: LocationSettings,
  now: number,
): { prayer: PrayerKey; at: number; today: Record<PrayerMoment, number> } {
  const { year, month, day } = dateInTimezone(location.timezone, now);
  const today = prayerTimes(location, year, month, day);
  for (const prayer of PRAYERS) {
    if (Number.isFinite(today[prayer]) && today[prayer] > now) {
      return { prayer, at: today[prayer], today };
    }
  }
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  const nextFajr = prayerTimes(
    location,
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
  ).fajr;
  return { prayer: "fajr", at: nextFajr, today };
}

export function formatPrayerTime(timestamp: number, timezone: string): string {
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(timestamp);
}

export function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "—";
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
}
