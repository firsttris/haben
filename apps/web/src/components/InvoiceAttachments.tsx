import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState } from "react";
import { errorMessage, formatSize } from "../lib/format.ts";
import { removeInvoiceAttachmentFn, uploadInvoiceAttachments } from "../server/functions/invoice-attachments.ts";

export interface AttachmentRow {
  id: string;
  filename: string;
  size: number;
}

type Message = { tone: "ok" | "info" | "danger"; text: string };

/**
 * Zusätzliche PDF-Anhänge einer Rechnung (#272). Im Entwurf hinzufügen und entfernen, nach dem Festschreiben nur noch
 * ansehen und herunterladen. Die Dateiauswahl lädt sofort hoch, ein eigenes Formular gibt es nicht: Im Editor steht
 * der Abschnitt im Formular der Rechnung.
 */
export function InvoiceAttachments({ invoiceId, attachments, editable }: { invoiceId: string; attachments: AttachmentRow[]; editable: boolean }) {
  const router = useRouter();
  const upload = useServerFn(uploadInvoiceAttachments);
  const remove = useServerFn(removeInvoiceAttachmentFn);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  async function work(action: () => Promise<Message[]>) {
    setBusy(true);
    setMessages([]);
    try {
      setMessages(await action());
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const send = (files: File[]) => {
    if (files.length === 0) return;
    void work(async () => {
      const form = new FormData();
      form.append("invoiceId", invoiceId);
      for (const file of files) form.append("files", file);
      const results = await upload({ data: form });
      return results.map((r) =>
        r.error
          ? { tone: "danger" as const, text: r.error }
          : r.duplicate
            ? { tone: "info" as const, text: `${r.filename}: hängt schon an dieser Rechnung.` }
            : { tone: "ok" as const, text: `${r.filename}: angehängt.` },
      );
    });
  };

  const onRemove = (row: AttachmentRow) =>
    void work(async () => {
      await remove({ data: { invoiceId, id: row.id } });
      return [{ tone: "ok", text: `${row.filename}: entfernt.` }];
    });

  if (!editable && attachments.length === 0) return null;

  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>Anhänge</h2>
      {attachments.length > 0 ? (
        <ul className="stack" style={{ gap: 8, listStyle: "none", margin: 0, padding: 0 }} aria-label="Zusätzliche Anhänge">
          {attachments.map((row) => (
            <li key={row.id} className="history-row">
              <a href={`/api/rechnungsanhang/${row.id}`} target="_blank" rel="noreferrer" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {row.filename}
              </a>
              <span className="small muted">
                {formatSize(row.size)}{" "}
                <a className="link-button" href={`/api/rechnungsanhang/${row.id}?download`} aria-label={`${row.filename} herunterladen`}>
                  Herunterladen
                </a>
                {editable && (
                  <>
                    {" · "}
                    <button type="button" className="link-button" disabled={busy} onClick={() => onRemove(row)} aria-label={`${row.filename} entfernen`}>
                      Entfernen
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Keine zusätzlichen Anhänge.
        </p>
      )}
      {editable ? (
        <>
          <p id={hintId} className="small muted" style={{ margin: 0 }}>
            Etwa Stundenzettel oder Leistungsnachweise: nur PDF, bis 20 MB je Datei. Beim Versand per E-Mail wählst du, welche mitgehen. Mit dem Festschreiben
            werden die Anhänge zusammen mit der Rechnung gesperrt; PDF und E-Rechnung bleiben unverändert.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy} aria-describedby={hintId}>
              {busy ? "Wird hochgeladen …" : "PDF anhängen"}
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="application/pdf,.pdf"
            className="visually-hidden"
            aria-label="PDF-Anhänge auswählen"
            aria-describedby={hintId}
            tabIndex={-1}
            onChange={(event) => send([...(event.target.files ?? [])])}
          />
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Mit der Rechnung festgeschrieben.
        </p>
      )}
      {messages.length > 0 && (
        <ul className="upload-messages" role="status">
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
