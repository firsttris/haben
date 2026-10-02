import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState, type FormEvent } from "react";
import { errorMessage } from "../../lib/format.ts";
import { uploadArchiveFiles } from "../../server/functions/archive.ts";

type Message = { tone: "ok" | "warn" | "danger"; text: string };
type Kind = { value: "datev" | "idea" | "elster" | "kontoauszug" | "sonstiges"; label: string };

export function ArchiveUpload({ kinds }: { kinds: Kind[] }) {
  const router = useRouter();
  const upload = useServerFn(uploadArchiveFiles);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [kind, setKind] = useState<Kind["value"]>("datev");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const files = [...(fileInput.current?.files ?? [])];
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      form.append("kind", kind);
      form.append("year", year);
      const results = await upload({ data: form });
      setMessages(
        results.flatMap((r): Message[] =>
          r.error
            ? [{ tone: "danger", text: r.error }]
            : [
                {
                  tone: "ok",
                  text: r.bookings ? `${r.filename}: archiviert, ${r.bookings} Buchungen übernommen.` : `${r.filename}: archiviert.`,
                },
                ...(r.warnings ?? []).slice(0, 5).map((w) => ({ tone: "warn" as const, text: `${r.filename}: ${w}` })),
              ],
        ),
      );
      if (fileInput.current) fileInput.current.value = "";
      await router.invalidate();
    } catch (e) {
      setMessages([{ tone: "danger", text: errorMessage(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} style={{ gap: 12 }}>
      <div className="upload-row">
        <label className="field" htmlFor={`${id}-kind`}>
          Art
          <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as Kind["value"])}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={`${id}-year`}>
          Geschäftsjahr
          <input
            id={`${id}-year`}
            inputMode="numeric"
            placeholder={kind === "datev" ? "aus der Datei" : "z. B. 2024"}
            value={year}
            onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </label>
        <label className="field" htmlFor={`${id}-files`}>
          Dateien
          <input id={`${id}-files`} ref={fileInput} type="file" multiple aria-label="Dateien für das Archiv" />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Lade hoch …" : "Ins Archiv legen"}
        </button>
      </div>
      {messages.length > 0 && (
        <ul className="upload-messages" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone === "ok" ? "ok" : m.tone === "warn" ? "info" : "danger"}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
