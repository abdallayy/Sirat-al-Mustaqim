import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import TafsirPanel from "./components/TafsirPanel";
import {
  loadHadith,
  loadQuran,
  normalizeArabic,
  readLastRead,
  readStoredList,
  writeLastRead,
  writeStoredList,
  type Hadith,
  type HadithCollection,
  type Quran,
  type Surah,
} from "./data";
import { indexHadiths, searchHadiths } from "./lib/hadith-search";
import PrayerPage from "./pages/PrayerPage";
import DevotionsPage from "./pages/DevotionsPage";
import { QURAN_RECITERS, isQuranReciterId, quranAudioUrl, quranQueueFromVerse, type QuranReciterId } from "./lib/quran-audio";
import { buildQuranPages, findPageForVerse, type QuranPageVerse } from "./lib/quran-pages";
import {
  loadReadingProgress,
  markAyahRead,
  readAyahCount,
  saveReadingProgress,
  setDailyReadingGoal,
  type ReadingProgress,
} from "./lib/reading";
import {
  formatCountdown,
  formatPrayerTime,
  NAMES,
  nextPrayer,
} from "./lib/prayer";
import {
  loadPrayerSettings,
  startPrayerScheduler,
  stopPrayerScheduler,
  type PrayerSettings,
} from "./lib/notify";

type Section = "home" | "quran" | "hadith" | "prayer" | "devotions";
type QuranMode = "surahs" | "search" | "saved";
type Collection = "bukhari" | "muslim";

const collectionNames: Record<Collection, string> = {
  bukhari: "صحيح البخاري",
  muslim: "صحيح مسلم",
};

function App() {
  const [section, setSection] = useState<Section>(() => {
    const requested = new URLSearchParams(window.location.search).get("section");
    return requested === "prayer" || requested === "devotions" ? requested : "home";
  });
  const [quran, setQuran] = useState<Quran>([]);
  const [quranError, setQuranError] = useState("");
  const [selectedSurah, setSelectedSurah] = useState<number | null>(null);
  const [quranMode, setQuranMode] = useState<QuranMode>("surahs");
  const [quranQuery, setQuranQuery] = useState("");
  const [fontSize, setFontSize] = useState(30);
  const [readerStartAyah, setReaderStartAyah] = useState(1);
  const [lastRead, setLastRead] = useState(readLastRead);
  const [savedAyahs, setSavedAyahs] = useState(() => readStoredList("sirat.saved-ayahs"));
  const [savedHadith, setSavedHadith] = useState(() => readStoredList("sirat.saved-hadith"));
  const [bookmarkedHadith, setBookmarkedHadith] = useState(() => readStoredList("sirat.bookmarked-hadith"));
  const [readingProgress, setReadingProgress] = useState<ReadingProgress>(() =>
    loadReadingProgress(),
  );
  const readingProgressRef = useRef(readingProgress);
  readingProgressRef.current = readingProgress;
  const [collection, setCollection] = useState<Collection>("bukhari");
  const [hadithData, setHadithData] = useState<HadithCollection | null>(null);
  const [hadithError, setHadithError] = useState("");
  const [hadithQuery, setHadithQuery] = useState("");
  const [hadithBook, setHadithBook] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [hadithPage, setHadithPage] = useState(0);
  const [notice, setNotice] = useState("");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  }, []);

  function navigateTo(target: Section) {
    setSection(target);
    setSelectedSurah(null);
    const url = new URL(window.location.href);
    if (target === "prayer" || target === "devotions") url.searchParams.set("section", target);
    else url.searchParams.delete("section");
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    startPrayerScheduler((error) => {
      console.error("A scheduled prayer notification failed.", error);
      showNotice("تعذر إرسال أحد الإشعارات المجدولة؛ تحقق من إذن المتصفح.");
    });
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
        console.error("Could not register the push notification service worker.", error);
        showNotice("تعذر تجهيز إشعارات الخلفية على هذا المتصفح.");
      });
    }
    return () => stopPrayerScheduler();
  }, [showNotice]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadQuran()
      .then((data) => {
        if (active) setQuran(data);
      })
      .catch((error: unknown) => {
        if (active) setQuranError(error instanceof Error ? error.message : "تعذر تحميل القرآن.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (section !== "hadith") return;
    let active = true;
    setHadithData(null);
    setHadithError("");
    loadHadith(collection)
      .then((data) => {
        if (active) setHadithData(data);
      })
      .catch((error: unknown) => {
        if (active) setHadithError(error instanceof Error ? error.message : "تعذر تحميل الحديث.");
      });
    return () => {
      active = false;
    };
  }, [section, collection]);

  const selected = quran.find((surah) => surah.number === selectedSurah) ?? null;

  const quranMatches = useMemo(() => {
    const query = normalizeArabic(quranQuery);
    if (query.length < 2) return [];
    return quran.flatMap((surah) =>
      surah.ayahs
        .filter((ayah) => normalizeArabic(ayah.text).includes(query))
        .map((ayah) => ({ surah, ayah })),
    ).slice(0, 60);
  }, [quran, quranQuery]);

  const hadithSearchIndex = useMemo(
    () => indexHadiths(hadithData?.hadiths ?? []),
    [hadithData],
  );

  const filteredHadiths = useMemo(() => {
    if (!hadithData) return [];
    return searchHadiths(hadithSearchIndex, hadithQuery).filter((hadith) => {
      const ref = `${collection}:${hadith.hadithnumber}`;
      const matchesBook = !hadithBook || String(hadith.reference?.book ?? "") === hadithBook;
      const matchesSaved = !favoritesOnly || savedHadith.includes(ref);
      const matchesBookmark = !bookmarksOnly || bookmarkedHadith.includes(ref);
      return matchesBook && matchesSaved && matchesBookmark;
    });
  }, [bookmarkedHadith, bookmarksOnly, collection, favoritesOnly, hadithBook, hadithData, hadithQuery, hadithSearchIndex, savedHadith]);

  useEffect(() => {
    setHadithPage(0);
  }, [collection, hadithQuery, hadithBook, favoritesOnly, bookmarksOnly]);

  function openSurah(number: number, ayah = 1) {
    navigateTo("quran");
    setQuranMode("surahs");
    setSelectedSurah(number);
    setReaderStartAyah(ayah);
    setLastRead({ surah: number, ayah });
    writeLastRead(number, ayah);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (ayah > 1) {
      window.setTimeout(() => {
        document.getElementById(`ayah-${number}-${ayah}`)?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }

  function toggleSavedAyah(id: string) {
    const updated = savedAyahs.includes(id)
      ? savedAyahs.filter((item) => item !== id)
      : [...savedAyahs, id];
    setSavedAyahs(updated);
    writeStoredList("sirat.saved-ayahs", updated);
  }

  function toggleSavedHadith(id: string) {
    const updated = savedHadith.includes(id)
      ? savedHadith.filter((item) => item !== id)
      : [...savedHadith, id];
    setSavedHadith(updated);
    writeStoredList("sirat.saved-hadith", updated);
  }

  function toggleBookmarkedHadith(id: string) {
    const updated = bookmarkedHadith.includes(id)
      ? bookmarkedHadith.filter((item) => item !== id)
      : [...bookmarkedHadith, id];
    setBookmarkedHadith(updated);
    writeStoredList("sirat.bookmarked-hadith", updated);
  }

  const recordRead = useCallback((surah: number, ayah: number) => {
    setSelectedSurah(surah);
    setReaderStartAyah(ayah);
    setLastRead({ surah, ayah });
    writeLastRead(surah, ayah);
    const updated = markAyahRead(readingProgressRef.current, surah, ayah);
    if (readAyahCount(updated) === readAyahCount(readingProgressRef.current)) return;
    readingProgressRef.current = updated;
    setReadingProgress(updated);
    try {
      saveReadingProgress(updated);
    } catch (error) {
      console.error("Could not save Quran reading progress.", error);
      showNotice("تعذر حفظ تقدم القراءة على هذا الجهاز.");
    }
  }, [showNotice]);

  function updateReaderPosition(surah: number, ayah: number) {
    setSelectedSurah(surah);
    setReaderStartAyah(ayah);
    setLastRead({ surah, ayah });
    writeLastRead(surah, ayah);
  }

  function updateReadingGoal(goal: number) {
    const updated = setDailyReadingGoal(readingProgress, goal);
    readingProgressRef.current = updated;
    setReadingProgress(updated);
    try {
      saveReadingProgress(updated);
    } catch (error) {
      console.error("Could not save the daily Quran goal.", error);
      showNotice("تعذر حفظ هدف القراءة على هذا الجهاز.");
    }
  }

  async function share(text: string) {
    try {
      if (navigator.share) {
        await navigator.share({ text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setNotice("نُسخ النص للمشاركة");
        window.setTimeout(() => setNotice(""), 2200);
      } else {
        setNotice("المشاركة غير متاحة في هذا المتصفح");
        window.setTimeout(() => setNotice(""), 2200);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setNotice("تعذرت مشاركة النص");
        window.setTimeout(() => setNotice(""), 2200);
      }
    }
  }

  const activeSectionLabel =
    section === "quran"
      ? "القرآن الكريم"
      : section === "hadith"
        ? "الحديث الشريف"
        : section === "prayer"
          ? "مواقيت الصلاة"
            : section === "devotions"
              ? "القبلة والأذكار"
          : "الرئيسية";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigateTo("home")}>
          <span className="brand-mark" aria-hidden="true">۞</span>
          <span><strong>الصراط المستقيم</strong><small>رفيق القرآن والسنّة</small></span>
        </button>
        <div className="nav-caption">المكتبة</div>
        <nav className="main-nav" aria-label="القائمة الرئيسية">
          <NavButton active={section === "home"} icon="home" label="الرئيسية" onClick={() => navigateTo("home")} />
          <NavButton active={section === "quran"} icon="book" label="القرآن الكريم" onClick={() => navigateTo("quran")} />
          <NavButton active={section === "hadith"} icon="quote" label="الحديث الشريف" onClick={() => navigateTo("hadith")} />
          <NavButton active={section === "prayer"} icon="clock" label="مواقيت الصلاة" onClick={() => navigateTo("prayer")} />
          <NavButton active={section === "devotions"} icon="compass" label="القبلة والأذكار" onClick={() => navigateTo("devotions")} />
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-star">✳</span>
            <p>﴿ وَقُل رَّبِّ زِدْنِي عِلْمًا ﴾</p>
            <small>طه · ١١٤</small>
          </div>
          <span className="phase-label">القرآن والعبادات اليومية</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-brand" onClick={() => navigateTo("home")}>
            <span className="brand-mark" aria-hidden="true">۞</span> الصراط المستقيم
          </button>
          <div className="breadcrumb"><span>المكتبة</span><i>/</i><strong>{selected?.name ?? activeSectionLabel}</strong></div>
          <div className="topbar-right">
            <span className={isOnline ? "live-dot" : "live-dot offline"} />
            <span>{isOnline ? "القرآن · الحديث · العبادات" : "غير متصل · المحتوى المحفوظ متاح"}</span>
          </div>
        </header>

        <div className="page-wrap">
          {!isOnline && <div className="offline-banner" role="status">أنت غير متصل. تتوفر الصفحات والبيانات التي سبق فتحها على هذا الجهاز.</div>}
          {section === "home" && (
            <Home
              quran={quran}
              quranError={quranError}
              lastRead={lastRead}
              readingProgress={readingProgress}
              onOpenQuran={() => navigateTo("quran")}
              onOpenHadith={() => navigateTo("hadith")}
              onOpenPrayer={() => navigateTo("prayer")}
              onOpenDevotions={() => navigateTo("devotions")}
              onSetGoal={updateReadingGoal}
              onContinue={() => lastRead && openSurah(lastRead.surah, lastRead.ayah)}
            />
          )}

          {section === "quran" && (
            <section className="section-page">
              <SectionHeading eyebrow="كلام الله تعالى" title="القرآن الكريم" detail="اقرأ بتأنٍ، واحفظ موضعك، وارجع إلى آياتك المحفوظة." />
              <ReadingProgressCard progress={readingProgress} onSetGoal={updateReadingGoal} />
              {quranError && <ErrorBanner message={quranError} />}
              {!quran.length && !quranError && <Loading label="جارٍ تحميل المصحف الشريف…" />}
              {quran.length > 0 && !selected && (
                <>
                  <div className="segmented" role="tablist" aria-label="عرض القرآن">
                    <Segment active={quranMode === "surahs"} onClick={() => setQuranMode("surahs")}>السور</Segment>
                    <Segment active={quranMode === "search"} onClick={() => setQuranMode("search")}>بحث في الآيات</Segment>
                    <Segment active={quranMode === "saved"} onClick={() => setQuranMode("saved")}>المحفوظات <span className="count-pill">{savedAyahs.length}</span></Segment>
                  </div>
                  {quranMode === "surahs" && (
                    <>
                      <div className="search-wrap"><Icon name="search" /><input value={quranQuery} onChange={(event) => setQuranQuery(event.target.value)} placeholder="ابحث عن سورة…" aria-label="ابحث عن سورة" /><span className="search-shortcut">١١٤ سورة</span></div>
                      <div className="surah-grid">
                        {quran.filter((surah) => !quranQuery || normalizeArabic(`${surah.name} ${surah.englishName}`).includes(normalizeArabic(quranQuery))).map((surah) => (
                          <button key={surah.number} className="surah-card" onClick={() => openSurah(surah.number)}>
                            <span className="surah-number">{surah.number.toString().padStart(2, "0")}</span>
                            <span className="surah-copy"><strong>{surah.name}</strong><small>{surah.englishName} · {surah.ayahs.length} آية</small></span>
                            <span className="surah-type">{surah.revelationType === "Meccan" ? "مكية" : "مدنية"}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {quranMode === "search" && (
                    <>
                      <div className="search-wrap"><Icon name="search" /><input value={quranQuery} onChange={(event) => setQuranQuery(event.target.value)} placeholder="اكتب كلمة أو جزءًا من آية…" aria-label="ابحث في نص القرآن" /><span className="search-shortcut">بحث عربي</span></div>
                      {quranQuery.trim().length < 2 ? <EmptyState title="ابحث في آيات القرآن" detail="اكتب حرفين على الأقل لبدء البحث في النص العربي." /> : (
                        <><p className="result-count">عرض {quranMatches.length} نتيجة كحد أقصى</p>
                          {quranMatches.map(({ surah, ayah }) => <button key={`${surah.number}:${ayah.numberInSurah}`} className="result-card" onClick={() => openSurah(surah.number, ayah.numberInSurah)}>
                            <span className="result-ref">{surah.name} <i>·</i> الآية {ayah.numberInSurah}</span><span className="ayah-text small-ayah">{ayah.text}</span>
                          </button>)}
                          {quranMatches.length === 0 && <EmptyState title="لا توجد نتائج" detail="جرّب كلمة أخرى أو إزالة التشكيل من البحث." />}
                        </>
                      )}
                    </>
                  )}
                  {quranMode === "saved" && (
                    savedAyahs.length === 0 ? <EmptyState title="لا توجد آيات محفوظة بعد" detail="استخدم زر الحفظ بجوار أي آية لتجدها هنا." /> :
                      <div className="saved-list">{savedAyahs.map((id) => {
                        const [surahNumber, ayahNumber] = id.split(":").map(Number);
                        const surah = quran.find((item) => item.number === surahNumber);
                        const ayah = surah?.ayahs.find((item) => item.numberInSurah === ayahNumber);
                        if (!surah || !ayah) return null;
                        return <div key={id} className="saved-ayah"><button onClick={() => openSurah(surahNumber, ayahNumber)}><span className="result-ref">{surah.name} · الآية {ayahNumber}</span><span className="ayah-text small-ayah">{ayah.text}</span></button><button className="icon-button" aria-label="إزالة من المحفوظات" onClick={() => toggleSavedAyah(id)}><Icon name="close" /></button></div>;
                      })}</div>
                  )}
                </>
              )}
              {selected && (
                <SurahReader
                  quran={quran}
                  surah={selected}
                  startAyah={readerStartAyah}
                  fontSize={fontSize}
                  setFontSize={setFontSize}
                  savedAyahs={savedAyahs}
                  onBack={() => setSelectedSurah(null)}
                  onSave={toggleSavedAyah}
                  onShare={share}
                  onRead={recordRead}
                  onPositionChange={updateReaderPosition}
                  onChangeSurah={(number) => openSurah(number)}
                />
              )}
              {quran.length > 0 && <p className="source-note">النص القرآني من Tanzil Project، بترخيص CC BY 3.0، ويُعرض دون تغيير. <a href="https://tanzil.net" target="_blank" rel="noreferrer">المصدر والترخيص</a></p>}
            </section>
          )}

          {section === "hadith" && (
            <section className="section-page">
              <SectionHeading eyebrow="من هدي النبي ﷺ" title="الحديث الشريف" detail="تصفّح الروايات العربية من صحيحي البخاري ومسلم." />
              <div className="collection-switch">
                {(["bukhari", "muslim"] as const).map((id) => (
                  <button key={id} className={collection === id ? "collection-tab active" : "collection-tab"} onClick={() => { setCollection(id); setHadithBook(""); }}>
                    <span className="collection-icon">ك</span><span><strong>{collectionNames[id]}</strong><small>مرويات صحيحة</small></span>
                  </button>
                ))}
              </div>
              {hadithError && <ErrorBanner message={hadithError} />}
              {!hadithData && !hadithError && <Loading label={`جارٍ تحميل ${collectionNames[collection]}…`} />}
              {hadithData && (
                <>
                  <div className="hadith-tools">
                    <div className="search-wrap hadith-search-wrap" role="search"><Icon name="search" /><input value={hadithQuery} onChange={(event) => setHadithQuery(event.target.value)} placeholder="كلمة أو عبارة أو رقم حديث…" aria-label="ابحث في نص الحديث أو رقمه" autoComplete="off" spellCheck={false} />{hadithQuery && <button className="search-clear" type="button" aria-label="مسح البحث" onClick={() => setHadithQuery("")}><Icon name="close" /></button>}</div>
                    <select className="book-select" value={hadithBook} onChange={(event) => setHadithBook(event.target.value)} aria-label="اختر كتابًا">
                      <option value="">جميع الأبواب</option>
                      {Object.entries(hadithData.metadata?.section ?? {}).filter(([key]) => key !== "0").map(([key, title]) => <option key={key} value={key}>{title}</option>)}
                    </select>
                    <button className={favoritesOnly ? "filter-button active" : "filter-button"} aria-pressed={favoritesOnly} onClick={() => { setFavoritesOnly(!favoritesOnly); setBookmarksOnly(false); }}><Icon name="heart" /> المفضلة <span>{savedHadith.length}</span></button>
                    <button className={bookmarksOnly ? "filter-button active" : "filter-button"} aria-pressed={bookmarksOnly} onClick={() => { setBookmarksOnly(!bookmarksOnly); setFavoritesOnly(false); }}><Icon name="bookmark" /> العلامات <span>{bookmarkedHadith.length}</span></button>
                  </div>
                  <div className="hadith-list-heading"><span>{collectionNames[collection]} <i>·</i> {filteredHadiths.length.toLocaleString("ar")} حديث</span><span>النص العربي</span></div>
                  {filteredHadiths.length === 0 ? <EmptyState title="لم نعثر على أحاديث" detail={favoritesOnly ? "لم تضف أحاديث إلى المفضلة من هذا الكتاب بعد." : bookmarksOnly ? "لا توجد علامات مرجعية لهذا الكتاب بعد." : "غيّر كلمات البحث أو اختر بابًا آخر."} /> : (
                    <div className="hadith-list">{filteredHadiths.slice(hadithPage * 20, hadithPage * 20 + 20).map((hadith) => (
                      <HadithCard
                        key={`${collection}:${hadith.hadithnumber}`}
                        hadith={hadith}
                        collection={collection}
                        saved={savedHadith.includes(`${collection}:${hadith.hadithnumber}`)}
                        bookmarked={bookmarkedHadith.includes(`${collection}:${hadith.hadithnumber}`)}
                        onSave={() => toggleSavedHadith(`${collection}:${hadith.hadithnumber}`)}
                        onBookmark={() => toggleBookmarkedHadith(`${collection}:${hadith.hadithnumber}`)}
                        onShare={share}
                      />
                    ))}</div>
                  )}
                  {filteredHadiths.length > 20 && <div className="pagination"><span>صفحة {(hadithPage + 1).toLocaleString("ar")} من {Math.ceil(filteredHadiths.length / 20).toLocaleString("ar")}</span><div><button disabled={hadithPage === 0} onClick={() => setHadithPage(Math.max(0, hadithPage - 1))}>السابق</button><button disabled={(hadithPage + 1) * 20 >= filteredHadiths.length} onClick={() => setHadithPage(hadithPage + 1)}>التالي</button></div></div>}
                </>
              )}
              <p className="source-note">المصدر: مجموعة {collectionNames[collection]} العربية. أرقام الأحاديث بحسب قاعدة البيانات وقد تختلف باختلاف الطبعات.</p>
            </section>
          )}
          {section === "prayer" && <PrayerPage onError={showNotice} />}
          {section === "devotions" && <DevotionsPage quran={quran} onError={showNotice} />}
          <footer className="page-footer"><span>الصراط المستقيم</span><span>القرآن والحديث والعبادات اليومية</span></footer>
        </div>
      </main>
      <nav className="mobile-nav" aria-label="التنقل">
        <NavButton compact active={section === "home"} icon="home" label="الرئيسية" onClick={() => navigateTo("home")} />
        <NavButton compact active={section === "quran"} icon="book" label="القرآن" onClick={() => navigateTo("quran")} />
        <NavButton compact active={section === "hadith"} icon="quote" label="الحديث" onClick={() => navigateTo("hadith")} />
        <NavButton compact active={section === "prayer"} icon="clock" label="الصلاة" onClick={() => navigateTo("prayer")} />
        <NavButton compact active={section === "devotions"} icon="compass" label="القبلة" onClick={() => navigateTo("devotions")} />
      </nav>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function Home({ quran, quranError, lastRead, readingProgress, onOpenQuran, onOpenHadith, onOpenPrayer, onOpenDevotions, onSetGoal, onContinue }: {
  quran: Quran;
  quranError: string;
  lastRead: { surah: number; ayah: number } | null;
  readingProgress: ReadingProgress;
  onOpenQuran: () => void;
  onOpenHadith: () => void;
  onOpenPrayer: () => void;
  onOpenDevotions: () => void;
  onSetGoal: (goal: number) => void;
  onContinue: () => void;
}) {
  const openingAyah = quran[0]?.ayahs[0];
  const lastSurah = lastRead ? quran.find((surah) => surah.number === lastRead.surah) : null;
  return (
    <section className="home-page">
      <div className="welcome-row"><div><span className="eyebrow">السَّلَامُ عَلَيْكُمْ</span><h1>طريقٌ يبدأ <em>بآية.</em></h1><p>مساحة هادئة للقرآن الكريم والحديث الصحيح.</p></div><div className="date-stamp"><span>القرآن الكريم</span><strong>تدبّر القرآن</strong><small>رفيق يومي للقراءة والتدبّر</small></div></div>
      <div className="hero-card">
        <div className="hero-ornament" aria-hidden="true">۞</div><div className="hero-top"><span><i className="live-dot" /> آيَةٌ لِلْبِدَايَةِ</span><span>القرآن الكريم</span></div>
        {quranError ? <p className="hero-arabic">تعذّر تحميل الآية. تحقّق من الاتصال ثم أعد تحميل الصفحة.</p> : openingAyah ? <p className="hero-arabic">{openingAyah.text}</p> : <Loading label="جارٍ تجهيز المصحف…" />}
        <div className="hero-bottom"><span>سورة الفاتحة · الآية ١</span><button onClick={onOpenQuran}>ابدأ القراءة <Icon name="arrow" /></button></div>
      </div>
      <div className="quick-stats">
        <div className="stat-card"><span className="stat-icon">۞</span><span><small>المصحف الشريف</small><strong>١١٤ <i>سورة</i></strong></span></div>
        <div className="stat-card"><span className="stat-icon">آ</span><span><small>آيات القرآن الكريم</small><strong>٦٬٢٣٦ <i>آية</i></strong></span></div>
        <div className="stat-card"><span className="stat-icon">س</span><span><small>مصادر الحديث</small><strong>صحيحان <i>معتمدان</i></strong></span></div>
      </div>
      <NextPrayerCard onOpen={onOpenPrayer} />
      <ReadingProgressCard progress={readingProgress} onSetGoal={onSetGoal} />
      <button className="home-devotions-card" onClick={onOpenDevotions}>
        <span className="devotions-card-mark">۞</span>
        <span><strong>القبلة والأذكار</strong><small>اتجاه القبلة · ورد الصباح والمساء · التاريخ الهجري</small></span>
        <Icon name="arrow" />
      </button>
      <div className="home-lower">
        <div className="continue-card">
          <div className="section-kicker">عُدْ إِلَى وِرْدِكَ <span>متابعة القراءة</span></div>
          <div className="continue-content"><div className="continue-emblem"><Icon name="book" /></div><div><strong>{lastSurah?.name ?? "لم تبدأ القراءة بعد"}</strong><span>{lastSurah && lastRead ? `الآية ${lastRead.ayah} · ${lastSurah.englishName}` : "ابدأ رحلتك من سورة الفاتحة"}</span></div></div>
          <button className="text-link" onClick={lastRead ? onContinue : onOpenQuran}>{lastRead ? "تابع من حيث وصلت" : "تصفّح السور"} <Icon name="arrow" /></button>
        </div>
        <div className="hadith-promo">
          <div className="section-kicker">السُّنَّة النَّبَوِيَّة <span>العلم والعمل</span></div>
          <div className="promo-quote">«خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ»</div>
          <span className="promo-reference">صحيح البخاري · ٥٠٢٧</span>
          <button className="text-link" onClick={onOpenHadith}>تصفّح الحديث الشريف <Icon name="arrow" /></button>
        </div>
      </div>
      <div className="home-footnote">عرض الحديث على أنه من صحيح البخاري وفقًا لمصدر البيانات. الأرقام قد تختلف بين الطبعات.</div>
    </section>
  );
}

function ReadingProgressCard({ progress, onSetGoal }: {
  progress: ReadingProgress;
  onSetGoal: (goal: number) => void;
}) {
  const count = readAyahCount(progress);
  const percentage = Math.min(100, Math.round((count / progress.dailyGoal) * 100));
  return (
    <section className="reading-progress-card" aria-label="تقدم القراءة اليومي">
      <div className="reading-progress-top">
        <div><span className="eyebrow">وردك اليومي</span><strong>{count.toLocaleString("ar")} / {progress.dailyGoal.toLocaleString("ar")} آية</strong></div>
        <label className="goal-select">الهدف اليومي
          <select aria-label="هدف القراءة اليومي" value={progress.dailyGoal} onChange={(event) => onSetGoal(Number(event.target.value))}>
            {[5, 10, 20, 50, 100].map((goal) => <option value={goal} key={goal}>{goal.toLocaleString("ar")} آية</option>)}
          </select>
        </label>
      </div>
      <div className="reading-progress-track" role="progressbar" aria-valuenow={Math.min(count, progress.dailyGoal)} aria-valuemin={0} aria-valuemax={progress.dailyGoal} aria-label="نسبة إنجاز الورد">
        <span style={{ width: `${percentage}%` }} />
      </div>
      <small>{percentage >= 100 ? "أتممت وردك اليوم، بارك الله فيك." : `أكمل ${Math.max(0, progress.dailyGoal - count).toLocaleString("ar")} آية للوصول إلى هدفك.`}</small>
    </section>
  );
}

function NextPrayerCard({ onOpen }: { onOpen: () => void }) {
  const [settings, setSettings] = useState<PrayerSettings | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let active = true;
    loadPrayerSettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "تعذر تحميل إعدادات الصلاة.");
      });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const upcoming = useMemo(() => settings ? nextPrayer(settings, now) : null, [settings, now]);
  return (
    <button className="home-prayer-card" onClick={onOpen}>
      <span className="prayer-card-icon"><Icon name="clock" /></span>
      {error ? (
        <span className="home-prayer-copy"><strong>مواقيت الصلاة</strong><small>{error}</small></span>
      ) : !settings || !upcoming ? (
        <span className="home-prayer-copy"><strong>مواقيت الصلاة</strong><small>جارٍ حساب الموعد التالي…</small></span>
      ) : (
        <>
          <span className="home-prayer-copy"><strong>الصلاة القادمة · {settings.cityName}</strong><small>{NAMES[upcoming.prayer]} · {formatPrayerTime(upcoming.at, settings.timezone)}</small></span>
          <span className="home-prayer-countdown" dir="ltr">{formatCountdown(upcoming.at - now)}</span>
        </>
      )}
      <span className="home-prayer-arrow"><Icon name="arrow" /></span>
    </button>
  );
}

function SurahReader({ quran, surah, startAyah, fontSize, setFontSize, savedAyahs, onBack, onSave, onShare, onRead, onPositionChange, onChangeSurah }: {
  quran: Quran;
  surah: Surah;
  startAyah: number;
  fontSize: number;
  setFontSize: (size: number) => void;
  savedAyahs: string[];
  onBack: () => void;
  onSave: (id: string) => void;
  onShare: (text: string) => void;
  onRead: (surah: number, ayah: number) => void;
  onPositionChange: (surah: number, ayah: number) => void;
  onChangeSurah: (number: number) => void;
}) {
  const pages = useMemo(() => buildQuranPages(quran), [quran]);
  const [pageNumber, setPageNumber] = useState(() => findPageForVerse(pages, surah.number, startAyah));
  const [viewMode, setViewMode] = useState<"mushaf" | "surah">("mushaf");
  const [selectedId, setSelectedId] = useState(`${surah.number}:${startAyah}`);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [reciter, setReciter] = useState<QuranReciterId>(() => {
    try {
      const saved = localStorage.getItem("sirat.quran-reciter");
      return saved && isQuranReciterId(saved) ? saved : QURAN_RECITERS[0].id;
    } catch (error) {
      console.error("Could not load the saved Quran reciter.", error);
      return QURAN_RECITERS[0].id;
    }
  });
  const [audioQueue, setAudioQueue] = useState<QuranPageVerse[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playRequest, setPlayRequest] = useState(0);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");

  const currentPage = pages.find((item) => item.number === pageNumber) ?? pages[0];
  const allVerses = useMemo(() => pages.flatMap((page) => page.verses), [pages]);
  const currentVerse = allVerses.find(
    ({ surah: verseSurah, ayah }) => `${verseSurah.number}:${ayah.numberInSurah}` === selectedId,
  ) ?? currentPage?.verses[0];
  const pageSourceSurah = currentPage?.verses[0]?.surah ?? surah;
  const headerSurah = viewMode === "mushaf" ? pageSourceSurah : surah;
  const pageSourceLabel = `${pageSourceSurah.name} · الصفحة ${pageNumber.toLocaleString("ar")}`;
  const pageAudioSource = currentPage?.verses ?? [];
  const surahAudioSource = allVerses.filter(
    (verse) => verse.surah.number === (currentVerse?.surah.number ?? surah.number),
  );
  const currentTrack = audioQueue[playbackIndex];
  const audioUrl = currentTrack ? quranAudioUrl(reciter, currentTrack.globalNumber) : "";

  useEffect(() => {
    if (!shouldPlay || !audioUrl || !audioRef.current) return;
    const audio = audioRef.current;
    audio.src = audioUrl;
    audio.load();
    void audio.play().then(() => {
      setIsPlaying(true);
      setAudioError("");
    }).catch((error: unknown) => {
      console.error("Could not play the selected Quran recitation.", error);
      setIsPlaying(false);
      setShouldPlay(false);
      setAudioError("تعذر تشغيل التلاوة؛ تحقق من الاتصال أو اختر قارئًا آخر.");
    });
  }, [audioUrl, playRequest, shouldPlay]);

  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const value = entry.target.getAttribute("data-reading-verse");
          const match = value?.match(/^(\d+):(\d+)$/);
          if (!match) continue;
          onRead(Number(match[1]), Number(match[2]));
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "-25% 0px -65% 0px", threshold: 0 },
    );
    document.querySelectorAll<HTMLElement>("[data-reading-verse]").forEach((verse) => {
      observer.observe(verse);
    });
    return () => observer.disconnect();
  }, [onRead, pageNumber, surah.number, viewMode]);

  function chooseReciter(value: string) {
    if (!isQuranReciterId(value)) return;
    setReciter(value);
    try {
      localStorage.setItem("sirat.quran-reciter", value);
    } catch (error) {
      console.error("Could not save the selected Quran reciter.", error);
      setAudioError("تم تغيير القارئ لهذه الجلسة، لكن تعذر حفظ الاختيار.");
    }
  }

  function playQueue(queue: QuranPageVerse[]) {
    if (queue.length === 0) {
      setAudioError("لا توجد آيات لتشغيلها.");
      return;
    }
    setAudioError("");
    setAudioQueue(queue);
    setPlaybackIndex(0);
    setPlayRequest((current) => current + 1);
    setShouldPlay(true);
  }

  function togglePlayback() {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      setShouldPlay(false);
      return;
    }
    if (audioQueue.length > 0) {
      setShouldPlay(true);
      return;
    }
    playQueue(pageAudioSource);
  }

  function playNextAyah() {
    if (playbackIndex + 1 < audioQueue.length) {
      setPlaybackIndex(playbackIndex + 1);
      setShouldPlay(true);
    } else {
      setShouldPlay(false);
      setIsPlaying(false);
    }
  }

  function selectVerse(verse: QuranPageVerse) {
    const id = `${verse.surah.number}:${verse.ayah.numberInSurah}`;
    setSelectedId(id);
    setPageNumber(findPageForVerse(pages, verse.surah.number, verse.ayah.numberInSurah));
    onRead(verse.surah.number, verse.ayah.numberInSurah);
  }

  function playFromVerse(verse: QuranPageVerse) {
    selectVerse(verse);
    playQueue(quranQueueFromVerse(allVerses, verse));
  }

  function changePage(offset: number) {
    const pageIndex = pages.findIndex((item) => item.number === pageNumber);
    const nextPage = pages[pageIndex + offset];
    const firstVerse = nextPage?.verses[0];
    if (!nextPage || !firstVerse) return;
    setPageNumber(nextPage.number);
    setSelectedId(`${firstVerse.surah.number}:${firstVerse.ayah.numberInSurah}`);
    onPositionChange(firstVerse.surah.number, firstVerse.ayah.numberInSurah);
  }

  function changeSurah(number: number) {
    const nextSurah = quran.find((item) => item.number === number);
    if (!nextSurah) return;
    setPageNumber(findPageForVerse(pages, number, 1));
    setSelectedId(`${number}:1`);
    onChangeSurah(number);
  }

  function selectedActions(verse: QuranPageVerse) {
    const id = `${verse.surah.number}:${verse.ayah.numberInSurah}`;
    return (
      <div className="mushaf-selected-actions">
        <span>{verse.surah.name} · الآية {verse.ayah.numberInSurah.toLocaleString("ar")}</span>
        <div>
          <button className={savedAyahs.includes(id) ? "icon-button saved" : "icon-button"} aria-label={savedAyahs.includes(id) ? "إزالة الآية من المحفوظات" : "حفظ الآية"} onClick={() => onSave(id)}><Icon name="bookmark" /></button>
          <button className="icon-button" aria-label="مشاركة الآية" onClick={() => void onShare(`${verse.ayah.text}\n${verse.surah.name} · الآية ${verse.ayah.numberInSurah}`)}><Icon name="share" /></button>
          <button className="audio-ayah-button" onClick={() => playFromVerse(verse)}>استمع من الآية</button>
        </div>
        <TafsirPanel surah={verse.surah.number} ayah={verse.ayah.numberInSurah} />
      </div>
    );
  }

  return (
    <div className="reader">
      <button className="back-link" onClick={onBack}><Icon name="arrow" /> قائمة السور</button>
      <div className="reader-heading">
        <div>
          <span className="eyebrow">{headerSurah.revelationType === "Meccan" ? "سُورَةٌ مَكِّيَّة" : "سُورَةٌ مَدَنِيَّة"} · {headerSurah.ayahs.length.toLocaleString("ar")} آية</span>
          <h2>{headerSurah.name}</h2>
          <p>{viewMode === "mushaf" ? pageSourceLabel : `${surah.englishName} · ${surah.englishNameTranslation}`}</p>
        </div>
        <div className="font-control">
          <button aria-label="تصغير الخط" onClick={() => setFontSize(Math.max(22, fontSize - 2))}>−</button>
          <span>حجم الخط</span>
          <button aria-label="تكبير الخط" onClick={() => setFontSize(Math.min(42, fontSize + 2))}>+</button>
        </div>
      </div>
      <div className="reader-tools">
        <div className="reader-mode-switch" role="group" aria-label="طريقة عرض القرآن">
          <button className={viewMode === "mushaf" ? "active" : ""} aria-pressed={viewMode === "mushaf"} onClick={() => setViewMode("mushaf")}>عرض المصحف</button>
          <button className={viewMode === "surah" ? "active" : ""} aria-pressed={viewMode === "surah"} onClick={() => setViewMode("surah")}>عرض السورة</button>
        </div>
        <label className="reciter-select">القارئ
          <select aria-label="اختر القارئ" value={reciter} onChange={(event) => chooseReciter(event.target.value)}>
            {QURAN_RECITERS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      {audioError && <p className="devotion-error" role="alert">{audioError}</p>}

      {viewMode === "mushaf" && currentPage && (
        <>
          <div className="mushaf-page" aria-label={`صفحة المصحف ${pageNumber}`}>
            <div className="mushaf-page-heading"><span>﴿</span><span>صفحة {pageNumber.toLocaleString("ar")}</span><span>﴾</span></div>
            <div className="mushaf-ornament" aria-hidden="true">۞</div>
            <div className="mushaf-text" dir="rtl" style={{ fontSize: `${fontSize}px` }}>
              {currentPage.verses.map((verse) => {
                const id = `${verse.surah.number}:${verse.ayah.numberInSurah}`;
                return (
                  <span className="mushaf-verse-wrap" key={id}>
                    {verse.ayah.numberInSurah === 1 && verse.surah.number !== 1 && (
                      <span className="mushaf-surah-heading">{verse.surah.name}</span>
                    )}
                    <button
                      data-reading-verse={id}
                      className={selectedId === id ? "mushaf-verse selected" : "mushaf-verse"}
                      aria-pressed={selectedId === id}
                      onClick={() => playFromVerse(verse)}
                    >
                      {verse.ayah.text}
                      <span className="mushaf-ayah-marker">۞{verse.ayah.numberInSurah.toLocaleString("ar")}۞</span>
                    </button>
                  </span>
                );
              })}
            </div>
            {currentVerse && selectedActions(currentVerse)}
            <div className="mushaf-page-footer"><span>{pageNumber.toLocaleString("ar")}</span><span>الصراط المستقيم</span><span>{pageNumber.toLocaleString("ar")}</span></div>
          </div>
          <div className="surah-pager mushaf-pager">
            <button disabled={pages[0]?.number === pageNumber} onClick={() => changePage(-1)}>الصفحة السابقة</button>
            <select aria-label="انتقل إلى صفحة" value={pageNumber} onChange={(event) => {
              const target = Number(event.target.value);
              const targetIndex = pages.findIndex((item) => item.number === target);
              const offset = targetIndex - pages.findIndex((item) => item.number === pageNumber);
              if (offset) changePage(offset);
            }}>
              {pages.map((item) => <option value={item.number} key={item.number}>صفحة {item.number.toLocaleString("ar")}</option>)}
            </select>
            <button disabled={pages[pages.length - 1]?.number === pageNumber} onClick={() => changePage(1)}>الصفحة التالية</button>
          </div>
        </>
      )}

      {viewMode === "surah" && (
        <div className="ayah-list">
          {surah.ayahs.map((ayah) => {
            const id = `${surah.number}:${ayah.numberInSurah}`;
            const verse = allVerses.find((item) =>
              item.surah.number === surah.number && item.ayah.numberInSurah === ayah.numberInSurah,
            );
            return (
              <article
                className="ayah-card"
                data-reading-verse={id}
                id={`ayah-${surah.number}-${ayah.numberInSurah}`}
                key={id}
              >
                <div className="ayah-toolbar">
                  <span className="ayah-number">{ayah.numberInSurah.toLocaleString("ar")}</span>
                  <div>
                    <button className={savedAyahs.includes(id) ? "icon-button saved" : "icon-button"} aria-label={savedAyahs.includes(id) ? "إزالة الآية من المحفوظات" : "حفظ الآية"} onClick={() => onSave(id)}><Icon name="bookmark" /></button>
                    <button className="icon-button" aria-label="مشاركة الآية" onClick={() => void onShare(`${ayah.text}\n${surah.name} · الآية ${ayah.numberInSurah}`)}><Icon name="share" /></button>
                    {verse && <button className="audio-ayah-button" onClick={() => playFromVerse(verse)}>استمع من الآية</button>}
                  </div>
                </div>
                <button className="ayah-text surah-mode-verse" style={{ fontSize: `${fontSize}px` }} dir="rtl" onClick={() => { if (verse) playFromVerse(verse); }}>
                  {ayah.text}<span className="mushaf-ayah-marker">۞{ayah.numberInSurah.toLocaleString("ar")}۞</span>
                </button>
                <div className="ayah-reference">{surah.name} <i>·</i> الآية {ayah.numberInSurah.toLocaleString("ar")}</div>
                <TafsirPanel surah={surah.number} ayah={ayah.numberInSurah} />
              </article>
            );
          })}
          <div className="surah-pager">
            <button disabled={surah.number === 1} onClick={() => changeSurah(surah.number - 1)}>السورة السابقة</button>
            <span>{surah.number.toLocaleString("ar")} / ١١٤</span>
            <button disabled={surah.number === 114} onClick={() => changeSurah(surah.number + 1)}>السورة التالية</button>
          </div>
        </div>
      )}

      <div className="quran-audio-player" role="region" aria-label="مشغل تلاوة القرآن">
        <audio
          ref={audioRef}
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={playNextAyah}
          onError={() => {
            setIsPlaying(false);
            setShouldPlay(false);
            setAudioError("تعذر تحميل ملف التلاوة؛ تحقق من اتصال الإنترنت.");
          }}
        />
        <button className="audio-main-button" aria-label={isPlaying ? "إيقاف التلاوة مؤقتًا" : "تشغيل التلاوة"} onClick={togglePlayback}>
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <div className="audio-player-copy">
          <strong>{QURAN_RECITERS.find((item) => item.id === reciter)?.name}</strong>
          <span>{currentTrack ? `${currentTrack.surah.name} · الآية ${currentTrack.ayah.numberInSurah.toLocaleString("ar")}` : `صفحة ${pageNumber.toLocaleString("ar")} · اضغط تشغيل للاستماع`}</span>
        </div>
        <button className="audio-queue-button audio-page-button" aria-label="تشغيل تلاوة الصفحة الحالية" onClick={() => playQueue(pageAudioSource)}>الصفحة</button>
        <button className="audio-queue-button audio-surah-button" aria-label="تشغيل تلاوة السورة الحالية" onClick={() => playQueue(surahAudioSource)}>السورة</button>
        <button className="audio-next-button" aria-label="الآية التالية" disabled={!audioQueue.length || playbackIndex + 1 >= audioQueue.length} onClick={playNextAyah}>التالي</button>
      </div>
    </div>
  );
}

function HadithCard({ hadith, collection, saved, bookmarked, onSave, onBookmark, onShare }: {
  hadith: Hadith;
  collection: Collection;
  saved: boolean;
  bookmarked: boolean;
  onSave: () => void;
  onBookmark: () => void;
  onShare: (text: string) => void;
}) {
  const sectionName = hadith.reference?.book
    ? `الباب ${hadith.reference.book.toLocaleString("ar")}`
    : collectionNames[collection];
  return <article className="hadith-card"><div className="hadith-card-top"><span className="hadith-ref"><span className="ref-seal">ح</span><span><strong>{collectionNames[collection]}</strong><small>{sectionName} · رقم {hadith.hadithnumber.toLocaleString("ar")}</small></span></span><div><button className={saved ? "icon-button saved" : "icon-button"} aria-label={saved ? "إزالة من المفضلة" : "إضافة إلى المفضلة"} onClick={onSave}><Icon name="heart" /></button><button className={bookmarked ? "icon-button saved" : "icon-button"} aria-label={bookmarked ? "إزالة العلامة المرجعية" : "إضافة علامة مرجعية"} onClick={onBookmark}><Icon name="bookmark" /></button><button className="icon-button" aria-label="مشاركة الحديث" onClick={() => void onShare(`${hadith.text}\n${collectionNames[collection]} · ${hadith.hadithnumber}`)}><Icon name="share" /></button></div></div><p className="hadith-text" dir="rtl">{hadith.text}</p><div className="hadith-card-bottom"><span>{sectionName}</span><span>رقم الحديث · {hadith.hadithnumber.toLocaleString("ar")}</span></div></article>;
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="section-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>;
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button role="tab" aria-selected={active} className={active ? "segment active" : "segment"} onClick={onClick}>{children}</button>;
}

function NavButton({ active, icon, label, onClick, compact = false }: { active: boolean; icon: "home" | "book" | "quote" | "clock" | "compass"; label: string; onClick: () => void; compact?: boolean }) {
  return <button className={`${active ? "nav-item active" : "nav-item"}${compact ? " compact" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon name={icon} /><span>{label}</span>{active && !compact && <i className="nav-indicator" />}</button>;
}

function Icon({ name }: { name: "home" | "book" | "quote" | "clock" | "compass" | "heart" | "search" | "bookmark" | "share" | "arrow" | "close" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20" /><path d="M8 7h8" /></>,
    quote: <><path d="M4 5h16v12H9l-5 4z" /><path d="M8 9h.01M12 9h.01M16 9h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" /></>,
    heart: <><path d="M20.8 8.7c0 5.2-8.8 10.1-8.8 10.1S3.2 13.9 3.2 8.7A4.2 4.2 0 0 1 11 6.4l1 1 1-1a4.2 4.2 0 0 1 7.8 2.3z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    bookmark: <><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z" /></>,
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.4m-7.5 9.2 7.5 4.4" /></>,
    arrow: <><path d="M19 12H5" /><path d="m12 5-7 7 7 7" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Loading({ label }: { label: string }) {
  return <div className="loading"><span className="spinner" /><span>{label}</span></div>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="error-banner" role="alert"><strong>تعذر تحميل المحتوى</strong><span>{message}</span><small>تحقّق من وجود ملفات البيانات في public/data ثم أعد تشغيل التطبيق.</small></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-mark">۞</span><strong>{title}</strong><p>{detail}</p></div>;
}

export default App;
