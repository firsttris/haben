import { formatEuro, parsePeriodKey, periodKey, periodLabel, ZM_ART_LABEL, zmEuro } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId } from "react";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { ELSTER_KIND_LABEL, elsterNotice, type ElsterKind } from "../../../lib/elster.ts";
import { formatDate, formatDateTime, formatLongDate } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getZm, submitZmMeldung } from "../../../server/functions/zm.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/zm/$quartal")({
  loader: ({ params }) => {
    const period = parsePeriodKey(params.quartal);
    if (!period || period.month < 41) throw notFound();
    return getZm({ data: period });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Zusammenfassende Meldung ${loaderData ? periodLabel(loaderData.period) : ""} · Haben` }] }),
  component: ZmPage,
});

type Data = Awaited<ReturnType<typeof getZm>>;
type Zeile = Data["zeilen"][number];

/** Zusammenfassende Meldung eines Quartals (§ 18a UStG): Zeilen aus den Rechnungen, Vorprüfung, Übermittlung und Verlauf */
function ZmPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();
  const key = periodKey(data.period);
  const options = data.quartale.some((q) => periodKey(q) === key) ? data.quartale : [...data.quartale, data.period];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsatzsteuer › Zusammenfassende Meldung</div>
          <h1>{periodLabel(data.period)}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Quartal
          <select id={selectId} value={key} onChange={(event) => navigate({ to: "/umsatzsteuer/zm/$quartal", params: { quartal: event.target.value } })}>
            {options.map((option) => (
              <option key={periodKey(option)} value={periodKey(option)}>
                {periodLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Bundeszentralamt für Steuern.</span>
        </div>
      )}
      {data.issues.map((issue) => (
        <div key={issue.text} className={`banner ${issue.tone === "info" ? "banner-info" : ""}`} role="status">
          <Icon name={issue.tone === "info" ? "info" : "alert"} />
          <span>
            {issue.text}
            {issue.tone === "error" && issue.text.includes("Firmendaten") && (
              <>
                {" "}
                <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
              </>
            )}
          </span>
        </div>
      ))}

      <div className="grid-main">
        <section className="card" aria-labelledby="zm-zeilen-heading">
          <h2 id="zm-zeilen-heading">Meldezeilen</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Sonstige Leistungen an Unternehmer im EU-Ausland (Reverse Charge, § 3a Abs. 2 UStG) und innergemeinschaftliche Lieferungen, je USt-IdNr. des Kunden
            und Umsatzart in vollen Euro. Fällig am {formatLongDate(data.frist)}.
            {data.kz21 !== null && ` Kz 21 der gesendeten Voranmeldungen: ${formatEuro(data.kz21)}.`}
            {data.kz41 !== null && data.kz41 !== 0 && ` Kz 41: ${formatEuro(data.kz41)}.`}
          </p>
          {data.zeilen.length === 0 ? (
            <p style={{ margin: 0 }}>Keine Umsätze im Quartal; ohne Umsätze ist keine Meldung abzugeben.</p>
          ) : (
            <ZeilenTable zeilen={data.zeilen} caption={`Meldezeilen ${periodLabel(data.period)}`} />
          )}
          {data.quellen.length > 0 && (
            <details>
              <summary>Rechnungen dazu ({data.quellen.length})</summary>
              <table>
                <caption className="visually-hidden">Rechnungen der Meldung</caption>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Rechnung</th>
                    <th>USt-IdNr.</th>
                    <th className="num">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quellen.map((q, i) => (
                    <tr key={`${q.invoiceId}-${i}`}>
                      <td className="date">{formatDate(q.date)}</td>
                      <td>
                        <Link to="/rechnungen/$id" params={{ id: q.invoiceId }}>
                          {q.type === "ausbuchung" ? "Ausbuchung zu " : ""}
                          {q.number} · {q.customer}
                        </Link>
                      </td>
                      <td>{q.ustId || "fehlt"}</td>
                      <td className="num">{formatEuro(q.base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
        <ZmSenden data={data} />
      </div>
    </>
  );
}

function ZeilenTable({ zeilen, caption }: { zeilen: readonly Zeile[]; caption: string }) {
  return (
    <table>
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th>USt-IdNr.</th>
          <th>Art</th>
          <th className="num">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((z) => (
          <tr key={`${z.art}-${z.ustId}`}>
            <td>{z.ustId}</td>
            <td>{ZM_ART_LABEL[z.art]}</td>
            <td className="num">{zmEuro(z.betrag).toLocaleString("de-DE")} €</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZmSenden({ data }: { data: Data }) {
  const router = useRouter();
  const submit = useServerFn(submitZmMeldung);
  const action = useAction();
  const { naechste } = data;
  const fehler = data.issues.some((i) => i.tone === "error");
  const nichtsZuSenden = naechste.zeilen.length === 0;

  const onSubmit = (kind: ElsterKind, pin?: string) =>
    action.run(async () => {
      const result = await submit({ data: { period: data.period, kind, pin } });
      await router.invalidate();
      action.setNotice(elsterNotice(kind, result, naechste.berichtigt ? "Berichtigung an das BZSt übermittelt." : "Meldung an das BZSt übermittelt."));
    });

  return (
    <div className="stack">
      {data.sent && (
        <section className="card" aria-labelledby="zm-status-heading">
          <h2 id="zm-status-heading">Übermittelt</h2>
          <p className="small" style={{ margin: 0 }}>
            {nichtsZuSenden
              ? "Die Meldung ist beim BZSt und stimmt mit den Rechnungen überein. Ändert sich etwas, sendest du hier eine Berichtigung."
              : "Seit der Übermittlung haben sich Zeilen geändert. Berichtige die Meldung innerhalb eines Monats (§ 18a Abs. 10 UStG); gesendet werden nur diese Zeilen, eine entfallene mit 0 €."}
          </p>
          {!nichtsZuSenden && <ZeilenTable zeilen={naechste.zeilen} caption="Zeilen der Berichtigung" />}
        </section>
      )}
      {!(data.sent && nichtsZuSenden) && data.zeilen.length + naechste.zeilen.length > 0 && (
        <ElsterSubmit
          setup={data}
          title={naechste.berichtigt ? "Berichtigung an das BZSt" : "Meldung an das BZSt"}
          ready={!fehler && !nichtsZuSenden}
          busy={action.busy}
          notice={action.notice}
          confirmTitle={`${naechste.berichtigt ? "Berichtigung" : "Meldung"} an das BZSt verbindlich senden?`}
          confirmText={`Die ${naechste.berichtigt ? "Berichtigung" : "Meldung"} geht an das Bundeszentralamt für Steuern und lässt sich danach nur noch berichtigen.`}
          footer="Zusammenfassende Meldung (Datenart ZMDO) über ERiC. Das Übertragungsprotokoll wird als PDF abgelegt."
          onSubmit={onSubmit}
        />
      )}
      {data.submissions.length > 0 && (
        <section className="card" aria-labelledby="zm-verlauf-heading">
          <h2 id="zm-verlauf-heading">Verlauf</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
            {data.submissions.map((entry) => (
              <li key={entry.id}>
                {ELSTER_KIND_LABEL[entry.kind]}
                {entry.berichtigt ? " (Berichtigung)" : ""} {entry.ok ? "OK" : `Fehler ${entry.code}`} · {formatDateTime(entry.createdAt)} ·{" "}
                {entry.zeilen.length} {entry.zeilen.length === 1 ? "Zeile" : "Zeilen"}
                {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                {entry.hasPdf && (
                  <>
                    {" · "}
                    <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer">
                      Protokoll
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
