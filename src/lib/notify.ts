import { del, get, set } from "idb-keyval";
import {
  CITIES,
  dateInTimezone,
  METHODS,
  NAMES,
  PRAYERS,
  prayerTimes,
  type CalculationMethod,
  type LocationSettings,
  type PrayerKey,
} from "./prayer";

export type PrayerAlert = {
  enabled: boolean;
  beforeMinutes: number;
  atPrayerTime: boolean;
  playAdhan: boolean;
};

export type PrayerSettings = LocationSettings & {
  cityId: string;
  cityName: string;
  sound: boolean;
  vibrate: boolean;
  alerts: Record<PrayerKey, PrayerAlert>;
};

export type PrayerEvent = {
  id: string;
  at: number;
  title: string;
  body: string;
  playAdhan: boolean;
};

const settingsKey = "sirat.prayer-settings";
const firedKey = "sirat.fired-prayer-alerts";
const adhanKey = "sirat.custom-adhan";
const pushKey = "sirat.push-enabled";
const DEFAULT_ALERT: PrayerAlert = {
  enabled: true,
  beforeMinutes: 10,
  atPrayerTime: true,
  playAdhan: false,
};

export const DEFAULT_SETTINGS: PrayerSettings = {
  cityId: "cairo",
  cityName: "القاهرة",
  latitude: 30.0444,
  longitude: 31.2357,
  timezone: "Africa/Cairo",
  method: "egypt",
  asrFactor: 1,
  sound: true,
  vibrate: true,
  alerts: {
    fajr: { ...DEFAULT_ALERT, beforeMinutes: 20, playAdhan: true },
    dhuhr: { ...DEFAULT_ALERT, beforeMinutes: 10 },
    asr: { ...DEFAULT_ALERT, beforeMinutes: 15, playAdhan: true },
    maghrib: { ...DEFAULT_ALERT, beforeMinutes: 10, playAdhan: true },
    isha: { ...DEFAULT_ALERT, beforeMinutes: 20 },
  },
};

const validBoolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const validMinutes = (value: unknown, fallback: number) =>
  typeof value === "number" && [0, 5, 10, 15, 20, 30, 45, 60].includes(value)
    ? value
    : fallback;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSettings(value: unknown): PrayerSettings {
  if (!isRecord(value)) return DEFAULT_SETTINGS;
  const city = CITIES.find((item) => item.id === value.cityId);
  const timezone = typeof value.timezone === "string" ? value.timezone : DEFAULT_SETTINGS.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return DEFAULT_SETTINGS;
  }
  const latitude =
    typeof value.latitude === "number" && Math.abs(value.latitude) <= 90
      ? value.latitude
      : city?.latitude ?? DEFAULT_SETTINGS.latitude;
  const longitude =
    typeof value.longitude === "number" && Math.abs(value.longitude) <= 180
      ? value.longitude
      : city?.longitude ?? DEFAULT_SETTINGS.longitude;
  const method =
    typeof value.method === "string" && value.method in METHODS
      ? (value.method as CalculationMethod)
      : DEFAULT_SETTINGS.method;
  const asrFactor = value.asrFactor === 2 ? 2 : 1;
  const storedAlerts = isRecord(value.alerts) ? value.alerts : {};
  const alerts = Object.fromEntries(
    PRAYERS.map((prayer) => {
      const current = isRecord(storedAlerts[prayer]) ? storedAlerts[prayer] : {};
      const fallback = DEFAULT_SETTINGS.alerts[prayer];
      return [
        prayer,
        {
          enabled: validBoolean(current.enabled, fallback.enabled),
          beforeMinutes: validMinutes(current.beforeMinutes, fallback.beforeMinutes),
          atPrayerTime: validBoolean(current.atPrayerTime, fallback.atPrayerTime),
          playAdhan: validBoolean(current.playAdhan, fallback.playAdhan),
        },
      ];
    }),
  ) as Record<PrayerKey, PrayerAlert>;

  return {
    cityId: typeof value.cityId === "string" ? value.cityId : DEFAULT_SETTINGS.cityId,
    cityName: typeof value.cityName === "string" ? value.cityName : city?.name ?? DEFAULT_SETTINGS.cityName,
    latitude,
    longitude,
    timezone,
    method,
    asrFactor,
    sound: validBoolean(value.sound, DEFAULT_SETTINGS.sound),
    vibrate: validBoolean(value.vibrate, DEFAULT_SETTINGS.vibrate),
    alerts,
  };
}

export async function loadPrayerSettings(): Promise<PrayerSettings> {
  const stored: unknown = await get(settingsKey);
  return mergeSettings(stored);
}

export async function savePrayerSettings(settings: PrayerSettings): Promise<void> {
  const validated = mergeSettings(settings);
  await set(settingsKey, validated);
  if (isPushConfigured() && (await get<boolean>(pushKey))) {
    await synchronizePush(validated);
  }
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildPrayerEvents(
  settings: PrayerSettings,
  days: number,
  now = Date.now(),
): PrayerEvent[] {
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new RangeError("Notification schedule must cover between 1 and 31 days.");
  }

  const { year, month, day } = dateInTimezone(settings.timezone, now);
  const events: PrayerEvent[] = [];
  for (let offset = -1; offset <= days + 1; offset += 1) {
    const civilDate = new Date(Date.UTC(year, month - 1, day + offset));
    const y = civilDate.getUTCFullYear();
    const m = civilDate.getUTCMonth() + 1;
    const d = civilDate.getUTCDate();
    const key = dateKey(y, m, d);
    const times = prayerTimes(settings, y, m, d);

    for (const prayer of PRAYERS) {
      const alert = settings.alerts[prayer];
      const at = times[prayer];
      if (!alert.enabled || !Number.isFinite(at)) continue;
      if (alert.beforeMinutes > 0) {
        events.push({
          id: `${key}:${prayer}:before:${alert.beforeMinutes}`,
          at: at - alert.beforeMinutes * 60_000,
          title: `اقترب موعد صلاة ${NAMES[prayer]}`,
          body: `بقي ${alert.beforeMinutes} دقيقة على صلاة ${NAMES[prayer]} في ${settings.cityName}.`,
          playAdhan: false,
        });
      }
      if (alert.atPrayerTime) {
        events.push({
          id: `${key}:${prayer}:at`,
          at,
          title: `حان موعد صلاة ${NAMES[prayer]}`,
          body: `حان الآن وقت صلاة ${NAMES[prayer]} في ${settings.cityName}.`,
          playAdhan: alert.playAdhan && settings.sound,
        });
      }
    }
  }
  return events
    .filter((event) => event.at > now - 15 * 60_000 && event.at < now + days * 86_400_000)
    .sort((left, right) => left.at - right.at);
}

let activeAudio: HTMLAudioElement | undefined;
let activeAudioUrl: string | undefined;

export function stopPrayerAudio(): void {
  activeAudio?.pause();
  activeAudio = undefined;
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = undefined;
}

export async function playPrayerAudio(): Promise<"custom" | "tone"> {
  const blob = await get<Blob>(adhanKey);
  stopPrayerAudio();
  if (blob) {
    activeAudioUrl = URL.createObjectURL(blob);
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.addEventListener("ended", stopPrayerAudio, { once: true });
    activeAudio.addEventListener("error", stopPrayerAudio, { once: true });
    try {
      await activeAudio.play();
      return "custom";
    } catch (error) {
      stopPrayerAudio();
      throw error;
    }
  }

  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) throw new Error("تشغيل الصوت غير مدعوم في هذا المتصفح.");
  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.35);
  await new Promise<void>((resolve) => oscillator.addEventListener("ended", () => resolve(), { once: true }));
  await context.close();
  return "tone";
}

export async function saveCustomAdhan(file: File): Promise<void> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("اختر ملفًا صوتيًا بصيغة مدعومة.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("حجم ملف الأذان يجب ألا يتجاوز 20 ميغابايت.");
  }
  await set(adhanKey, file);
}

export async function removeCustomAdhan(): Promise<void> {
  await del(adhanKey);
  stopPrayerAudio();
}

export async function hasCustomAdhan(): Promise<boolean> {
  return Boolean(await get<Blob>(adhanKey));
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export async function showPrayerNotification(
  event: PrayerEvent,
  settings: PrayerSettings,
): Promise<boolean> {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const options: NotificationOptions & { vibrate?: number[] } = {
    body: event.body,
    tag: event.id,
    icon: `${import.meta.env?.BASE_URL ?? "/"}icon.svg`,
    silent: !settings.sound,
    ...(settings.vibrate ? { vibrate: [180, 90, 180] } : {}),
  };
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(event.title, options);
  } else {
    new Notification(event.title, options);
  }
  if (event.playAdhan && settings.sound) {
    await playPrayerAudio();
  }
  return true;
}

export async function showTestNotification(settings: PrayerSettings): Promise<boolean> {
  return showPrayerNotification(
    {
      id: `test:${Date.now()}`,
      at: Date.now(),
      title: "اختبار إشعارات الصلاة",
      body: `الإشعارات مفعّلة لهذا الجهاز في ${settings.cityName}.`,
      playAdhan: false,
    },
    settings,
  );
}

type PushEvent = Pick<PrayerEvent, "id" | "at" | "title" | "body">;
const PUSH_SERVER = import.meta.env?.VITE_PUSH_SERVER as string | undefined;
const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function isPushConfigured(): boolean {
  return Boolean(PUSH_SERVER && VAPID_PUBLIC_KEY);
}

function decodeVapidKey(value: string): ArrayBuffer {
  const padded = (value + "====".slice((value.length % 4) || 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function postPush(path: string, body: unknown): Promise<void> {
  if (!PUSH_SERVER) throw new Error("لم يُضبط عنوان خادم الإشعارات.");
  const response = await fetch(new URL(path, PUSH_SERVER), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`تعذرت مزامنة الإشعارات مع الخادم (${response.status}).`);
  }
}

export async function enablePushNotifications(settings: PrayerSettings): Promise<void> {
  if (!PUSH_SERVER || !VAPID_PUBLIC_KEY) {
    throw new Error("إشعارات الخلفية غير مُعدّة. راجع تعليمات خادم Push.");
  }
  if (!("Notification" in window) || Notification.permission !== "granted") {
    throw new Error("امنح إذن الإشعارات لهذا الموقع أولاً.");
  }
  const registration = await navigator.serviceWorker?.ready;
  if (!registration || !("pushManager" in registration)) {
    throw new Error("إشعارات الخلفية تتطلب Service Worker في نسخة الإنتاج.");
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(VAPID_PUBLIC_KEY),
  });
  await set(pushKey, true);
  try {
    await synchronizePush(settings, subscription);
  } catch (error) {
    await subscription.unsubscribe();
    await set(pushKey, false);
    throw error;
  }
}

export async function synchronizePush(
  settings: PrayerSettings,
  knownSubscription?: PushSubscription,
): Promise<void> {
  if (!PUSH_SERVER || !VAPID_PUBLIC_KEY || !(await get<boolean>(pushKey))) return;
  const registration = await navigator.serviceWorker?.ready;
  if (!registration) throw new Error("تعذر العثور على Service Worker لمزامنة الإشعارات.");
  const subscription = knownSubscription ?? (await registration.pushManager.getSubscription());
  if (!subscription) return;
  const payload = subscription.toJSON();
  if (!payload.endpoint || !payload.keys?.auth || !payload.keys.p256dh) {
    throw new Error("بيانات اشتراك Push غير مكتملة.");
  }
  const events: PushEvent[] = buildPrayerEvents(settings, 30).map(({ id, at, title, body }) => ({
    id,
    at,
    title,
    body,
  }));
  await postPush("/sync", { subscription: payload, events });
}

export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription();
  let remoteFailure: unknown;
  if (subscription && PUSH_SERVER) {
    try {
      await postPush("/unsync", { endpoint: subscription.endpoint });
    } catch (error) {
      remoteFailure = error;
    }
  }
  const [unsubscribed] = await Promise.all([
    subscription?.unsubscribe() ?? Promise.resolve(true),
    set(pushKey, false),
  ]);
  if (!unsubscribed) throw new Error("تعذر إلغاء اشتراك Push على هذا الجهاز.");
  if (remoteFailure) throw remoteFailure;
}

export async function isPushEnabled(): Promise<boolean> {
  return (await get<boolean>(pushKey)) === true;
}

let schedulerTimer: number | undefined;
let tickInProgress = false;

export function startPrayerScheduler(onError: (error: unknown) => void): void {
  if (schedulerTimer !== undefined) return;
  const tick = async () => {
    if (tickInProgress || !("Notification" in window) || Notification.permission !== "granted") return;
    tickInProgress = true;
    try {
      const settings = await loadPrayerSettings();
      const firedValue: unknown = await get(firedKey);
      const fired = isRecord(firedValue) ? firedValue : {};
      const now = Date.now();
      let changed = false;
      for (const event of buildPrayerEvents(settings, 2, now)) {
        if (event.at > now || now - event.at >= 10 * 60_000 || fired[event.id]) continue;
        try {
          const shown = await showPrayerNotification(event, settings);
          if (shown) {
            fired[event.id] = now;
            changed = true;
          }
        } catch (error) {
          onError(error);
        }
      }
      if (changed) {
        for (const [id, timestamp] of Object.entries(fired)) {
          if (typeof timestamp !== "number" || now - timestamp > 3 * 86_400_000) delete fired[id];
        }
        await set(firedKey, fired);
      }
    } catch (error) {
      onError(error);
    } finally {
      tickInProgress = false;
    }
  };
  void tick();
  schedulerTimer = window.setInterval(() => void tick(), 15_000);
}

export function stopPrayerScheduler(): void {
  if (schedulerTimer !== undefined) window.clearInterval(schedulerTimer);
  schedulerTimer = undefined;
}
