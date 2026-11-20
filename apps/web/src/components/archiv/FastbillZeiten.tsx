import { formatDuration, formatEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../../lib/use-action.ts";
import { importFastbillTimesFn, previewFastbillTimesFn } from "../../server/functions/fastbill.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { ScrollTable } from "../ScrollTable.tsx";

/* Archiv › Umzug aus FastBill: offene Zeiten als Zeiteinträge (#1522). Erst die Vorschau, übernommen wird erst auf Knopfdruck. */

type Plan = Awaited<ReturnType<typeof previewFastbillTimesFn>>;

export function FastbillZeiten() {
  const previewFn = useServerFn(previewFastbillTimesFn);
  const importFn = useServerFn(importFastbillTimesFn);
  const action = useAction();
  // Danach neu laden: Die Verbindung zeigt die genutzten Anfragen der Stunde
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);

  const preview = () =>
    action.run(async () => {
      setPlan(await previewFn());
      await router.invalidate();
    });
  const take = () =>
    action.run(async () => {
      const result = await importFn();
      setPlan(null);
      await router.invalidate();
      const failed = result.failed.length ? `, ${result.failed.length} nicht übernommen` : "";
      action.setNotice({ tone: "ok", text: `${result.created} Zeiteinträge angelegt, ${result.updated} aktualisiert${failed}.` });
    });

  return (
    <section className="card stack" aria-labelledby="fastbill-times-heading">
      <h2 id="fastbill-times-heading" style={{ margin: 0 }}>
        Offene Zeiten
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Zeiten aus FastBill, die noch auf keiner Rechnung stehen, kommen als Zeiteinträge zum Kunden; abgerechnete stecken schon in den Rechnungen im Archiv.
        Der Projektname steht als Text am Eintrag, der Satz des Projekts gilt als Stundensatz. Ein zweiter Abruf aktualisiert statt zu verdoppeln.
      </p>
      <NoticeBanner notice={action.notice} />
      {plan && <TimesPlan plan={plan} />}
      <div className="actions">
        <button type="button" className="btn" disabled={action.busy} onClick={preview}>
          {plan ? "Vorschau neu holen" : "Vorschau holen"}
        </button>
        {plan && plan.ready > 0 && (
          <button type="button" className="btn btn-primary" disabled={action.busy} onClick={take}>
            {plan.ready} {plan.ready === 1 ? "Zeiteintrag" : "Zeiteinträge"} übernehmen
          </button>
        )}
      </div>
    </section>
  );
}

function TimesPlan({ plan }: { plan: Plan }) {
  return (
    <>
      <p className="small" role="status" style={{ margin: 0 }}>
        {plan.ready} offen und übernehmbar, {plan.problems.length} mit Fehlern, {plan.billed} in FastBill abgerechnet und {plan.billedInHaben} in Haben
        abgerechnet, beide nicht übernommen.
      </p>
      {plan.customers.length > 0 && (
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th scope="col">Kunde</th>
              <th scope="col" className="num">
                Einträge
              </th>
              <th scope="col" className="num">
                Dauer
              </th>
              <th scope="col" className="num">
                Summe netto
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.customers.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="num">{c.entries}</td>
                <td className="num">{formatDuration(c.minutes)} Std.</td>
                <td className="num">{formatEuro(c.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {plan.problems.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {plan.problems.map((p) => (
            <li key={p.timeId}>
              {p.customer}, Zeit {p.timeId}: {p.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
