import { formatEuro, parseEuro, formatDecimal, WRITE_OFF_KINDS } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { reverseWriteOffFn, writeOffRest } from "../../../server/functions/bank.ts";
import { formatDate } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import type { getInvoiceDetail } from "../../../server/functions/invoices.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { Field } from "../../../components/Field.tsx";

export type PaymentRow = Awaited<ReturnType<typeof getInvoiceDetail>>["payments"][number];

/** Zahlungen auf die Rechnung: über die Bank zugeordnet oder bar im Kassenbuch, dazu der Weg zur Bareinnahme */
export function Payments({ invoiceId, payments, open, cashable }: { invoiceId: string; payments: PaymentRow[]; open: number; cashable: boolean }) {
  return (
    <section className="card" aria-labelledby="payments-heading">
      <h2 id="payments-heading">Zahlungen</h2>
      {payments.length === 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine Zahlung. Überweisungen ordnest du im <Link to="/bank">Bankabgleich</Link> zu.
        </p>
      )}
      {payments.map((p) => (
        <div key={p.id} className="history-row">
          <span style={{ textDecoration: p.reversed ? "line-through" : undefined }}>
            {p.via === "bar" ? "bar" : "Bank"} am {formatDate(p.date)}
            {p.via === "bar" && (
              <span className="small muted">
                {" "}
                · <Link to="/kasse">Kassenbuch Nr. {p.cashNumber}</Link>
              </span>
            )}
          </span>
          <span className="small muted">{p.reversed ? (p.via === "bar" ? "storniert" : "aufgehoben") : formatEuro(p.amount)}</span>
        </div>
      ))}
      {open > 0 && cashable && (
        <div className="actions">
          <Link className="btn" to="/kasse" search={{ rechnung: invoiceId }}>
            Barzahlung in der Kasse erfassen
          </Link>
        </div>
      )}
    </section>
  );
}

export type WriteOffRow = Awaited<ReturnType<typeof getInvoiceDetail>>["writeOffs"][number];

/**
 * Rest ausbuchen (§ 17 UStG): Skonto, das der Kunde abgezogen hat, oder ein Forderungsausfall, etwa bei Insolvenz.
 * Mindert Erlöse und Umsatzsteuer; mit einer Zahlung zusammen geht es im Bankabgleich („Rest als Skonto“).
 */
export function WriteOffs({ invoiceId, open, writeOffs, today }: { invoiceId: string; open: number; writeOffs: WriteOffRow[]; today: string }) {
  const router = useRouter();
  const writeOffFn = useServerFn(writeOffRest);
  const reverseFn = useServerFn(reverseWriteOffFn);
  const { busy, notice, run } = useAction();
  const [kind, setKind] = useState<"skonto" | "forderungsausfall">("forderungsausfall");
  const [amount, setAmount] = useState(formatDecimal(open));
  const [date, setDate] = useState(today);
  const [reversing, setReversing] = useState<WriteOffRow | null>(null);
  const parsed = parseEuro(amount);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (parsed === null || parsed <= 0) return;
    void run(async () => {
      await writeOffFn({ data: { kind, invoiceId, date, amount: parsed } });
      await router.invalidate();
    }, "Ausgebucht.");
  }

  return (
    <section className="card" aria-labelledby="writeoff-heading">
      <h2 id="writeoff-heading">Ausbuchen</h2>
      <ConfirmDialog
        open={reversing !== null}
        title="Ausbuchung aufheben?"
        confirmLabel="Ausbuchung aufheben"
        danger
        facts={
          reversing
            ? [
                { label: "Art", value: WRITE_OFF_KINDS[reversing.kind] },
                { label: "Betrag", value: formatEuro(reversing.amount), strong: true },
              ]
            : []
        }
        onConfirm={() => {
          if (!reversing) return;
          const { id } = reversing;
          void run(async () => {
            await reverseFn({ data: id });
            await router.invalidate();
          });
        }}
        onClose={() => setReversing(null)}
      >
        <p>Haben erzeugt dafür eine Gegenbuchung. Der Betrag ist danach wieder offen, Erlöse und Umsatzsteuer werden entsprechend korrigiert.</p>
      </ConfirmDialog>
      {writeOffs.map((w) => (
        <div key={w.id} className="history-row">
          <span style={{ textDecoration: w.reversed ? "line-through" : undefined }}>
            {WRITE_OFF_KINDS[w.kind]} vom {formatDate(w.date)}
          </span>
          <span className="small muted">
            {w.reversed ? "aufgehoben" : formatEuro(w.amount)}{" "}
            {!w.reversed &&
              (w.transactionId ? (
                "· mit der Zahlung im Bankabgleich aufheben"
              ) : w.cashEntryId ? (
                "· mit der Bareinnahme im Kassenbuch stornieren"
              ) : (
                <button type="button" className="link-button" disabled={busy} onClick={() => setReversing(w)}>
                  Aufheben
                </button>
              ))}
          </span>
        </div>
      ))}
      {open > 0 && (
        <form className="stack" style={{ gap: 10 }} onSubmit={onSubmit}>
          <p className="small muted" style={{ margin: 0 }}>
            Offen sind noch {formatEuro(open)}. Ausbuchen mindert Erlöse und Umsatzsteuer anteilig je Steuersatz (§ 17 UStG), bei Soll-Versteuerung in der
            Voranmeldung des Monats der Ausbuchung. Hat der Kunde Skonto abgezogen, geht es mit der Zahlung zusammen im Bankabgleich oder bei einer Barzahlung
            im Kassenbuch.
          </p>
          <div className="form-grid">
            <Field label="Art">
              {(control) => (
                <select {...control} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="forderungsausfall">{WRITE_OFF_KINDS.forderungsausfall} (uneinbringlich)</option>
                  <option value="skonto">{WRITE_OFF_KINDS.skonto}</option>
                </select>
              )}
            </Field>
            <Field label="Datum">{(control) => <input {...control} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
            <Field label="Betrag">
              {(control) => (
                <input
                  {...control}
                  className="mono"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={parsed === null || parsed <= 0 || parsed > open}
                />
              )}
            </Field>
          </div>
          <NoticeBanner notice={notice} />
          <div className="actions">
            <button type="submit" className="btn" disabled={busy || parsed === null || parsed <= 0 || parsed > open}>
              Ausbuchen
            </button>
          </div>
        </form>
      )}
      {open <= 0 && <NoticeBanner notice={notice} />}
    </section>
  );
}
