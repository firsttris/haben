import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState } from "react";
import { errorMessage, formatSize } from "../lib/format.ts";
import { removeInvoiceAttachmentFn, uploadInvoiceAttachments, type AttachmentKind } from "../server/functions/invoice-attachments.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

export interface AttachmentRow {
  id: string;
  filename: string;
  size: number;
}

type Message = { tone: "ok" | "info" | "danger"; text: string };

/** Was sich je Belegart unterscheidet: Download-Route und Wortlaut */
const KINDS = {
  rechnung: {
    heading: "Anhänge",
    empty: "Keine zusätzlichen Anhänge.",
    href: "/api/rechnungsanhang",
    owner: "dieser Rechnung",
    removeHint: "Der Anhang verschwindet aus diesem Entwurf. Nutzt sonst nichts die Datei, wird sie aus Haben gelöscht; hast du sie nur hier, lade sie vorher herunter.",
    examples: "Etwa Stundenzettel oder Leistungsnachweise",
    locked: "Mit der Rechnung festgeschrieben.",
    lockHint: "Mit dem Festschreiben werden die Anhänge zusammen mit der Rechnung gesperrt; PDF und E-Rechnung bleiben unverändert.",
  },
  angebot: {
    heading: "Anhänge",
    empty: "Keine zusätzlichen Anhänge.",
    href: "/api/angebotsanhang",
    owner: "diesem Angebot",
    removeHint: "Der Anhang verschwindet aus diesem Entwurf. Nutzt sonst nichts die Datei, wird sie aus Haben gelöscht; hast du sie nur hier, lade sie vorher herunter.",
    examples: "Etwa AGB, Widerrufsbelehrung oder eine Leistungsbeschreibung",
    locked: "Mit dem Angebot festgeschrieben.",
    lockHint: "Mit dem Festschreiben werden die Anhänge zusammen mit dem Angebot gesperrt; das PDF des Angebots bleibt unverändert.",
  },
  standard: {
    heading: "Standardanhänge für Angebote",
    empty: "Keine Standardanhänge.",
    href: "/api/standardanhang",
    owner: "den Standardanhängen",
    removeHint: "Neue Angebote bekommen die Datei dann nicht mehr. Bestehende Angebote behalten sie.",
    examples: "Etwa AGB oder Widerrufsbelehrung",
    locked: "",
    lockHint:
      "Jedes neue Angebot bekommt sie als Anhänge; im Entwurf lassen sie sich dort entfernen, beim Versand sind sie vorausgewählt. Bestehende Angebote bleiben, wie sie sind.",
  },
} as const;

/**
 * Zusätzliche PDF-Anhänge einer Rechnung (#272) oder eines Angebots (#415), dazu die Standardanhänge für Angebote in
 * den Einstellungen. Im Entwurf hinzufügen und entfernen, nach dem Festschreiben nur noch ansehen und herunterladen. Die Dateiauswahl lädt sofort hoch, ein eigenes Formular gibt
 * es nicht: Im Editor steht der Abschnitt im Formular des Belegs.
 */
export function InvoiceAttachments({
  kind = "rechnung",
  ownerId,
  attachments,
  editable,
}: {
  kind?: AttachmentKind;
  /** Rechnung oder Angebot; leer bei den Standardanhängen */
  ownerId?: string;
  attachments: AttachmentRow[];
  editable: boolean;
}) {
  const text = KINDS[kind];
  const router = useRouter();
  const upload = useServerFn(uploadInvoiceAttachments);
  const remove = useServerFn(removeInvoiceAttachmentFn);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [removing, setRemoving] = useState<AttachmentRow | null>(null);

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
      form.append("kind", kind);
      if (ownerId) form.append("ownerId", ownerId);
      for (const file of files) form.append("files", file);
      const results = await upload({ data: form });
      return results.map((r) =>
        r.error
          ? { tone: "danger" as const, text: r.error }
          : r.duplicate
            ? { tone: "info" as const, text: `${r.filename}: hängt schon an ${text.owner}.` }
            : { tone: "ok" as const, text: `${r.filename}: angehängt.` },
      );
    });
  };

  const onRemove = (row: AttachmentRow) =>
    void work(async () => {
      await remove({ data: { kind, ownerId, id: row.id } });
      return [{ tone: "ok", text: `${row.filename}: entfernt.` }];
    });

  if (!editable && attachments.length === 0) return null;

  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>{text.heading}</h2>
      <ConfirmDialog
        open={removing !== null}
        title={`${removing?.filename} entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={() => {
          if (removing) onRemove(removing);
        }}
        onClose={() => setRemoving(null)}
      >
        <p>{text.removeHint}</p>
      </ConfirmDialog>
      {attachments.length > 0 ? (
        <ul className="stack" style={{ gap: 8, listStyle: "none", margin: 0, padding: 0 }} aria-label="Zusätzliche Anhänge">
          {attachments.map((row) => (
            <li key={row.id} className="history-row">
              <a href={`${text.href}/${row.id}`} target="_blank" rel="noreferrer" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {row.filename}
              </a>
              <span className="small muted">
                {formatSize(row.size)}{" "}
                <a className="link-button" href={`${text.href}/${row.id}?download`} aria-label={`${row.filename} herunterladen`}>
                  Herunterladen
                </a>
                {editable && (
                  <>
                    {" · "}
                    <button type="button" className="link-button" disabled={busy} onClick={() => setRemoving(row)} aria-label={`${row.filename} entfernen`}>
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
          {text.empty}
        </p>
      )}
      {editable ? (
        <>
          <p id={hintId} className="small muted" style={{ margin: 0 }}>
            {text.examples}: nur PDF, bis 20 MB je Datei.{kind === "standard" ? "" : " Beim Versand per E-Mail wählst du, welche mitgehen."} {text.lockHint}
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
          {text.locked}
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
