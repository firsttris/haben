import { MANDAT_SCHEMA_LABEL, type MandatStatus } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useRef, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { revokeMandateFn, saveMandate, uploadMandateFile } from "../server/functions/mandate.ts";
import type { Mandate } from "../server/modules/stammdaten/index.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Mandate eines Kunden für SEPA-Lastschriften (#445): anlegen, PDF hinterlegen, widerrufen; nichts wird überschrieben */

type Props = {
  contactId: string;
  contactName: string;
  contactIban: string;
  isCustomer: boolean;
  mandates: Mandate[];
  today: string;
};

function statusPill(status: MandatStatus) {
  switch (status.art) {
    case "gueltig":
      return <span className="pill pill-ok">Gültig bis {formatDate(status.bis)}</span>;
    case "abgelaufen":
      return <span className="pill pill-warn">Abgelaufen seit {formatDate(status.seit)}</span>;
    case "widerrufen":
      return <span className="pill pill-danger">Widerrufen ab {formatDate(status.seit)}</span>;
    case "noch-nicht":
      return <span className="pill pill-info">Gilt ab {formatDate(status.ab)}</span>;
  }
}

export function MandateCard({ contactId, contactName, contactIban, isCustomer, mandates, today }: Props) {
  const router = useRouter();
  const save = useServerFn(saveMandate);
  const revoke = useServerFn(revokeMandateFn);
  const upload = useServerFn(uploadMandateFile);
  const { busy, notice, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [migrated, setMigrated] = useState(false);
  const [revoking, setRevoking] = useState<Mandate | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    void run(async () => {
      await save({
        data: {
          contactId,
          mandate: {
            reference: text("reference"),
            signedOn: text("signedOn"),
            scheme: text("scheme") === "B2B" ? "B2B" : "CORE",
            firstSequence: migrated ? "RCUR" : "FRST",
            lastCollectionBefore: migrated && text("lastCollectionBefore") ? text("lastCollectionBefore") : null,
            debtorName: text("debtorName"),
            debtorIban: text("debtorIban"),
            debtorBic: text("debtorBic"),
          },
        },
      });
      setAdding(false);
      setMigrated(false);
      await router.invalidate();
    }, "Mandat angelegt.");
  }

  function onRevoke(mandate: Mandate) {
    void run(async () => {
      await revoke({ data: { id: mandate.id, revocation: { revokedOn: today, reason: "" } } });
      await router.invalidate();
    }, "Mandat widerrufen.");
  }

  function onFile(mandate: Mandate, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.set("id", mandate.id);
    data.set("file", file);
    void run(async () => {
      await upload({ data });
      input.value = "";
      await router.invalidate();
    }, "PDF hinterlegt.");
  }

  return (
    <section className="card" aria-labelledby="mandate-heading">
      <h2 id="mandate-heading">SEPA-Lastschriftmandate</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Mit einem Mandat ziehst du Rechnungen per Lastschrift ein. Es verfällt nach 36 Monaten ohne Einzug. Ändert sich etwas, legst du ein neues an; das alte
        bleibt im Verlauf.
      </p>
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={revoking !== null}
        title="Mandat widerrufen?"
        facts={
          revoking
            ? [
                { label: "Mandatsreferenz", value: revoking.reference, strong: true },
                { label: "Ab", value: formatDate(today) },
              ]
            : undefined
        }
        confirmLabel="Widerrufen"
        danger
        onConfirm={() => revoking && onRevoke(revoking)}
        onClose={() => setRevoking(null)}
      >
        <p>Ab heute zieht Haben auf dieses Mandat nichts mehr ein. Der Widerruf lässt sich nicht zurücknehmen; für neue Einzüge braucht es ein neues Mandat.</p>
      </ConfirmDialog>
      {mandates.map((m) => (
        <MandateRow key={m.id} mandate={m} busy={busy} onFile={(input) => onFile(m, input)} onRevoke={() => setRevoking(m)} />
      ))}
      {mandates.length === 0 && !adding && (
        <p className="small muted" style={{ margin: 0 }}>
          {isCustomer ? "Noch kein Mandat." : "Mandate gibt es nur von Kunden."}
        </p>
      )}
      {isCustomer && !adding && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Mandat anlegen
          </button>
        </div>
      )}
      {adding && (
        <form className="stack" onSubmit={onSubmit} aria-label="Neues Mandat">
          <label className="field">
            Mandatsreferenz
            <input name="reference" required maxLength={35} className="mono" aria-describedby="reference-hint" />
            <span id="reference-hint" className="field-hint">
              Steht auf dem Mandat; bis 35 Zeichen, nur A–Z, a–z, 0–9, Leerzeichen und + ? / - : ( ) . , &apos;
            </span>
          </label>
          <div className="form-row cols-2">
            <label className="field">
              Unterschrieben am
              <input name="signedOn" type="date" required max={today} defaultValue={today} />
            </label>
            <label className="field">
              Verfahren
              <select name="scheme" defaultValue="CORE">
                <option value="CORE">{MANDAT_SCHEMA_LABEL.CORE}</option>
                <option value="B2B">{MANDAT_SCHEMA_LABEL.B2B}</option>
              </select>
            </label>
          </div>
          <label className="field">
            Kontoinhaber
            <input name="debtorName" required maxLength={70} defaultValue={contactName} />
          </label>
          <div className="form-row cols-2">
            <label className="field">
              IBAN
              <input name="debtorIban" required defaultValue={contactIban} className="mono" />
            </label>
            <label className="field">
              BIC (optional)
              <input name="debtorBic" className="mono" />
            </label>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={migrated} onChange={(e) => setMigrated(e.target.checked)} />
            <span>Auf dieses Mandat wurde schon eingezogen (Folgelastschrift)</span>
          </label>
          {migrated && (
            <label className="field">
              Letzter Einzug
              <input name="lastCollectionBefore" type="date" max={today} aria-describedby="last-collection-hint" />
              <span id="last-collection-hint" className="field-hint">
                Ab diesem Tag zählen die 36 Monate bis zum Verfall. Leer, wenn unbekannt; dann zählt die Unterschrift.
              </span>
            </label>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Mandat speichern
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setAdding(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type RowProps = { mandate: Mandate; busy: boolean; onFile: (input: HTMLInputElement) => void; onRevoke: () => void };

/** Ein Mandat: Referenz und Status, Angaben, PDF und Widerruf */
function MandateRow({ mandate: m, busy, onFile, onRevoke }: RowProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfLabel = m.file ? "Anderes PDF hinterlegen" : "PDF hinterlegen";
  return (
    <div className="history-row stack" style={{ alignItems: "stretch", gap: 4 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong className="mono">{m.reference}</strong>
        {statusPill(m.status)}
      </div>
      <span className="small muted">
        {MANDAT_SCHEMA_LABEL[m.scheme]}, unterschrieben am {formatDate(m.signedOn)}
        {m.lastCollectionBefore ? `, zuletzt eingezogen am ${formatDate(m.lastCollectionBefore)}` : ""}
      </span>
      <span className="small muted mono">{m.debtorIban}</span>
      <div className="actions" style={{ alignItems: "center", marginTop: 4 }}>
        {m.file ? (
          <a className="small" href={`/api/mandat/${m.id}`} target="_blank" rel="noreferrer">
            Mandat als PDF
          </a>
        ) : (
          <span className="small muted">Noch kein PDF</span>
        )}
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
          {pdfLabel}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          aria-label={`${pdfLabel}: ${m.reference}`}
          tabIndex={-1}
          onChange={(e) => onFile(e.currentTarget)}
        />
        {!m.revocation && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onRevoke}>
            Widerrufen
          </button>
        )}
      </div>
    </div>
  );
}
