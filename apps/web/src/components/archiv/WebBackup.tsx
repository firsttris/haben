import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import { getImportStatus, uploadLexwareBackup } from "../../server/functions/archive.ts";
import { FilePicker } from "../FilePicker.tsx";

const SCRIPT_URL = "/lexware-sicherung.js";

type Message = { tone: "ok" | "info" | "danger"; text: string } | null;

/**
 * Umzug ohne Public API: Das Skript läuft im angemeldeten Lexware Office und lädt ZIP-Teile herunter;
 * hier werden sie nacheinander hochgeladen. Jeder Teil ist ein eigener Abruf, der Fortschritt steht in Schritt 2.
 */
export function WebBackup() {
  const router = useRouter();
  const upload = useServerFn(uploadLexwareBackup);
  const poll = useServerFn(getImportStatus);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const copyScript = async () => {
    try {
      const script = await fetch(SCRIPT_URL).then((r) => r.text());
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch (e) {
      setMessage({ tone: "danger", text: `Kopieren ging nicht (${errorMessage(e)}). Öffne das Skript über den Link und kopiere es von dort.` });
    }
  };

  /** Wartet, bis der gestartete Abruf fertig ist; liefert dessen Fehler oder null */
  async function waitForImport(): Promise<string | null> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const run = await poll({ data: { source: "lexoffice" } }).catch(() => null);
      if (run && run.status !== "laeuft") return run.status === "fertig" ? null : (run.error ?? "Abgebrochen.");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const files = [...(fileInput.current?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const [index, file] of files.entries()) {
        setMessage({ tone: "info", text: `Teil ${index + 1} von ${files.length} (${file.name}) wird übernommen …` });
        const form = new FormData();
        form.append("files", file);
        await upload({ data: form });
        await router.invalidate();
        const error = await waitForImport();
        await router.invalidate();
        if (error) {
          setMessage({ tone: "danger", text: `${file.name}: ${error}` });
          return;
        }
      }
      setMessage({ tone: "ok", text: `${files.length === 1 ? "Der Teil ist" : `Alle ${files.length} Teile sind`} übernommen. Prüfe in Schritt 2, ob Belege fehlgeschlagen sind.` });
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} style={{ margin: 0 }}>
        Ohne Public API: Sicherung aus der Web-Oberfläche
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Kein Tarif XL? Ein Skript holt dieselben Daten über die Web-Oberfläche, mit deiner Anmeldung in Lexware Office: Kontakte,
        Rechnungen, Gutschriften und Belege mit Original-PDF, E-Rechnungs-XML und Zahlungen. Es liest nur und lädt ZIP-Dateien herunter
        (je bis etwa 50 MB). Bei tausend Belegen dauert das rund eine Viertelstunde.
      </p>
      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>In app.lexware.de anmelden und die Entwicklerwerkzeuge öffnen (F12), dort die Konsole.</li>
        <li>
          Skript einfügen und mit Enter starten. Fragt der Browser beim ersten Einfügen nach einer Bestätigung, tippe ein, was er
          verlangt (in Chrome, Edge und Brave „allow pasting“).
        </li>
        <li>Wenn die Konsole „Fertig“ meldet, alle heruntergeladenen Teile hier hochladen.</li>
      </ol>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copyScript()}>
          {copied ? "Kopiert" : "Skript kopieren"}
        </button>
        <a className="btn" href={SCRIPT_URL} target="_blank" rel="noreferrer">
          Skript ansehen
        </a>
      </div>
      <form className="stack" onSubmit={onSubmit} style={{ gap: 12 }}>
        <label className="field" htmlFor={`${id}-files`}>
          Teile der Sicherung (ZIP)
          <FilePicker id={`${id}-files`} inputRef={fileInput} multiple accept=".zip,application/zip" ariaLabel="Teile der Sicherung" />
        </label>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Übernehme …" : "Hochladen und übernehmen"}
          </button>
        </div>
      </form>
      {message && (
        <div className={`banner banner-${message.tone}`} role={message.tone === "danger" ? "alert" : "status"}>
          {message.text}
        </div>
      )}
    </section>
  );
}
