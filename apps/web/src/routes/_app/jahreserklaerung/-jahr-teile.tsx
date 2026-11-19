import { formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Icon } from "../../../components/Icon.tsx";
import { ELSTER_KIND_LABEL } from "../../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { ScrollTable } from "../../../components/ScrollTable.tsx";
import { OutcomeStatus } from "../../../components/Status.tsx";
import { ErklaerteZeilen } from "../../../components/jahreserklaerung/ErklaerteZeilen.tsx";
import { EuerTabelle } from "../../../components/jahreserklaerung/EuerTabelle.tsx";
import { SentPill } from "../../../components/jahreserklaerung/Reihenfolge.tsx";
import type { Data } from "../../../components/jahreserklaerung/typen.ts";
import { UstTabelle } from "../../../components/jahreserklaerung/UstTabelle.tsx";
import { FORM_LABEL, SubmitPanel } from "./-jahr-senden.tsx";

export type Issue = Data["ust"]["issues"][number];

export const LINK_LABEL = {
  "/einstellungen": "Zu den Einstellungen",
  "/anlagen": "Zu den Anlagen",
  "/umsatzsteuer": "Zur Umsatzsteuer",
  "/bank": "Zur Bank",
  "/pauschalen": "Zu den Pauschalen",
} as const;

export function Issues({ issues }: { issues: Issue[] }) {
  return (
    <>
      {issues.map((issue) => (
        <div key={issue.text} className={`banner ${issue.tone === "hinweis" ? "banner-info" : ""}`} role="status">
          <Icon name={issue.tone === "hinweis" ? "info" : "alert"} />
          <span>
            {issue.text} {/* Ein Zeitraum führt auf den betroffenen Zeitraum statt auf den laufenden (#869) */}
            {issue.link &&
              (issue.zeitraum ? (
                <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: issue.zeitraum }}>
                  {LINK_LABEL[issue.link]}
                </Link>
              ) : issue.link === "/einstellungen" ? (
                <Link to="/einstellungen" search={issue.bereich ? { bereich: issue.bereich } : {}}>
                  {LINK_LABEL[issue.link]}
                </Link>
              ) : (
                <Link to={issue.link}>{LINK_LABEL[issue.link]}</Link>
              ))}
          </span>
        </div>
      ))}
    </>
  );
}

export function UstSection({ data }: { data: Data }) {
  const { ust } = data;
  return (
    <section className="grid-main jump-target" id="ust" aria-labelledby="ust-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="ust-heading" style={{ margin: 0 }}>
            Umsatzsteuererklärung
          </h2>
          <SentPill teil={ust} />
        </div>
        <Issues issues={ust.issues} />
        <ErklaerteZeilen form="ust" year={data.year} zeilen={ust.erklaert} vermerkt={ust.submitted !== null} />
        <UstTabelle data={data} />
      </div>
      <SubmitPanel form="ust" data={data} blocked={ust.issues.some((i) => i.tone === "fehler")} sent={Boolean(ust.sent)} submitted={ust.submitted} />
    </section>
  );
}

export function EuerSection({ data }: { data: Data }) {
  const { euer } = data;
  return (
    <section className="grid-main jump-target" id="euer" aria-labelledby="euer-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="euer-heading" style={{ margin: 0 }}>
            Anlage EÜR
          </h2>
          <SentPill teil={euer} />
        </div>
        <Issues issues={euer.issues} />
        <ErklaerteZeilen form="euer" year={data.year} zeilen={euer.erklaert} vermerkt={euer.submitted !== null} />
        <EuerTabelle data={data} />
        {euer.anlagen.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="section-label">Anlagenverzeichnis (Anlage AVEÜR)</div>
            <div style={{ overflowX: "auto" }}>
              <ScrollTable className="report-table">
                <thead>
                  <tr>
                    <th>Anlage</th>
                    <th className="num">Gruppe</th>
                    <th className="num">Buchwert Beginn</th>
                    <th className="num">AfA</th>
                    <th className="num">Abgang</th>
                    <th className="num">Buchwert Ende</th>
                  </tr>
                </thead>
                <tbody>
                  {euer.anlagen.map((a) => (
                    <tr key={`${a.bezeichnung}-${a.anschaffung}`}>
                      <td>
                        {a.bezeichnung}
                        <div className="small muted">
                          {formatDate(a.anschaffung)} · {formatEuro(a.anschaffungskosten)}
                        </div>
                      </td>
                      <td className="num small muted">
                        {a.gruppe === "kfz" ? "Kfz" : a.gruppe === "buero" ? "Büro" : a.gruppe === "sammelposten" ? "Sammelposten" : "Andere"}
                      </td>
                      <td className="num">{formatEuro(a.buchwertBeginn)}</td>
                      <td className="num">{formatEuro(a.afa)}</td>
                      <td className="num">{a.abgang ? formatEuro(a.abgang) : "–"}</td>
                      <td className="num">{formatEuro(a.buchwertEnde)}</td>
                    </tr>
                  ))}
                </tbody>
              </ScrollTable>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Anlagen, die im Jahr angeschafft wurden, stehen mit den Anschaffungskosten im Buchwert zu Beginn. Geringwertige Wirtschaftsgüter gehören nicht ins
              Verzeichnis.
            </p>
          </div>
        )}
      </div>
      <SubmitPanel form="euer" data={data} blocked={euer.issues.some((i) => i.tone === "fehler")} sent={Boolean(euer.sent)} submitted={euer.submitted} />
    </section>
  );
}

export function History({ data }: { data: Data }) {
  return (
    <section className="card jump-target" id="verlauf" aria-labelledby="history-heading">
      <h2 id="history-heading">Verlauf {data.year}</h2>
      {data.history.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch nichts geprüft oder gesendet.
        </p>
      ) : (
        data.history.map((entry) => (
          <div key={entry.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {FORM_LABEL[entry.form]} · {ELSTER_KIND_LABEL[entry.kind]}{" "}
                <OutcomeStatus ok={entry.ok}>{entry.ok ? "OK" : `Fehler ${entry.code}`}</OutcomeStatus>
              </span>
              <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                {formatDateTime(entry.createdAt)}
                {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                {!entry.ok ? ` · ${entry.message}` : ""}
              </span>
            </div>
            {entry.hasPdf && (
              <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer" className="small">
                Protokoll
              </a>
            )}
          </div>
        ))
      )}
    </section>
  );
}
