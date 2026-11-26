import { useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTafsirText(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  return typeof payload.data.text === "string" && payload.data.text.trim()
    ? payload.data.text
    : null;
}

export default function TafsirPanel({ surah, ayah }: { surah: number; ayah: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  async function toggleTafsir() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || text || loading) return;

    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar.muyassar`,
      );
      if (!response.ok) throw new Error(`تعذر تحميل التفسير (${response.status}).`);
      const payload: unknown = await response.json();
      const tafsir = readTafsirText(payload);
      if (!tafsir) throw new Error("استجابة مصدر التفسير غير مكتملة.");
      setText(tafsir);
    } catch (reason) {
      console.error("Could not load the requested tafsir.", reason);
      setError(reason instanceof Error ? reason.message : "تعذر تحميل التفسير.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tafsir-control">
      <button
        className="tafsir-toggle"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          void toggleTafsir();
        }}
      >
        {open ? "إخفاء التفسير" : "تفسير الميسر"}
      </button>
      {open && (
        <div className="tafsir-text" aria-live="polite">
          {loading && <span>جارٍ تحميل تفسير الآية…</span>}
          {error && <span className="devotion-error" role="alert">{error}</span>}
          {text && <p>{text}</p>}
          <small>
            تفسير الميسر ·{" "}
            <a
              href={`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar.muyassar`}
              target="_blank"
              rel="noreferrer"
            >
              AlQuran Cloud
            </a>
          </small>
        </div>
      )}
    </div>
  );
}
