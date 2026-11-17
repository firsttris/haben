import { formatEuro } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";
import type { getBankOverview } from "../server/functions/bank.ts";
import { takeOverStorePayoutFn } from "../server/functions/stores.ts";

type StorePayoutView = NonNullable<NonNullable<Awaited<ReturnType<typeof getBankOverview>>["detail"]>["storePayout"]>;

/**
 * Eingang von Google Play oder App Store auf dem Bankkonto: Haben legt die Auszahlung im Konto des Stores an und bucht
 * beide Seiten als Geldtransit, bei Apple mit Kursdifferenz. Gewählt werden die Monatsumsätze, die die Zahlung bezahlt.
 */
export function StorePayoutBox({
  view,
  amount,
  transactionId,
  busy,
  run,
}: {
  view: StorePayoutView;
  amount: number;
  transactionId: string;
  busy: boolean;
  run: (work: () => Promise<unknown>) => void;
}) {
  const takeOver = useServerFn(takeOverStorePayoutFn);
  const [chosen, setChosen] = useState(() => new Set(view.months.filter((m) => m.suggested).map((m) => m.id)));
  const sum = view.months.filter((m) => chosen.has(m.id)).reduce((s, m) => s + m.amount, 0);
  const difference = amount - sum;

  if (!view.accountName) {
    return (
      <div className="banner banner-info" role="status">
        Eingang von {view.label}: Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter {view.label} an, dann übernimmt Haben die Monatsberichte
        und diese Auszahlung.
      </div>
    );
  }
  if (view.months.length === 0) {
    return (
      <div className="banner banner-info" role="status">
        Eingang von {view.label}: Im Konto {view.accountName} steht kein Monat, der noch nicht ausgezahlt ist. Fehlt der Bericht noch, unter Einstellungen ›
        Bank abrufen.
      </div>
    );
  }

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="stack" style={{ gap: 10 }} role="group" aria-labelledby="store-payout-heading">
      <div className="section-label" id="store-payout-heading">
        Auszahlung von {view.label}
      </div>
      <div className="match-card">
        <p className="small muted" style={{ margin: 0 }}>
          Welche Monate bezahlt dieser Eingang? Haben legt die Auszahlung in {view.accountName} an und bucht beide Seiten als Geldtransit
          {view.store === "appstore" ? "; die Abweichung zu den umgerechneten Monatsbeträgen als Kursdifferenz" : ""}.
        </p>
        {view.months.map((month) => (
          <label key={month.id} className="checkbox">
            <input type="checkbox" checked={chosen.has(month.id)} onChange={() => toggle(month.id)} disabled={busy} />
            <span>
              {formatDate(month.bookingDate)} · <span className="amount">{formatEuro(month.amount)}</span>
              <span className="small muted" style={{ display: "block" }}>
                {month.purpose}
              </span>
            </span>
          </label>
        ))}
        <p className="small" style={{ margin: 0 }}>
          Gewählt <span className="amount">{formatEuro(sum)}</span>, Eingang <span className="amount">{formatEuro(amount)}</span>
          {difference !== 0 && (
            <>
              {view.store === "appstore" ? " · Kursdifferenz " : " · Abweichung "}
              <span className="amount">{formatEuro(difference)}</span>
            </>
          )}
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || chosen.size === 0 || (view.store === "googleplay" && difference !== 0)}
            onClick={() => run(() => takeOver({ data: { transactionId, monthIds: [...chosen] } }))}
          >
            Als Auszahlung buchen
          </button>
        </div>
      </div>
    </div>
  );
}
