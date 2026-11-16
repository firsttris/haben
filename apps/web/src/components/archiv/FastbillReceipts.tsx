import { formatEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useRef, useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import type { getMigration } from "../../server/functions/archive.ts";
import { getFastbillReceiptScriptList, markFastbillReceiptsMissing, uploadFastbillReceipts } from "../../server/functions/fastbill.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";
import { FilePicker } from "../FilePicker.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";

const SCRIPT_URL = "/fastbill-belege.js";
/** Stelle im Skript, an der Haben die Liste der wartenden Ausgaben einsetzt */
const LIST_MARKER = /\/\*HABEN_LISTE\*\/\s*\[\]/;

type Receipt = Awaited<ReturnType<typeof getMigration>>["fastbillReceipts"][number];

/**
 * Ausgaben, deren Beleg FastBill nur im angemeldeten Browser herausgibt. Der Abruf archiviert sie erst, wenn der Beleg
 * aus dem Browser-Skript da ist oder jemand „ohne Beleg übernehmen“ wählt; danach holt „Erneut abrufen“ sie nach.
 */
export function FastbillReceipts({ receipts, running }: { receipts: Receipt[]; running: boolean }) {
  const id = useId();
  const waiting = receipts.filter((r) => r.status === "wartet");
  if (receipts.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} style={{ margin: 0 }}>
        Belege, die FastBill nur im Browser herausgibt
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Bei manchen Ausgaben gibt FastBill den Beleg nur heraus, wenn du im Browser angemeldet bist. Haben archiviert diese Ausgaben deshalb noch nicht, damit
        sie nicht ohne Beleg im unveränderlichen Archiv landen. Ein Skript lädt genau diese Belege mit deiner Anmeldung in FastBill.
      </p>
      <div className="progress-facts">
        <div>
          <span className="small muted">warten auf Beleg</span>
          <strong>{waiting.length}</strong>
        </div>
        <div>
          <span className="small muted">Beleg bereit</span>
          <strong>{receipts.filter((r) => r.status === "datei").length}</strong>
        </div>
        <div>
          <span className="small muted">ohne Beleg</span>
          <strong>{receipts.filter((r) => r.status === "ohne_beleg").length}</strong>
        </div>
      </div>
      {waiting.length === 0 && (
        // Anleitung und Upload sind dann weg; ins Archiv kommen die Ausgaben erst mit dem nächsten Abruf
        <p className="small" role="status" style={{ margin: 0 }}>
          {receipts.length === 1 ? "1 Ausgabe kommt" : `${receipts.length} Ausgaben kommen`} beim nächsten Abruf ins Archiv: Starte in Schritt 2 „Erneut
          abrufen“.
        </p>
      )}
      {waiting.length > 0 && (
        <>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            <li>In my.fastbill.com anmelden und die Entwicklerwerkzeuge öffnen (F12), dort die Konsole.</li>
            <li>
              „Skript kopieren“, in der Konsole einfügen und mit Enter starten. Fragt der Browser beim ersten Einfügen nach einer Bestätigung, tippe ein, was er
              verlangt (in Chrome, Edge und Brave „allow pasting“).
            </li>
            <li>Die heruntergeladenen ZIP-Dateien hier hochladen, danach in Schritt 2 „Erneut abrufen“.</li>
          </ol>
          <ScriptCopy />
          <ReceiptUpload waitingCount={waiting.length} running={running} />
          <WaitingList waiting={waiting} />
        </>
      )}
    </section>
  );
}

/** Skript mit eingesetzter Liste der wartenden Ausgaben; ohne Zwischenablage zum Markieren von Hand */
function ScriptCopy() {
  const scriptList = useServerFn(getFastbillReceiptScriptList);
  const action = useAction();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  const copyScript = () =>
    action.run(async () => {
      const [script, list] = await Promise.all([fetch(SCRIPT_URL).then((r) => r.text()), scriptList()]);
      if (!LIST_MARKER.test(script)) throw new Error("Das Skript hat keine Stelle für die Liste.");
      const text = script.replace(LIST_MARKER, JSON.stringify(list));
      if (await copyText(text)) {
        setManual(null);
        setCopied(true);
      } else {
        setManual(text);
        action.setNotice({ tone: "info", text: "Der Browser lässt nicht in die Zwischenablage schreiben. Markiere das Skript unten und kopiere es von Hand." });
      }
    });

  return (
    <>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copyScript()} disabled={action.busy}>
          {copied ? "Kopiert" : "Skript kopieren"}
        </button>
        <a className="btn" href={SCRIPT_URL} target="_blank" rel="noreferrer">
          Skript ansehen
        </a>
      </div>
      {manual && (
        <Field label="Skript mit der Liste deiner Belege">
          {(control) => (
            <textarea
              {...control}
              readOnly
              rows={6}
              spellCheck={false}
              value={manual}
              onFocus={(event) => event.currentTarget.select()}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          )}
        </Field>
      )}
      <NoticeBanner notice={action.notice} />
    </>
  );
}

/** ZIP-Dateien aus dem Skript hochladen oder den Rest ausdrücklich ohne Beleg übernehmen */
function ReceiptUpload({ waitingCount, running }: { waitingCount: number; running: boolean }) {
  const router = useRouter();
  const upload = useServerFn(uploadFastbillReceipts);
  const markMissing = useServerFn(markFastbillReceiptsMissing);
  const fileInput = useRef<HTMLInputElement>(null);
  const action = useAction();
  const [confirming, setConfirming] = useState(false);

  const onUpload = (event: FormEvent) => {
    event.preventDefault();
    const files = [...(fileInput.current?.files ?? [])];
    if (files.length === 0) return;
    void action.run(async () => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const result = await upload({ data: form });
      if (fileInput.current) fileInput.current.value = "";
      await router.invalidate();
      const parts = [`${result.accepted} Belege zugeordnet. Starte in Schritt 2 „Erneut abrufen“, dann übernimmt Haben die Ausgaben mit ihrem Beleg.`];
      if (result.unknown) parts.push(`${result.unknown} gehörten zu keiner wartenden Ausgabe.`);
      if (result.invalid.length) parts.push(`${result.invalid.length} waren weder PDF noch Bild: ${result.invalid.slice(0, 5).join(", ")}.`);
      action.setNotice({ tone: result.invalid.length ? "danger" : "ok", text: parts.join(" ") });
    });
  };

  const onWithout = () =>
    action.run(async () => {
      const { count } = await markMissing({ data: {} });
      await router.invalidate();
      action.setNotice({ tone: "ok", text: `${count} Ausgaben werden beim nächsten Abruf ohne Beleg übernommen.` });
    });

  return (
    <>
      <form className="stack" onSubmit={onUpload} style={{ gap: 12 }}>
        <Field label="Belege aus dem Skript (ZIP)">
          {(control) => <FilePicker {...control} inputRef={fileInput} multiple accept=".zip,application/zip" />}
        </Field>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.busy || running}>
            {action.busy ? "Lade hoch …" : "Hochladen"}
          </button>
          <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={action.busy || running}>
            Rest ohne Beleg übernehmen
          </button>
        </div>
      </form>
      <NoticeBanner notice={action.notice} />
      <ConfirmDialog
        open={confirming}
        title="Ohne Beleg übernehmen?"
        confirmLabel="Ohne Beleg übernehmen"
        danger
        onConfirm={() => void onWithout()}
        onClose={() => setConfirming(false)}
      >
        <p>
          Die {waitingCount} wartenden Ausgaben kommen beim nächsten Abruf ohne Datei ins Archiv; dort lässt sich später keine Datei mehr anhängen. Wähle das
          nur, wenn es in FastBill zu diesen Ausgaben wirklich keinen Beleg gibt.
        </p>
      </ConfirmDialog>
    </>
  );
}

function WaitingList({ waiting }: { waiting: Receipt[] }) {
  return (
    <details>
      <summary className="small">{waiting.length} Ausgaben ohne Beleg</summary>
      <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        {waiting.slice(0, 200).map((r) => (
          <li key={r.expenseId}>
            {r.date ? formatDate(r.date) : "ohne Datum"} · {r.number || `ID ${r.expenseId}`} · {r.supplier || "ohne Lieferant"} · {formatEuro(r.gross)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Text in die Zwischenablage. navigator.clipboard gibt es nur in einem sicheren Kontext (HTTPS oder localhost); eine
 * Instanz im Heimnetz über http://<IP> hat es nicht. Dann der ältere Weg über ein markiertes Textfeld; geht auch der
 * nicht, false, und die Seite zeigt das Skript zum Kopieren von Hand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // weiter mit dem älteren Weg
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
