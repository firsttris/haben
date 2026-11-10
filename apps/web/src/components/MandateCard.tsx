import { MANDAT_SCHEMA_LABEL, type MandatStatus } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { revokeMandateFn, saveMandate, uploadMandateFile } from "../server/functions/mandate.ts";
import type { Mandate } from "../server/modules/stammdaten/index.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Field } from "./Field.tsx";
import { UploadButton } from "./UploadButton.tsx";

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

  function onFile(mandate: Mandate, file: File) {
    const data = new FormData();
    data.set("id", mandate.id);
    data.set("file", file);
    void run(async () => {
      await upload({ data });
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
        <MandateRow key={m.id} mandate={m} busy={busy} onFile={(file) => onFile(m, file)} onRevoke={() => setRevoking(m)} />
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
          <Field label="Mandatsreferenz" hint={<>Steht auf dem Mandat; bis 35 Zeichen, nur A–Z, a–z, 0–9, Leerzeichen und + ? / - : ( ) . , &apos;</>}>
            {(control) => <input {...control} name="reference" required maxLength={35} className="mono" />}
          </Field>
          <div className="form-row cols-2">
            <Field label="Unterschrieben am">{(control) => <input {...control} name="signedOn" type="date" required max={today} defaultValue={today} />}</Field>
            <Field label="Verfahren">
              {(control) => (
                <select {...control} name="scheme" defaultValue="CORE">
                  <option value="CORE">{MANDAT_SCHEMA_LABEL.CORE}</option>
                  <option value="B2B">{MANDAT_SCHEMA_LABEL.B2B}</option>
                </select>
              )}
            </Field>
          </div>
          <Field label="Kontoinhaber">{(control) => <input {...control} name="debtorName" required maxLength={70} defaultValue={contactName} />}</Field>
          <div className="form-row cols-2">
            <Field label="IBAN">{(control) => <input {...control} name="debtorIban" required defaultValue={contactIban} className="mono" />}</Field>
            <Field label="BIC (optional)">{(control) => <input {...control} name="debtorBic" className="mono" />}</Field>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={migrated} onChange={(e) => setMigrated(e.target.checked)} />
            <span>Auf dieses Mandat wurde schon eingezogen (Folgelastschrift)</span>
          </label>
          {migrated && (
            <Field label="Letzter Einzug" hint="Ab diesem Tag zählen die 36 Monate bis zum Verfall. Leer, wenn unbekannt; dann zählt die Unterschrift.">
              {(control) => <input {...control} name="lastCollectionBefore" type="date" max={today} />}
            </Field>
          )}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setAdding(false)}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Mandat speichern
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type RowProps = { mandate: Mandate; busy: boolean; onFile: (file: File) => void; onRevoke: () => void };

/** Ein Mandat: Referenz und Status, Angaben, PDF und Widerruf */
function MandateRow({ mandate: m, busy, onFile, onRevoke }: RowProps) {
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
        <UploadButton
          className="btn btn-sm"
          accept="application/pdf,.pdf"
          disabled={busy}
          inputLabel={`${pdfLabel}: ${m.reference}`}
          onFiles={([file]) => file && onFile(file)}
        >
          {pdfLabel}
        </UploadButton>
        {!m.revocation && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onRevoke}>
            Widerrufen
          </button>
        )}
      </div>
    </div>
  );
}
