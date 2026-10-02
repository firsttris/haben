import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState, type DragEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import { uploadDocuments } from "../server/functions/documents.ts";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,.xml,application/xml,text/xml";

/** Ablagefläche für Belege: Ziehen und Ablegen, Dateiauswahl oder Kamera (Handy). */
export function DocumentUpload({ aiAvailable }: { aiAvailable: boolean }) {
  const router = useRouter();
  const upload = useServerFn(uploadDocuments);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ tone: "ok" | "warn" | "danger"; text: string }[]>([]);

  async function send(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const results = await upload({ data: form });
      setMessages(
        results.map((r) =>
          r.error
            ? { tone: "danger" as const, text: r.error }
            : r.duplicate
              ? { tone: "warn" as const, text: `${r.filename}: liegt schon in Haben, nicht doppelt abgelegt.` }
              : { tone: "ok" as const, text: `${r.filename}: abgelegt.` },
        ),
      );
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void send([...event.dataTransfer.files]);
  }

  return (
    <section className="card" aria-label="Belege hochladen">
      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <div style={{ fontWeight: 500 }}>
          {busy ? "Wird abgelegt …" : (
            <>
              <span className="pointer-fine">Belege hierher ziehen</span>
              <span className="camera-only-text">Beleg fotografieren oder Datei wählen</span>
            </>
          )}
        </div>
        <p id={hintId} className="small muted" style={{ margin: 0, textAlign: "center" }}>
          PDF, Foto oder E-Rechnung (XRechnung, ZUGFeRD), bis 20 MB. E-Rechnungen liest Haben direkt aus
          {aiAvailable ? ", andere Belege liest die KI vor; du bestätigst immer selbst." : "; andere Belege füllst du von Hand aus."}
        </p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            Dateien auswählen
          </button>
          <button type="button" className="btn camera-only" onClick={() => cameraInput.current?.click()} disabled={busy}>
            Foto aufnehmen
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="visually-hidden"
          aria-describedby={hintId}
          tabIndex={-1}
          onChange={(event) => void send([...(event.target.files ?? [])])}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => void send([...(event.target.files ?? [])])}
        />
      </div>
      {messages.length > 0 && (
        <ul className="upload-messages" role="status">
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone === "warn" ? "info" : m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
