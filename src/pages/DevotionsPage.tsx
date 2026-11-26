import { useEffect, useMemo, useState } from "react";
import type { Quran } from "../data";
import { loadPrayerSettings } from "../lib/notify";
import { hijriDateLabel, qiblaBearing, type Coordinates } from "../lib/qibla";
import { localDateKey } from "../lib/reading";
import { selectDailyItems } from "../lib/dhikr";

type DevotionTab = "qibla" | "adhkar" | "calendar";
type DhikrSession = "morning" | "evening";
type DhikrCounts = Record<string, number>;
type DhikrItem = {
  id: string;
  title: string;
  target: number;
  source: string;
  surah?: number;
  start?: number;
  end?: number;
  text?: string;
  textBySession?: Record<DhikrSession, string>;
};

const DHIKR_TARGETS: DhikrItem[] = [
  { id: "kursi", title: "آية الكرسي", surah: 2, start: 255, end: 255, target: 1, source: "سورة البقرة · الآية ٢٥٥" },
  { id: "ikhlas", title: "سورة الإخلاص", surah: 112, start: 1, end: 4, target: 3, source: "سورة الإخلاص · ١–٤" },
  { id: "falaq", title: "سورة الفلق", surah: 113, start: 1, end: 5, target: 3, source: "سورة الفلق · ١–٥" },
  { id: "nas", title: "سورة الناس", surah: 114, start: 1, end: 6, target: 3, source: "سورة الناس · ١–٦" },
];

const EXTRA_DHIKR: DhikrItem[] = [
  {
    id: "sayyid-istighfar",
    title: "سيد الاستغفار",
    text: "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي، فَاغْفِرْ لِي، فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ",
    target: 1,
    source: "صحيح البخاري · ٦٣٠٦",
  },
  {
    id: "morning-evening-praise",
    title: "ذكر الصباح والمساء",
    textBySession: {
      morning: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ. رَبِّ أَسْأَلُكَ خَيْرَ مَا فِي هَذَا الْيَوْمِ وَخَيْرَ مَا بَعْدَهُ، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِي هَذَا الْيَوْمِ وَشَرِّ مَا بَعْدَهُ",
      evening: "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ. رَبِّ أَسْأَلُكَ خَيْرَ مَا فِي هَذِهِ اللَّيْلَةِ وَخَيْرَ مَا بَعْدَهَا، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِي هَذِهِ اللَّيْلَةِ وَشَرِّ مَا بَعْدَهَا",
    },
    target: 1,
    source: "صحيح مسلم · ٢٧٢٣",
  },
  {
    id: "wellbeing",
    title: "سؤال العفو والعافية",
    text: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ، اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي دِينِي وَدُنْيَايَ وَأَهْلِي وَمَالِي",
    target: 1,
    source: "سنن أبي داود · ٥٠٧٤",
  },
  {
    id: "protection",
    title: "الاستعاذة من الشر",
    text: "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
    target: 3,
    source: "صحيح مسلم · ٢٧٠٨",
  },
];

const TASBIH = {
  id: "tasbih",
  title: "التسبيح",
  text: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
  target: 100,
  source: "صحيح البخاري · ٦٤٠٥",
};

const ISTIGHFAR = {
  id: "istighfar",
  title: "الاستغفار",
  text: "أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ",
  target: 100,
  source: "صحيح مسلم · ٢٧٠٢",
};

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type CompassConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<string>;
};

export default function DevotionsPage({ quran, onError }: { quran: Quran; onError: (message: string) => void }) {
  const [tab, setTab] = useState<DevotionTab>("qibla");
  const [session, setSession] = useState<DhikrSession>("morning");
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationError, setLocationError] = useState("");
  const [heading, setHeading] = useState<number | null>(null);
  const [compassEnabled, setCompassEnabled] = useState(false);
  const [compassError, setCompassError] = useState("");
  const [counts, setCounts] = useState<DhikrCounts>({});
  const [countError, setCountError] = useState("");
  const [now, setNow] = useState(() => new Date());

  const countStorageKey = `sirat.dhikr.${localDateKey(now)}.${session}`;
  const dailyRandomDhikr = useMemo(
    () => selectDailyItems([...DHIKR_TARGETS, ...EXTRA_DHIKR], localDateKey(now), session, 3),
    [now, session],
  );
  const hijriLabel = useMemo(() => hijriDateLabel(now), [now]);
  const bearing = useMemo(() => (location ? qiblaBearing(location) : null), [location]);
  const relativeBearing = bearing === null ? 0 : (bearing - (heading ?? 0) + 360) % 360;

  useEffect(() => {
    let active = true;
    loadPrayerSettings()
      .then((settings) => {
        if (!active) return;
        setLocation({ latitude: settings.latitude, longitude: settings.longitude });
        setLocationName(settings.cityName);
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : "تعذر تحميل الموقع المحفوظ.");
      });
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onError]);

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(countStorageKey) ?? "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setCounts({});
        return;
      }
      const valid = Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0,
        ),
      );
      setCounts(valid);
      setCountError("");
    } catch (error) {
      console.error("Could not load daily remembrance counts.", error);
      setCounts({});
      setCountError("تعذر تحميل محفوظات العدّ لهذا اليوم.");
    }
  }, [countStorageKey]);

  useEffect(() => {
    if (!compassEnabled) return;
    let receivedHeading = false;
    const unavailableTimer = window.setTimeout(() => {
      if (!receivedHeading) {
        setCompassError("لم يوفر الجهاز اتجاهًا جغرافيًا من المستشعر؛ استخدم قيمة الدرجة من الشمال.");
        setCompassEnabled(false);
      }
    }, 5000);
    function onOrientation(event: Event) {
      if (!(event instanceof DeviceOrientationEvent)) return;
      const compassEvent = event as CompassEvent;
      const value =
        typeof compassEvent.webkitCompassHeading === "number"
          ? compassEvent.webkitCompassHeading
          : compassEvent.absolute && compassEvent.alpha !== null
            ? (360 - compassEvent.alpha) % 360
            : null;
      if (value !== null && Number.isFinite(value)) {
        receivedHeading = true;
        window.clearTimeout(unavailableTimer);
        setHeading((value + 360) % 360);
      }
    }
    window.addEventListener("deviceorientation", onOrientation);
    window.addEventListener("deviceorientationabsolute", onOrientation);
    return () => {
      window.clearTimeout(unavailableTimer);
      window.removeEventListener("deviceorientation", onOrientation);
      window.removeEventListener("deviceorientationabsolute", onOrientation);
    };
  }, [compassEnabled]);

  function useDeviceLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("تحديد الموقع غير مدعوم؛ افتح صفحة الصلاة لاختيار مدينة.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationName("موقعي الحالي");
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "لم يُسمح بالوصول للموقع. اسمح به من إعدادات المتصفح أو اختر مدينة في صفحة الصلاة."
            : "تعذر تحديد الموقع؛ تحقق من إعدادات الجهاز ثم أعد المحاولة.",
        );
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  }

  async function enableCompass() {
    setCompassError("");
    if (typeof DeviceOrientationEvent === "undefined") {
      setCompassError("البوصلة غير مدعومة في هذا المتصفح؛ استخدم قيمة الاتجاه من الشمال.");
      return;
    }
    try {
      const orientationConstructor = DeviceOrientationEvent as CompassConstructor;
      if (typeof orientationConstructor.requestPermission === "function") {
        const permission = await orientationConstructor.requestPermission();
        if (permission !== "granted") {
          setCompassError("لم يُسمح باستخدام مستشعر الاتجاه.");
          return;
        }
      }
      setHeading(null);
      setCompassEnabled(true);
    } catch (error) {
      setCompassError(error instanceof Error ? error.message : "تعذر تشغيل مستشعر الاتجاه.");
    }
  }

  function incrementCount(id: string, target: number) {
    const next = Math.min(target, (counts[id] ?? 0) + 1);
    const updated = { ...counts, [id]: next };
    try {
      localStorage.setItem(countStorageKey, JSON.stringify(updated));
      setCounts(updated);
      setCountError("");
    } catch (error) {
      console.error("Could not save daily remembrance counts.", error);
      setCountError("تعذر حفظ العدّ على هذا الجهاز.");
    }
  }

  function resetCounts() {
    try {
      localStorage.removeItem(countStorageKey);
      setCounts({});
      setCountError("");
    } catch (error) {
      console.error("Could not reset daily remembrance counts.", error);
      setCountError("تعذر إعادة ضبط العدّ.");
    }
  }

  function ayahText(surahNumber: number, start: number, end: number): string {
    const surah = quran.find((item) => item.number === surahNumber);
    return surah?.ayahs
      .filter((ayah) => ayah.numberInSurah >= start && ayah.numberInSurah <= end)
      .map((ayah) => ayah.text)
      .join(" ۞ ") ?? "";
  }

  return (
    <section className="section-page devotions-page">
      <SectionHeading
        eyebrow="عبادات يومية"
        title="القبلة والأذكار"
        detail="أدوات عملية للذكر ومعرفة اتجاه القبلة والتاريخ الهجري."
      />
      <div className="hijri-banner">
        <span>التاريخ الهجري · أم القرى</span>
        <strong>{hijriLabel ?? "التقويم الهجري غير مدعوم في هذا المتصفح"}</strong>
        <small>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "full" }).format(now)}</small>
      </div>
      <div className="segmented devotion-tabs" role="tablist" aria-label="أدوات العبادات">
        <button role="tab" aria-selected={tab === "qibla"} className={tab === "qibla" ? "segment active" : "segment"} onClick={() => setTab("qibla")}>اتجاه القبلة</button>
        <button role="tab" aria-selected={tab === "adhkar"} className={tab === "adhkar" ? "segment active" : "segment"} onClick={() => setTab("adhkar")}>الأذكار</button>
        <button role="tab" aria-selected={tab === "calendar"} className={tab === "calendar" ? "segment active" : "segment"} onClick={() => setTab("calendar")}>التقويم</button>
      </div>

      {tab === "qibla" && (
        <div className="devotion-card qibla-card">
          <div className="devotion-card-heading">
            <div><span className="eyebrow">نحو المسجد الحرام</span><h2>اتجاه القبلة</h2></div>
            <span className="qibla-location">{locationName || "جارٍ تحميل الموقع…"}</span>
          </div>
          {bearing === null ? (
            <div className="loading"><span className="spinner" /><span>جارٍ تحديد الإحداثيات…</span></div>
          ) : (
            <>
              <div className="compass-face" aria-label={`اتجاه القبلة ${Math.round(bearing)} درجة من الشمال`}>
                <span className="compass-north">ش</span>
                <span className="compass-east">ق</span>
                <span className="compass-south">ج</span>
                <span className="compass-west">غ</span>
                <span className="compass-needle" style={{ transform: `rotate(${relativeBearing}deg)` }}>◆</span>
                <span className="compass-center">الكعبة</span>
              </div>
              <p className="qibla-degree">{Math.round(bearing).toLocaleString("ar")}° من الشمال الحقيقي</p>
              <p className="prayer-help">
                {heading === null
                  ? "الاتجاه محسوب من الشمال الجغرافي. فعّل مستشعر الجهاز إن كان مدعومًا لتدوير المؤشر مع الهاتف."
                  : "حرّك الهاتف حتى يشير المؤشر إلى الأعلى؛ السهم يحدد اتجاه القبلة."}
              </p>
            </>
          )}
          {locationError && <p className="devotion-error" role="alert">{locationError}</p>}
          {compassError && <p className="devotion-error" role="alert">{compassError}</p>}
          <div className="devotion-actions">
            <button className="prayer-action-button" onClick={useDeviceLocation}>استخدم موقعي الحالي</button>
            <button className="prayer-action-button secondary" onClick={() => void enableCompass()}>تفعيل بوصلة الهاتف</button>
          </div>
          <p className="prayer-help">يُستخدم موقع صفحة الصلاة افتراضيًا. تتطلب دقة تحديد الموقع والبوصلة إذن المتصفح، وقد تختلف البوصلة المغناطيسية عن الشمال الحقيقي.</p>
        </div>
      )}

      {tab === "adhkar" && (
        <div className="devotion-card">
          <div className="devotion-card-heading">
            <div><span className="eyebrow">وردك اليومي</span><h2>الأذكار</h2></div>
            <div className="session-switch" role="group" aria-label="فترة الأذكار">
              <button className={session === "morning" ? "active" : ""} onClick={() => setSession("morning")}>الصباح</button>
              <button className={session === "evening" ? "active" : ""} onClick={() => setSession("evening")}>المساء</button>
            </div>
          </div>
          <p className="prayer-help">يظهر التسبيح والاستغفار دائمًا، ونختار لك ثلاثة أذكار أخرى تتغير كل يوم. العدّ محفوظ على هذا الجهاز ويُعاد يوميًا.</p>
          {countError && <p className="devotion-error" role="alert">{countError}</p>}
          <div className="dhikr-list">
            {dailyRandomDhikr.map((item) => {
              const text = item.surah !== undefined && item.start !== undefined && item.end !== undefined
                ? ayahText(item.surah, item.start, item.end)
                : item.textBySession?.[session] ?? item.text ?? "";
              return (
                <article className="dhikr-item" key={item.id}>
                  <div className="devotion-card-heading"><strong>{item.title}</strong><span>{item.source}</span></div>
                  <p className="dhikr-text" dir="rtl">{text || "جارٍ تحميل نص القرآن…"}</p>
                  <div className="dhikr-controls">
                    <span>{(counts[item.id] ?? 0).toLocaleString("ar")} / {item.target.toLocaleString("ar")}</span>
                    <button className="prayer-action-button" disabled={!text || (counts[item.id] ?? 0) >= item.target} onClick={() => incrementCount(item.id, item.target)}>تمّ الذكر</button>
                  </div>
                </article>
              );
            })}
            <article className="dhikr-item">
              <div className="devotion-card-heading"><strong>{TASBIH.title}</strong><span>{TASBIH.source}</span></div>
              <p className="dhikr-text" dir="rtl">{TASBIH.text}</p>
              <div className="dhikr-controls">
                <span>{(counts[TASBIH.id] ?? 0).toLocaleString("ar")} / {TASBIH.target.toLocaleString("ar")}</span>
                <button className="prayer-action-button" disabled={(counts[TASBIH.id] ?? 0) >= TASBIH.target} onClick={() => incrementCount(TASBIH.id, TASBIH.target)}>تسبيح</button>
              </div>
            </article>
            <article className="dhikr-item">
              <div className="devotion-card-heading"><strong>{ISTIGHFAR.title}</strong><span>{ISTIGHFAR.source}</span></div>
              <p className="dhikr-text" dir="rtl">{ISTIGHFAR.text}</p>
              <div className="dhikr-controls">
                <span>{(counts[ISTIGHFAR.id] ?? 0).toLocaleString("ar")} / {ISTIGHFAR.target.toLocaleString("ar")}</span>
                <button className="prayer-action-button" disabled={(counts[ISTIGHFAR.id] ?? 0) >= ISTIGHFAR.target} onClick={() => incrementCount(ISTIGHFAR.id, ISTIGHFAR.target)}>استغفار</button>
              </div>
            </article>
          </div>
          <button className="prayer-action-button secondary reset-dhikr" onClick={resetCounts}>إعادة ضبط عدّ اليوم</button>
          <p className="source-note">الأذكار من القرآن الكريم والصحيحين وسنن أبي داود. قد تختلف أرقام الروايات بين الطبعات.</p>
        </div>
      )}

      {tab === "calendar" && (
        <div className="devotion-card calendar-card">
          <span className="eyebrow">تقويم أم القرى</span>
          <h2>{hijriLabel ?? "التقويم الهجري غير مدعوم في هذا المتصفح"}</h2>
          <p>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "full" }).format(now)}</p>
          <p className="prayer-help">يعرض التطبيق التاريخ الهجري المدني بحسب تقويم أم القرى في المتصفح. قد يختلف بدء الشهر عن الرؤية الشرعية والإعلانات المحلية.</p>
        </div>
      )}
    </section>
  );
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="section-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>;
}
