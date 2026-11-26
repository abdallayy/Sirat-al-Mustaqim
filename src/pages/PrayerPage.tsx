import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  CITIES,
  dateInTimezone,
  formatCountdown,
  formatPrayerTime,
  METHODS,
  NAMES,
  nextPrayer,
  PRAYERS,
  prayerTimes,
  type CalculationMethod,
} from "../lib/prayer";
import {
  completedPrayerCount,
  currentPrayerWindow,
  dateKeyInTimezone,
  DEFAULT_PRAYER_LOG,
  loadPrayerLog,
  markPrayerComplete,
  prayerStreak,
  savePrayerLog,
  type PrayerLog,
} from "../lib/prayer-tracking";
import {
  disablePushNotifications,
  enablePushNotifications,
  hasCustomAdhan,
  isPushConfigured,
  isPushEnabled,
  loadPrayerSettings,
  notificationPermission,
  playPrayerAudio,
  removeCustomAdhan,
  requestNotificationPermission,
  saveCustomAdhan,
  savePrayerSettings,
  showTestNotification,
  stopPrayerAudio,
  type PrayerSettings,
} from "../lib/notify";

type Props = {
  onError: (message: string) => void;
};

function useCurrentTime(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`prayer-switch${checked ? " checked" : ""}`}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

function SettingCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="prayer-settings-card">
      <header>
        <h2>{title}</h2>
        <p className="prayer-card-description">{description}</p>
      </header>
      {children}
    </section>
  );
}

export default function PrayerPage({ onError }: Props) {
  const now = useCurrentTime();
  const [settings, setSettings] = useState<PrayerSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [permission, setPermission] = useState(notificationPermission);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [hasAdhan, setHasAdhan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prayerLog, setPrayerLog] = useState<PrayerLog>(DEFAULT_PRAYER_LOG);
  const [trackerReady, setTrackerReady] = useState(false);
  const [trackerError, setTrackerError] = useState("");

  useEffect(() => {
    try {
      setPrayerLog(loadPrayerLog());
      setTrackerReady(true);
    } catch (error) {
      console.error("Could not load the prayer completion log.", error);
      setTrackerError("تعذر تحميل سجل الصلوات المحفوظ على هذا الجهاز.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadPrayerSettings(), isPushEnabled(), hasCustomAdhan()])
      .then(([loaded, push, adhan]) => {
        if (!active) return;
        setSettings(loaded);
        setPushEnabled(push);
        setHasAdhan(adhan);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "تعذر تحميل إعدادات الصلاة.");
      });
    return () => {
      active = false;
    };
  }, []);

  const date = settings ? dateInTimezone(settings.timezone, now) : null;
  const times = useMemo(
    () => settings && date ? prayerTimes(settings, date.year, date.month, date.day) : null,
    [settings, date?.year, date?.month, date?.day],
  );
  const upcoming = settings ? nextPrayer(settings, now) : null;
  const prayerWindow = settings ? currentPrayerWindow(settings, now) : null;
  const todayKey = settings ? dateKeyInTimezone(settings.timezone, now) : "";

  function recordPrayer(prayer: (typeof PRAYERS)[number]) {
    if (!settings || !trackerReady) return;
    try {
      const updated = markPrayerComplete(prayerLog, settings, prayer, now);
      savePrayerLog(updated);
      setPrayerLog(updated);
      setTrackerError("");
    } catch (error) {
      console.error("Could not record the completed prayer.", error);
      setTrackerError(
        error instanceof RangeError
          ? "انتهت مهلة تسجيل هذه الصلاة عند دخول الصلاة التالية."
          : "تعذر حفظ تسجيل الصلاة على هذا الجهاز.",
      );
    }
  }

  async function updateSettings(update: (current: PrayerSettings) => PrayerSettings) {
    if (!settings) return;
    const next = update(structuredClone(settings));
    setSettings(next);
    setMessage("");
    try {
      await savePrayerSettings(next);
      setMessage("حُفظت الإعدادات على هذا الجهاز.");
    } catch (error) {
      console.error("Could not save prayer settings.", error);
      setMessage(
        `تعذر حفظ الإعدادات أو مزامنتها: ${error instanceof Error ? error.message : "خطأ غير معروف"}`,
      );
    }
  }

  async function askForPermission() {
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
      setMessage(
        result === "granted"
          ? "تم السماح بالإشعارات."
          : result === "denied"
            ? "تم رفض الإذن. غيّر إعداد الإشعارات من صلاحيات الموقع في المتصفح."
            : "الإشعارات غير مدعومة في هذا المتصفح.",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر طلب إذن الإشعارات.");
    }
  }

  async function testNotification() {
    if (!settings) return;
    try {
      const shown = await showTestNotification(settings);
      setMessage(shown ? "أُرسل الإشعار التجريبي." : "امنح إذن الإشعارات أولاً.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر إرسال الإشعار التجريبي.");
    }
  }

  async function useDeviceLocation() {
    if (!navigator.geolocation) {
      setMessage("تحديد الموقع غير مدعوم؛ اختر مدينة من القائمة.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        void updateSettings((current) => ({
          ...current,
          cityId: "gps",
          cityName: "موقعي الحالي",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timezone,
        })).finally(() => setBusy(false));
      },
      (error) => {
        setBusy(false);
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? "لم يُسمح بالوصول للموقع. اختر مدينة يدويًا أو اسمح للموقع من إعدادات المتصفح."
            : "تعذر تحديد الموقع الآن؛ تحقق من اتصال الجهاز ثم أعد المحاولة.",
        );
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  }

  async function togglePush() {
    if (!settings) return;
    setBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
        setMessage("تم إيقاف إشعارات الخلفية على هذا الجهاز.");
      } else {
        if (permission !== "granted") {
          setMessage("اسمح بالإشعارات أولاً، ثم فعّل Push.");
          return;
        }
        await enablePushNotifications(settings);
        setPushEnabled(true);
        setMessage("تم تفعيل إشعارات الخلفية.");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر تغيير إعداد Push.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAdhan(file: File | undefined) {
    if (!file) return;
    try {
      await saveCustomAdhan(file);
      setHasAdhan(true);
      setMessage("تم حفظ الملف الصوتي على هذا الجهاز.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر حفظ الملف الصوتي.");
    }
  }

  async function deleteAdhan() {
    try {
      await removeCustomAdhan();
      setHasAdhan(false);
      setMessage("تم حذف الملف الصوتي المخصص.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر حذف الملف الصوتي.");
    }
  }

  async function tryAudio() {
    try {
      const kind = await playPrayerAudio();
      setMessage(kind === "custom" ? "جرى تشغيل ملفك الصوتي." : "جرى تشغيل نغمة اختبار قصيرة، وليست تسجيل أذان.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "تعذر تشغيل الصوت.");
    }
  }

  if (loadError) {
    return <div className="prayer-error" role="alert"><strong>تعذر تحميل الإعدادات</strong><span>{loadError}</span></div>;
  }
  if (!settings || !times || !upcoming) {
    return <div className="prayer-loading"><span className="spinner" /> جارٍ تجهيز مواقيت الصلاة…</div>;
  }

  return (
    <section className="section-page prayer-page">
      <div className="section-heading">
        <span className="eyebrow">عبادةٌ على وقتها</span>
        <h1>مواقيت الصلاة</h1>
        <p>أوقات تقديرية بحسب موقعك وطريقة الحساب المختارة؛ تحقّق من التقويم الرسمي المحلي.</p>
      </div>

      <div className="next-prayer-panel">
        <div>
          <span className="prayer-kicker">الصلاة القادمة · {settings.cityName}</span>
          <h2>{NAMES[upcoming.prayer]}</h2>
          <span className="prayer-time">{formatPrayerTime(upcoming.at, settings.timezone)}</span>
        </div>
        <div className="countdown-block">
          <span>الوقت المتبقي</span>
          <strong dir="ltr">{Number.isFinite(upcoming.at) ? formatCountdown(upcoming.at - now) : "—"}</strong>
        </div>
      </div>

      <section className="prayer-tracker-card" aria-label="سجل الصلوات والاستريك">
        <div className="prayer-tracker-heading">
          <div>
            <span className="eyebrow">متابعة يومية</span>
            <h2>صلوات اليوم</h2>
          </div>
          <div className="prayer-streak"><strong>{prayerStreak(prayerLog, todayKey).toLocaleString("ar")}</strong><span>يوم استريك</span></div>
        </div>
        <p className="prayer-help">
          سجّل الصلاة بعد أدائها، قبل دخول وقت الصلاة التالية. الاستريك يُحسب عند إكمال الصلوات الخمس.
        </p>
        <div className="prayer-tracker-progress">
          <strong>{completedPrayerCount(prayerLog, todayKey).toLocaleString("ar")} / ٥</strong>
          <span>صلوات مسجلة اليوم</span>
        </div>
        {trackerError && <p className="devotion-error" role="alert">{trackerError}</p>}
        <div className="prayer-tracker-list">
          {PRAYERS.map((prayer) => {
            const completed = (prayerLog.completedByDate[todayKey] ?? []).includes(prayer);
            const isActive = prayerWindow?.dateKey === todayKey && prayerWindow.prayer === prayer;
            const prayerAt = times?.[prayer];
            const status = completed
              ? "تم التسجيل"
              : isActive
                ? "مهلة التسجيل مفتوحة"
                : prayerAt !== undefined && Number.isFinite(prayerAt) && prayerAt < now
                  ? "انتهت مهلة التسجيل"
                  : "لم يحن الوقت بعد";
            return (
              <div className={`prayer-tracker-row${completed ? " completed" : ""}${isActive ? " active" : ""}`} key={prayer}>
                <span>{NAMES[prayer]}</span>
                <small>{status}</small>
                {completed ? (
                  <span className="prayer-tracker-check" aria-label="تم التسجيل">✓</span>
                ) : (
                  <button
                    className="prayer-action-button"
                    disabled={!trackerReady || !isActive}
                    onClick={() => recordPrayer(prayer)}
                  >
                    صليت
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="prayer-times-card">
        {(["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const).map((prayer) => {
          const isUpcoming = prayer === upcoming.prayer;
          return (
            <div className={`prayer-time-row${isUpcoming ? " upcoming" : ""}`} key={prayer}>
              <span>{NAMES[prayer]}{isUpcoming && <small>القادمة</small>}</span>
              <time dir="ltr">{formatPrayerTime(times[prayer], settings.timezone)}</time>
            </div>
          );
        })}
        <div className="prayer-method-note">
          {METHODS[settings.method].name} · العصر {settings.asrFactor === 1 ? "بحساب الجمهور" : "بحساب الحنفية"} · {settings.timezone}
        </div>
        {PRAYERS.some((prayer) => !Number.isFinite(times[prayer])) && (
          <p className="prayer-limit-note">
            قد لا تصل الشمس إلى زاوية الفجر أو العشاء في بعض خطوط العرض والفصول؛ تظهر هذه الأوقات «—» بدل تقديرها. لا تُطبّق قواعد خطوط العرض العالية بعد.
          </p>
        )}
      </div>

      <div className="prayer-settings-grid">
        <SettingCard title="الموقع وحساب المواقيت" description="اختر مدينتك وطريقة الحساب التي تعتمدها.">
          <label className="prayer-field">
            <span>المدينة</span>
            <select
              value={settings.cityId}
              onChange={(event) => {
                const city = CITIES.find((item) => item.id === event.target.value);
                if (city) {
                  void updateSettings((current) => ({
                    ...current,
                    cityId: city.id,
                    cityName: city.name,
                    latitude: city.latitude,
                    longitude: city.longitude,
                    timezone: city.timezone,
                  }));
                }
              }}
            >
              {settings.cityId === "gps" && <option value="gps">موقعي الحالي</option>}
              {CITIES.map((city) => <option value={city.id} key={city.id}>{city.name}</option>)}
            </select>
          </label>
          <button className="prayer-action-button secondary prayer-location-button" onClick={() => void useDeviceLocation()} disabled={busy}>
            {busy ? "جارٍ تحديد موقعك…" : "استخدم موقعي الحالي"}
          </button>
          <label className="prayer-field">
            <span>طريقة الحساب</span>
            <select
              value={settings.method}
              onChange={(event) => {
                const method = (Object.keys(METHODS) as CalculationMethod[]).find((key) => key === event.target.value);
                if (method) void updateSettings((current) => ({ ...current, method }));
              }}
            >
              {Object.entries(METHODS).map(([key, method]) => <option value={key} key={key}>{method.name}</option>)}
            </select>
            <small className="prayer-field-help">تختلف الطرق في زوايا حساب الفجر والعشاء؛ اختر الطريقة المعتمدة في منطقتك.</small>
          </label>
          <label className="prayer-field">
            <span>حساب صلاة العصر</span>
            <select
              value={settings.asrFactor}
              onChange={(event) => {
                const asrFactor = Number(event.target.value) === 2 ? 2 : 1;
                void updateSettings((current) => ({ ...current, asrFactor }));
              }}
            >
              <option value={1}>الجمهور (الشافعي والمالكي والحنبلي)</option>
              <option value={2}>الحنفي</option>
            </select>
            <small className="prayer-field-help">اختر المذهب الذي تتبعه لحساب وقت العصر.</small>
          </label>
          <p className="prayer-help">الموقع الحالي يستخدم المنطقة الزمنية في جهازك. ويمكنك دائمًا اختيار مدينة يدويًا.</p>
        </SettingCard>

        <SettingCard title="تنبيهات الجهاز" description="تحكم في الإشعارات والصوت، ثم خصص كل صلاة عند الحاجة.">
          <div className="permission-row">
            <span>صلاحية الإشعارات</span>
            <strong className={`permission-state ${permission}`}>{permissionLabel(permission)}</strong>
          </div>
          {permission === "default" && <button className="prayer-action-button" onClick={() => void askForPermission()}>السماح بالإشعارات</button>}
          {permission === "denied" && <p className="prayer-help">الإذن محظور من المتصفح. افتح صلاحيات الموقع في إعداداته واسمح بالإشعارات، ثم أعد تحميل الصفحة.</p>}
          {permission === "unsupported" && <p className="prayer-help">هذا المتصفح لا يدعم إشعارات الويب.</p>}
          <button className="prayer-action-button secondary" onClick={() => void testNotification()} disabled={permission !== "granted"}>إرسال إشعار تجريبي</button>
          <div className="prayer-global-options">
            <div className="prayer-toggle-row">
              <span className="prayer-toggle-copy"><strong>صوت الإشعار</strong><small>تشغيل الصوت أو الأذان المخصص</small></span>
              <Switch checked={settings.sound} label="تشغيل صوت الإشعارات" onChange={() => void updateSettings((current) => ({ ...current, sound: !current.sound }))} />
            </div>
            <div className="prayer-toggle-row">
              <span className="prayer-toggle-copy"><strong>الاهتزاز</strong><small>إذا كان جهازك يدعمه</small></span>
              <Switch checked={settings.vibrate} label="تشغيل الاهتزاز" onChange={() => void updateSettings((current) => ({ ...current, vibrate: !current.vibrate }))} />
            </div>
          </div>

          <details className="prayer-option-details">
            <summary className="prayer-settings-summary">
              <span><strong>تخصيص تنبيه كل صلاة</strong><small>وقت التذكير، إشعار الموعد، والصوت</small></span>
              <span className="prayer-details-count">٦ صلوات</span>
            </summary>
            <div className="prayer-alert-grid">
              {PRAYERS.map((prayer) => {
                const alert = settings.alerts[prayer];
                return (
                  <div className="prayer-alert-card" key={prayer}>
                    <div className="prayer-alert-heading">
                      <span className="prayer-toggle-copy"><strong>صلاة {NAMES[prayer]}</strong><small>{alert.enabled ? "التنبيه مفعّل" : "التنبيه متوقف"}</small></span>
                      <Switch
                        checked={alert.enabled}
                        label={`تفعيل تنبيهات صلاة ${NAMES[prayer]}`}
                        onChange={() => void updateSettings((current) => ({
                          ...current,
                          alerts: { ...current.alerts, [prayer]: { ...current.alerts[prayer], enabled: !alert.enabled } },
                        }))}
                      />
                    </div>
                    {alert.enabled && (
                      <>
                        <label className="prayer-field compact-field">
                          <span>التذكير قبل الصلاة</span>
                          <select
                            value={alert.beforeMinutes}
                            onChange={(event) => {
                              const beforeMinutes = Number(event.target.value);
                              void updateSettings((current) => ({
                                ...current,
                                alerts: { ...current.alerts, [prayer]: { ...current.alerts[prayer], beforeMinutes } },
                              }));
                            }}
                          >
                            {[0, 5, 10, 15, 20, 30, 45, 60].map((minutes) => (
                              <option value={minutes} key={minutes}>{minutes === 0 ? "بدون تذكير" : `قبل ${minutes} دقيقة`}</option>
                            ))}
                          </select>
                        </label>
                        <div className="prayer-toggle-row">
                          <span>إشعار عند دخول الوقت</span>
                          <Switch
                            checked={alert.atPrayerTime}
                            label={`إشعار عند صلاة ${NAMES[prayer]}`}
                            onChange={() => void updateSettings((current) => ({
                              ...current,
                              alerts: { ...current.alerts, [prayer]: { ...current.alerts[prayer], atPrayerTime: !alert.atPrayerTime } },
                            }))}
                          />
                        </div>
                        {alert.atPrayerTime && (
                          <div className="prayer-toggle-row">
                            <span>تشغيل الصوت مع الإشعار</span>
                            <Switch
                              checked={alert.playAdhan}
                              label={`تشغيل الصوت عند صلاة ${NAMES[prayer]}`}
                              onChange={() => void updateSettings((current) => ({
                                ...current,
                                alerts: { ...current.alerts, [prayer]: { ...current.alerts[prayer], playAdhan: !alert.playAdhan } },
                              }))}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </details>

          <details className="prayer-option-details">
            <summary className="prayer-settings-summary">
              <span><strong>صوت مخصص للإشعارات</strong><small>{hasAdhan ? "يوجد ملف محفوظ على هذا الجهاز" : "اختياري · لا يوجد ملف محفوظ"}</small></span>
            </summary>
            <div className="adhan-upload">
              <p>اختر تسجيلًا تملك حق استخدامه. يُحفظ على هذا الجهاز فقط (حد 20 ميغابايت).</p>
              <input type="file" accept="audio/*" aria-label="اختر ملف أذان" onChange={(event) => void uploadAdhan(event.target.files?.[0])} />
              <div className="adhan-actions">
                <button className="prayer-action-button secondary" onClick={() => void tryAudio()}>تجربة الصوت</button>
                <button className="prayer-action-button secondary" onClick={stopPrayerAudio}>إيقاف الصوت</button>
                {hasAdhan && <button className="prayer-action-button destructive" onClick={() => void deleteAdhan()}>حذف الملف</button>}
              </div>
              <small>{hasAdhan ? "ملف مخصص محفوظ" : "بدون ملف مخصص، التجربة نغمة قصيرة وليست أذانًا."}</small>
            </div>
          </details>
        </SettingCard>

        <SettingCard title="التنبيهات عند إغلاق التطبيق" description="اختياري — يحتاج إلى خادم Push مُعدّ مسبقًا.">
          <p className="prayer-help">
            الإشعارات العادية تعمل أثناء فتح التطبيق. لإرسالها بعد إغلاق المتصفح، فعّل هذا الخيار إذا كان الخادم مُعدًّا.
          </p>
          {isPushConfigured() ? (
            <button
              className={`prayer-action-button${pushEnabled ? " secondary" : ""}`}
              disabled={busy || permission !== "granted"}
              onClick={() => void togglePush()}
            >
              {busy ? "جارٍ التحديث…" : pushEnabled ? "إيقاف التنبيهات بالخلفية" : "تفعيل التنبيهات بالخلفية"}
            </button>
          ) : (
            <div className="push-not-configured">
              خادم Push غير مضبوط. ستظل الإشعارات المحلية متاحة عند فتح التطبيق.
            </div>
          )}
          <p className="prayer-help">يتطلب ذلك خادم HTTPS ومفاتيح VAPID؛ التفاصيل التقنية في README.</p>
        </SettingCard>
      </div>
      {message && <p className="prayer-status" role="status">{message}</p>}
      <p className="prayer-disclaimer">الحساب الفلكي للتوجيه فقط. قد تختلف الدقائق بين الجهات الرسمية والمذاهب والمناطق؛ اعتمد التقويم المحلي عند الحاجة.</p>
    </section>
  );
}

function permissionLabel(permission: NotificationPermission | "unsupported"): string {
  return {
    granted: "مسموح",
    denied: "محظور",
    default: "لم يُطلب",
    unsupported: "غير مدعوم",
  }[permission];
}
