import { isKapitalgesellschaft, ownerLabels } from "@haben/core";
import { formatDate } from "../../../lib/format.ts";
import type { DocumentFormState } from "./-beleg-zustand.ts";
import type { Detail } from "./-beleg-vorschau.tsx";

/** Bezahlung früherer Belege desselben Lieferanten, für den Hinweis unter „Bezahlung“ (#295) */
function paymentHintText(payment: "bank" | "privat" | "kasse", gesellschaft: boolean): string {
  if (payment === "bank") return "über das Geschäftskonto bezahlt";
  if (payment === "kasse") return "bar aus der Kasse bezahlt";
  return gesellschaft ? "vom Gesellschafter ausgelegt" : "privat bezahlt";
}

/** Karte „Bezahlung“: Geschäftskonto, privat oder Kasse, dazu Gutschrift und Hinweis aus früheren Belegen */
export function Bezahlung({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { readOnly, running, payment, setPayment, erstattetBezahltes, setErstattetBezahltes, gross, touch } = f;
  return (
    <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Bezahlung</legend>
      <label className="checkbox">
        <input type="radio" name="payment" checked={payment === "bank"} onChange={() => touch(setPayment)("bank")} />
        Über das Geschäftskonto (Zuordnung beim Bankabgleich)
      </label>
      <label className="checkbox">
        <input type="radio" name="payment" checked={payment === "privat"} onChange={() => touch(setPayment)("privat")} />
        {ownerLabels(data.rechtsform).documentPaid}
      </label>
      <label className="checkbox">
        <input type="radio" name="payment" checked={payment === "kasse"} onChange={() => touch(setPayment)("kasse")} />
        Bar aus der Kasse (Zeile im Kassenbuch)
      </label>
      {/* Nur an einer Gutschrift über die Bank: sie mindert ein schon bezahltes Entgelt, die Vorsteuer wartet auf den Ausgleich */}
      {gross !== null && gross < 0 && payment === "bank" && (
        <div>
          <label className="checkbox">
            <input type="checkbox" checked={erstattetBezahltes} onChange={(e) => touch(setErstattetBezahltes)(e.target.checked)} />
            Erstattet bereits Bezahltes (Guthaben aus einer Jahresabrechnung, Bonus)
          </label>
          <span className="small muted">
            Dann mindert die Gutschrift die Vorsteuer erst, wenn das Geld zurückkommt oder verrechnet wird. Ohne Haken mindert sie die Vorsteuer im Belegmonat.
          </span>
          <details>
            <summary className="small">Details zum Konto</summary>
            <p className="small muted" style={{ margin: "8px 0 0" }}>
              Bis das Geld zurückkommt, steht die Vorsteuer auf dem Zwischenkonto „Vorsteuer in Folgeperiode abziehbar“ (SKR03 1548, SKR04 1434).
            </p>
          </details>
        </div>
      )}
      {data.paymentHint && (
        <span className="small">
          Bisher{" "}
          {data.paymentHint.count === data.paymentHint.total ? `${data.paymentHint.count}×` : `${data.paymentHint.count} von ${data.paymentHint.total} Belegen`}{" "}
          {paymentHintText(data.paymentHint.payment, isKapitalgesellschaft(data.rechtsform))}, zuletzt am {formatDate(data.paymentHint.last)}
          {payment !== data.paymentHint.payment && (
            <>
              {" · "}
              <button type="button" className="link-button" onClick={() => touch(setPayment)(data.paymentHint!.payment)}>
                übernehmen
              </button>
            </>
          )}
        </span>
      )}
    </fieldset>
  );
}
