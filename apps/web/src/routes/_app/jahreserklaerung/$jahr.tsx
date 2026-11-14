import { RECHTSFORMEN, formatDecimal, formatDeduction, formatEuro, isKapitalgesellschaft, parseEuro } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import { AnlageNFields, parseArbeitnehmer, toArbeitnehmerDraft } from "../../../components/AnlageN.tsx";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { AbgabeVermerken } from "../../../components/jahreserklaerung/AbgabeVermerken.tsx";
import { GewstSection, KapgAngaben, KapgGemeinsameHinweise, KstSection } from "../../../components/KapgErklaerungen.tsx";
import { MeinElsterWerte } from "../../../components/MeinElsterWerte.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { VastBelege } from "../../../components/VastBelege.tsx";
import { ELSTER_KIND_LABEL, abgabePille, elsterNotice } from "../../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getAnnualReturns, getMeinElsterWerte, saveIncomeTaxInputs, submitAnnualReturn } from "../../../server/functions/annual.ts";
import styles from "../../../styles/auswertungen.css?url";
import { ScrollTable } from "../../../components/ScrollTable.tsx";
import { Field } from "../../../components/Field.tsx";
import { Status, OutcomeStatus } from "../../../components/Status.tsx";

export const Route = createFileRoute("/_app/jahreserklaerung/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getAnnualReturns({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahreserklärung ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AnnualPage,
});

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Form = "ust" | "euer" | "est";
type Issue = Data["ust"]["issues"][number];
const FORM_LABEL = {
  ust: "Umsatzsteuererklärung",
  euer: "Anlage EÜR",
  est: "Einkommensteuererklärung",
  kst: "Körperschaftsteuererklärung",
  gewst: "Gewerbesteuererklärung",
} as const;
const LINK_LABEL = {
  "/einstellungen": "Zu den Einstellungen",
  "/anlagen": "Zu den Anlagen",
  "/umsatzsteuer": "Zur Umsatzsteuer",
  "/bank": "Zur Bank",
  "/pauschalen": "Zu den Pauschalen",
} as const;

function AnnualPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  // GmbH und UG: Körperschaftsteuer statt Einkommensteuer, Bilanz statt EÜR; hier bleibt die Umsatzsteuer
  const gesellschaft = isKapitalgesellschaft(data.rechtsform);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahreserklärung</div>
          <h1>Steuerjahr {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/jahreserklaerung/$jahr", params: { jahr: e.target.value } })}>
              {(data.years.includes(data.year) ? data.years : [data.year, ...data.years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.</span>
        </div>
      )}

      {gesellschaft ? (
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Umsatzsteuer-, Körperschaftsteuer- und Gewerbesteuererklärung rechnet Haben aus den Buchungen und dem <Link to="/abschluss">Jahresabschluss</Link>.
          Anlage EÜR und Einkommensteuer gibt es für {RECHTSFORMEN[data.rechtsform]} nicht.
        </p>
      ) : (
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Umsatzsteuererklärung und Anlage EÜR rechnet Haben aus den Buchungen. Für die Einkommensteuer kommt der Gewinn aus der EÜR; Arbeitslohn, Vorsorge,
          Sonderausgaben, Kinder und Kapitalerträge trägst du ein.
        </p>
      )}

      <nav className="jump-nav" aria-label="Abschnitte der Jahreserklärung">
        <a href="#ust">Umsatzsteuer</a>
        {!gesellschaft && <a href="#euer">Anlage EÜR</a>}
        {!gesellschaft && <a href="#est">Einkommensteuer</a>}
        {gesellschaft && <a href="#kst">Körperschaftsteuer</a>}
        {gesellschaft && <a href="#gewst">Gewerbesteuer</a>}
        {gesellschaft && <a href="#kapg-angaben">Angaben</a>}
        {!gesellschaft && <a href="#vast">Belege von ELSTER</a>}
        <a href="#verlauf">Verlauf</a>
      </nav>

      <div className="stack" style={{ gap: 24 }}>
        <StatusUebersicht data={data} />
        <UstSection data={data} />
        {!gesellschaft && <EuerSection data={data} />}
        {!gesellschaft && <EstSection key={data.year} data={data} />}
        {data.kapg && <KapgGemeinsameHinweise data={data} />}
        {data.kapg && <KstSection data={data} />}
        {data.kapg && <GewstSection data={data} />}
        {data.kapg && <KapgAngaben key={`kapg-${data.year}`} data={data} />}
        {/* Die vorausgefüllte Steuererklärung gibt es nur für die Einkommensteuer einer Person */}
        {!gesellschaft && (
          <div id="vast" className="jump-target">
            <VastBelege key={`vast-${data.year}`} data={data} />
          </div>
        )}
        <History data={data} />
      </div>
    </>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
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
              ) : (
                <Link to={issue.link}>{LINK_LABEL[issue.link]}</Link>
              ))}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Zeile einer Betragstabelle; kz = Feldkennung, extra = Zusatzspalte (Bemessungsgrundlage),
 * text = Wert ist Text statt Betrag. Die data-label beschriften die Werte, wenn die Tabelle auf dem Handy gestapelt ist.
 */
function Row({ label, kz, value, extra, total, text }: { label: string; kz?: string; value: string; extra?: string; total?: boolean; text?: boolean }) {
  return (
    <tr style={total ? { fontWeight: 600 } : undefined}>
      <th scope="row" style={total ? { fontWeight: 600 } : undefined}>
        {label}
        {kz && <span className="small muted mono"> {kz}</span>}
      </th>
      {extra !== undefined && (
        <td className="num" data-label="Bemessung">
          {extra}
        </td>
      )}
      <td
        className={text ? undefined : "num"}
        style={text ? { textAlign: "right" } : undefined}
        data-label={extra !== undefined ? "Steuer" : text ? undefined : "Betrag"}
      >
        {value}
      </td>
    </tr>
  );
}

/** Stand der Abgabe; `verwaltet` ist false für die Einkommensteuer, für die Haben keinen Vermerk kennt (#869) */
function SentPill({ sent, submitted, verwaltet }: { sent: Data["ust"]["sent"]; submitted: Data["ust"]["submitted"]; verwaltet?: boolean }) {
  const pille = abgabePille({ sent: sent?.createdAt ?? null, submitted, verwaltet });
  return (
    <Status tone={pille.ok ? "ok" : undefined} inline>
      {pille.text}
    </Status>
  );
}

/**
 * Feldkennungen und Reihenfolge der Umsatzsteuererklärung. Die Werte kommen aus dem
 * Übermittlungsprotokoll, wenn die Erklärung außerhalb von Haben entstanden ist.
 */
const UST_ZEILEN: readonly [string, string][] = [
  ["kz22", "Lieferungen und sonstige Leistungen zu 19 %"],
  ["kz37", "Steuer daraus"],
  ["kz51", "Innergemeinschaftliche Erwerbe zu 19 %"],
  ["kz56", "Steuer daraus"],
  ["kz65", "Sonstige Leistungen nach § 3a Abs. 2 UStG (§ 13b)"],
  ["kz67", "Andere Leistungen (§ 13b Abs. 2)"],
  ["kz68", "Summe der Steuer nach § 13b"],
  ["kz79", "Vorsteuer aus Rechnungen anderer Unternehmer"],
  ["kz80", "Vorsteuer aus innergemeinschaftlichen Erwerben"],
  ["kz83", "Vorsteuer aus Leistungen nach § 13b"],
  ["kz87", "Summe der Vorsteuerbeträge"],
  ["kz103", "Umsatzsteuer auf Lieferungen und Leistungen"],
  ["kz104", "Umsatzsteuer auf innergemeinschaftliche Erwerbe"],
  ["kz107", "Umsatzsteuer, die der Leistungsempfänger schuldet"],
  ["kz108", "Zwischensumme"],
  ["kz109", "Abziehbare Vorsteuerbeträge"],
  ["kz111", "Verbleibender Betrag"],
  ["kz116", "Umsatzsteuer-Überschuss"],
  ["kz118", "Verbleibende Umsatzsteuer / Verbleibender Überschuss"],
  ["kz119", "Vorauszahlungssoll"],
  ["kz120", "Abschlusszahlung / Erstattungsanspruch"],
];

/** Zeilen der Anlage EÜR, wie sie im Sendebericht stehen */
const EUER_ZEILEN: readonly [string, string][] = [
  ["kz15", "Umsatzsteuerpflichtige Betriebseinnahmen"],
  ["kz17", "Vereinnahmte Umsatzsteuer"],
  ["einnahmen", "Summe Betriebseinnahmen"],
  ["kz29", "Bezogene Fremdleistungen"],
  ["kz33", "AfA auf bewegliche Wirtschaftsgüter"],
  ["kz36", "Geringwertige Wirtschaftsgüter (§ 6 Abs. 2 EStG)"],
  ["kz43", "Telekommunikation"],
  ["kz50", "Laufende EDV-Kosten"],
  ["kz51", "Arbeitsmittel"],
  ["kz57", "Abziehbare Vorsteuerbeträge"],
  ["kz65", "Häusliches Arbeitszimmer"],
  ["kz70", "Sonstige tatsächliche Fahrtkosten"],
  ["ausgaben", "Summe Betriebsausgaben"],
  ["gewinn", "Steuerpflichtiger Gewinn / Verlust"],
  ["entnahmen", "Entnahmen"],
  ["einlagen", "Einlagen"],
];

/** Zeilen der Einkommensteuererklärung aus der Berechnung */
const EST_ZEILEN: readonly [string, string][] = [
  ["est_gewinn", "Laufender Gewinn aus freiberuflicher Tätigkeit"],
  ["est_zve", "Einkommen / zu versteuerndes Einkommen"],
  ["est_tariflich", "Tarifliche Einkommensteuer"],
  ["est_festgesetzt", "Festzusetzende Einkommensteuer"],
  ["est_soli", "Festzusetzender Solidaritätszuschlag"],
  ["est_erstattung", "Erstattungsbetrag"],
];

/** Gibt es zu diesem Vermerk erklärte Zeilenwerte? */
const hatErklaert = (zeilen: Record<string, number>) => Object.keys(zeilen ?? {}).length > 0;

/**
 * Tabelle der erklärten Zeilen. Sie ersetzt Habens Rechnung, sobald ein Vermerk mit Zeilenwerten
 * vorliegt: Was beim Finanzamt liegt, ist die Wahrheit, nicht was Haben aus unvollständigen
 * Buchungen rechnet.
 */
function ErklaerteZeilen({ zeilen, reihenfolge, kern }: { zeilen: Record<string, number>; reihenfolge: readonly [string, string][]; kern: readonly string[] }) {
  const vorhanden = reihenfolge.filter(([feld]) => feld in zeilen);
  const sichtbar = vorhanden.filter(([feld]) => kern.includes(feld));
  const rest = vorhanden.filter(([feld]) => !kern.includes(feld));

  const tabelle = (rows: readonly [string, string][], letzteHervorheben: boolean) => (
    <table className="report-table stack-table">
      <thead>
        <tr>
          <th scope="col">Zeile</th>
          <th scope="col" className="num">
            Betrag
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([feld, label], i) => (
          <Row key={feld} label={label} kz={feld} value={formatEuro(zeilen[feld] ?? 0)} total={letzteHervorheben && i === rows.length - 1} />
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      {/* Der Kern steht immer: das Ergebnis, an dem die Erklärung geprüft wird */}
      {tabelle(sichtbar, rest.length === 0)}
      {rest.length > 0 && (
        <details>
          <summary className="small muted">Alle {vorhanden.length} Zeilen laut Übermittlungsprotokoll</summary>
          <div style={{ marginTop: 8 }}>{tabelle(rest, true)}</div>
        </details>
      )}
    </>
  );
}

/**
 * Stand der drei Erklärungen auf einen Blick. Verlinkt in den jeweiligen Abschnitt, damit die
 * Seite nicht durchsucht werden muss (#869).
 */
function StatusUebersicht({ data }: { data: Data }) {
  const zeilen = [
    { id: "ust", label: "Umsatzsteuer", teil: data.ust },
    { id: "euer", label: "Anlage EÜR", teil: data.euer },
    { id: "est", label: "Einkommensteuer", teil: data.est },
  ];
  return (
    <section className="card" aria-label="Stand der Erklärungen">
      <table className="report-table stack-table">
        <thead>
          <tr>
            <th scope="col">Erklärung</th>
            <th scope="col">Stand</th>
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.id}>
              <th scope="row">
                <a href={`#${z.id}`}>{z.label}</a>
              </th>
              <td>
                <SentPill sent={z.teil.sent} submitted={z.teil.submitted} verwaltet={"verwaltet" in z.teil ? z.teil.verwaltet : false} />
              </td>
              <td className="num">{z.teil.submitted?.amount === null || z.teil.submitted?.amount === undefined ? "–" : formatEuro(z.teil.submitted.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function UstSection({ data }: { data: Data }) {
  const { ust } = data;
  const f = ust.figures;
  return (
    <section className="grid-main jump-target" id="ust" aria-labelledby="ust-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="ust-heading" style={{ margin: 0 }}>
            Umsatzsteuererklärung
          </h2>
          <SentPill sent={ust.sent} submitted={ust.submitted} />
        </div>
        <Issues issues={ust.issues} />
        {hatErklaert(ust.erklaert) && <ErklaerteZeilen zeilen={ust.erklaert} reihenfolge={UST_ZEILEN} kern={["kz22", "kz87", "kz119", "kz120"]} />}
        {!hatErklaert(ust.erklaert) && (
          <table className="report-table stack-table">
            <thead>
              <tr>
                <th scope="col">Zeile</th>
                <th scope="col" className="num">
                  Bemessungsgrundlage
                </th>
                <th scope="col" className="num">
                  Steuer
                </th>
              </tr>
            </thead>
            <tbody>
              <Row label="Umsätze zu 19 %" extra={formatEuro(f.base19)} value={formatEuro(f.tax19)} />
              <Row label="Umsätze zu 7 %" extra={formatEuro(f.base7)} value={formatEuro(f.tax7)} />
              {(f.kz41 ?? 0) !== 0 && <Row label="Steuerfreie innergemeinschaftliche Lieferungen" kz="41" extra={formatEuro(f.kz41!)} value="–" />}
              {(f.kz43 ?? 0) !== 0 && <Row label="Steuerfreie Ausfuhrlieferungen" kz="43" extra={formatEuro(f.kz43!)} value="–" />}
              {((f.kz89 ?? 0) !== 0 || (f.tax89 ?? 0) !== 0) && (
                <Row label="Innergemeinschaftliche Erwerbe zu 19 %" kz="89" extra={formatEuro(f.kz89 ?? 0)} value={formatEuro(f.tax89 ?? 0)} />
              )}
              {((f.kz93 ?? 0) !== 0 || (f.tax93 ?? 0) !== 0) && (
                <Row label="Innergemeinschaftliche Erwerbe zu 7 %" kz="93" extra={formatEuro(f.kz93 ?? 0)} value={formatEuro(f.tax93 ?? 0)} />
              )}
              {((f.kz46 ?? 0) !== 0 || (f.kz47 ?? 0) !== 0) && (
                <Row label="§-13b-Leistungen aus dem EU-Ausland" kz="46/47" extra={formatEuro(f.kz46 ?? 0)} value={formatEuro(f.kz47 ?? 0)} />
              )}
              {((f.kz84 ?? 0) !== 0 || (f.kz85 ?? 0) !== 0) && (
                <Row label="§-13b-Leistungen aus dem Drittland" kz="84/85" extra={formatEuro(f.kz84 ?? 0)} value={formatEuro(f.kz85 ?? 0)} />
              )}
              {(f.kz21 ?? 0) !== 0 && <Row label="Nicht steuerbare Leistungen, Ort im EU-Ausland" kz="21" extra={formatEuro(f.kz21!)} value="–" />}
              {(f.kz45 ?? 0) !== 0 && <Row label="Nicht steuerbare Umsätze (Drittland)" kz="45" extra={formatEuro(f.kz45!)} value="–" />}
              {ust.kz48 !== 0 && <Row label="Steuerfreie Umsätze ohne Vorsteuerabzug" kz="48" extra={formatEuro(ust.kz48)} value="–" />}
              <Row label="Abziehbare Vorsteuer aus Rechnungen" kz="66" extra="" value={formatDeduction(f.vorsteuer)} />
              {(f.kz61 ?? 0) !== 0 && <Row label="Vorsteuer aus innergemeinschaftlichem Erwerb" kz="61" extra="" value={formatDeduction(f.kz61!)} />}
              {(f.kz62 ?? 0) !== 0 && <Row label="Entstandene Einfuhrumsatzsteuer" kz="62" extra="" value={formatDeduction(f.kz62!)} />}
              {(f.kz67 ?? 0) !== 0 && <Row label="Vorsteuer aus §-13b-Leistungen" kz="67" extra="" value={formatDeduction(f.kz67!)} />}
              <Row label={ust.steuer >= 0 ? "Umsatzsteuer" : "Überschuss"} extra="" value={formatEuro(ust.steuer)} total />
              <Row label="Vorauszahlungssoll (gesendete Voranmeldungen)" extra="" value={formatDeduction(f.vorauszahlungen)} />
              <Row label={ust.abschluss >= 0 ? "Abschlusszahlung" : "Erstattung"} extra="" value={formatEuro(ust.abschluss)} total />
            </tbody>
          </table>
        )}
        {!hatErklaert(ust.erklaert) && erklaert !== null && erklaert !== ust.abschluss && (
          <p className="small muted" style={{ margin: 0 }}>
            Erklärt wurden laut Übermittlungsprotokoll {formatEuro(erklaert)}. Die Zeilen darüber sind Habens Rechnung aus den Buchungen (
            {formatEuro(ust.abschluss)}) und weichen davon ab, weil die Erklärung außerhalb von Haben entstanden ist.
          </p>
        )}
        {/* Der Rechenhinweis beschreibt Habens eigene Rechnung; bei erklärten Zeilen aus dem
            Protokoll stimmt er nicht mehr (#869) */}
        {!hatErklaert(ust.erklaert) && (
          <p className="small muted" style={{ margin: 0 }}>
            Bemessungsgrundlagen in vollen Euro, die Steuer daraus wie in der Voranmeldung.{" "}
            {data.versteuerung === "ist" ? "Ist-Versteuerung" : "Soll-Versteuerung"}.
            {/* Privatnutzung als unentgeltliche Wertabgabe bucht Haben nur im Einzelunternehmen (docs/anlagen.md) */}
            {!isKapitalgesellschaft(data.rechtsform) && " Die private Kfz-Nutzung ist in den Umsätzen zu 19 % enthalten."}
          </p>
        )}
      </div>
      <SubmitPanel form="ust" data={data} blocked={ust.issues.some((i) => i.tone === "fehler")} sent={Boolean(ust.sent)} submitted={ust.submitted} />
    </section>
  );
}

function EuerSection({ data }: { data: Data }) {
  const { euer, euerRows } = data;
  return (
    <section className="grid-main jump-target" id="euer" aria-labelledby="euer-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="euer-heading" style={{ margin: 0 }}>
            Anlage EÜR
          </h2>
          <SentPill sent={euer.sent} submitted={euer.submitted} />
        </div>
        <Issues issues={euer.issues} />
        {hatErklaert(euer.erklaert) && <ErklaerteZeilen zeilen={euer.erklaert} reihenfolge={EUER_ZEILEN} kern={["einnahmen", "ausgaben", "gewinn"]} />}
        {!hatErklaert(euer.erklaert) && (
          <ScrollTable className="report-table">
            <thead>
              <tr>
                <th scope="col">Zeile und Feldkennung</th>
                <th scope="col" className="num">
                  Betrag
                </th>
              </tr>
            </thead>
            <tbody>
              {euerRows.einnahmen.map((r) => (
                <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
              ))}
              <Row label="Summe Betriebseinnahmen" value={formatEuro(euer.einnahmen)} total />
              {euerRows.ausgaben.map((r) => (
                <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
              ))}
              <Row label="Summe Betriebsausgaben" value={formatEuro(euer.ausgaben)} total />
              <Row label={euer.gewinn >= 0 ? "Gewinn" : "Verlust"} value={formatEuro(euer.gewinn)} total />
              {euerRows.privat.map((r) => (
                <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
              ))}
            </tbody>
          </ScrollTable>
        )}
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

type Angaben = Data["est"]["angaben"];
type Kind = Angaben["kinder"][number];
type KindDraft = Omit<Kind, "kinderbetreuung"> & { key: number; kinderbetreuung: string };

const centsText = (cents: number | undefined) => (cents ? formatDecimal(cents) : "");

/** Ein Betragsfeld; leer heißt 0 */
function Amount({ name, label, value, hint }: { name: string; label: string; value: number | undefined; hint?: string }) {
  return (
    <Field label={label} hint={hint && hint}>
      {(control) => <input {...control} name={name} inputMode="decimal" defaultValue={centsText(value)} placeholder="0,00" />}
    </Field>
  );
}

/** Zuklappbarer Teil der Einkommensteuer-Angaben; im Titel steht, was gespeichert ist */
function Block({ title, summary, open, children }: { title: string; summary: string; open: boolean; children: ReactNode }) {
  return (
    <details className="est-block" open={open}>
      <summary>
        <span className="est-block-title">{title}</span>
        <span className="small muted">{summary}</span>
      </summary>
      <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
        {children}
      </div>
    </details>
  );
}

const sumOf = (...values: (number | undefined)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0);
const sumText = (cents: number) => (cents === 0 ? "nichts eingetragen" : formatEuro(cents));

function EstSection({ data }: { data: Data }) {
  const { est } = data;
  const a = est.angaben;
  const router = useRouter();
  const save = useServerFn(saveIncomeTaxInputs);
  // Eine abgegebene Erklaerung laesst sich nicht mehr aendern; die Angaben dienen dann nur noch
  // der Prognose kuenftiger Jahre. Freigeben muss man sie ausdruecklich (#940, #943).
  const [bearbeiten, setBearbeiten] = useState(false);
  const gesperrt = est.submitted !== null && !bearbeiten;
  const [kinder, setKinder] = useState<KindDraft[]>(() => a.kinder.map((k, key) => ({ ...k, key, kinderbetreuung: centsText(k.kinderbetreuung) })));
  const [anA, setAnA] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.a));
  const [anB, setAnB] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.b));
  const nameA = est.person.a?.split(" ")[0] ?? "Person A";
  const nameB = est.person.b?.split(" ")[0] ?? "Ehegatte";
  const { busy, notice, setNotice, run } = useAction();
  const blocked = est.issues.some((i) => i.tone === "fehler");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bad: string[] = [];
    const amount = (name: string, label: string) => {
      const text = String(form.get(name) ?? "").trim();
      if (!text) return undefined;
      const cents = parseEuro(text);
      if (cents === null || cents < 0) {
        bad.push(label);
        return undefined;
      }
      return cents || undefined;
    };
    const kidAmount = (k: KindDraft) => {
      if (!k.kinderbetreuung.trim()) return undefined;
      const cents = parseEuro(k.kinderbetreuung);
      if (cents === null || cents < 0) bad.push(`Kinderbetreuung ${k.vorname}`);
      return cents || undefined;
    };
    const vorsorge = (p: "a" | "b") => ({
      rentenversicherung: amount(`${p}-rv`, "Rentenversicherung"),
      gkv: amount(`${p}-gkv`, "Krankenversicherung"),
      gpv: amount(`${p}-gpv`, "Pflegeversicherung"),
      gkvZusatz: amount(`${p}-gkvZusatz`, "Wahlleistungen"),
      pkv: amount(`${p}-pkv`, "Private Krankenversicherung"),
      ppv: amount(`${p}-ppv`, "Private Pflegeversicherung"),
      pkvErstattung: amount(`${p}-pkvErstattung`, "Erstattungen"),
    });
    const angaben = {
      vorsorge: { a: vorsorge("a"), ...(est.zusammen ? { b: vorsorge("b") } : {}), sonstige: amount("sonstige", "Weitere Vorsorge") },
      sonderausgaben: {
        kirchensteuerGezahlt: amount("kistGezahlt", "Kirchensteuer"),
        kirchensteuerErstattet: amount("kistErstattet", "Kirchensteuer erstattet"),
        spenden: amount("spenden", "Spenden"),
      },
      krankheitskosten: amount("krankheitskosten", "Krankheitskosten"),
      haushaltsnah: {
        minijobs: amount("minijobs", "Minijobs"),
        dienstleistungen: amount("dienstleistungen", "Haushaltsnahe Dienstleistungen"),
        handwerker: amount("handwerker", "Handwerkerleistungen"),
      },
      kinder: kinder.map((k) => ({
        idnr: k.idnr?.trim() || undefined,
        vorname: k.vorname,
        name: k.name?.trim() || undefined,
        geburtsdatum: k.geburtsdatum,
        familienkasse: k.familienkasse?.trim() ?? "",
        kinderbetreuung: kidAmount(k),
      })),
      kap: {
        guenstigerpruefung: form.get("guenstigerpruefung") === "on",
        ertraegeMitSteuerabzug: amount("kapMit", "Kapitalerträge"),
        sparerPauschbetrag: amount("kapSpb", "Sparer-Pauschbetrag"),
        ertraegeOhneSteuerabzugInland: amount("kapOhneInl", "Kapitalerträge ohne Steuerabzug"),
        ertraegeAusland: amount("kapAusl", "Ausländische Kapitalerträge"),
        kapitalertragsteuer: amount("kapESt", "Kapitalertragsteuer"),
        soli: amount("kapSoli", "Solidaritätszuschlag"),
        kirchensteuer: amount("kapKiSt", "Kirchensteuer auf Kapitalerträge"),
      },
      arbeitnehmer: {
        a: parseArbeitnehmer(anA, nameA, bad),
        ...(est.zusammen ? { b: parseArbeitnehmer(anB, nameB, bad) } : {}),
      },
    };
    if (bad.length > 0) {
      setNotice({ tone: "danger", text: `Kein gültiger Betrag: ${bad.join(", ")}.` });
      return;
    }
    await run(async () => {
      await save({ data: { year: data.year, angaben } });
      await router.invalidate();
    }, "Angaben gespeichert.");
  }

  const updateKind = (key: number, patch: Partial<KindDraft>) => setKinder((list) => list.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  const vorsorgeFields = (p: "a" | "b", v: Angaben["vorsorge"]["a"] | undefined) => (
    <div className="form-grid">
      <Amount name={`${p}-rv`} label="Gesetzliche Rentenversicherung" value={v?.rentenversicherung} />
      <Amount name={`${p}-gkv`} label="Gesetzliche Krankenversicherung" value={v?.gkv} hint="ohne Anteil für Krankengeld" />
      <Amount name={`${p}-gpv`} label="Soziale Pflegeversicherung" value={v?.gpv} />
      <Amount name={`${p}-gkvZusatz`} label="Gesetzlich: Krankengeldanteil, Wahlleistungen" value={v?.gkvZusatz} />
      <Amount name={`${p}-pkv`} label="Private Krankenversicherung (Basis)" value={v?.pkv} hint="laut Bescheinigung der Versicherung" />
      <Amount name={`${p}-ppv`} label="Private Pflege-Pflichtversicherung" value={v?.ppv} />
      <Amount name={`${p}-pkvErstattung`} label="Erstattungen der privaten KV/PV" value={v?.pkvErstattung} />
    </div>
  );

  return (
    <section className="grid-main jump-target" id="est" aria-labelledby="est-heading">
      <form className="card" onSubmit={onSubmit} aria-label="Angaben zur Einkommensteuer">
        {est.submitted !== null && (
          <div className="banner banner-info" role="status">
            <p style={{ margin: 0 }}>
              {est.submitted.filedOn
                ? `Die Einkommensteuererklärung ${data.year} ist am ${formatDate(est.submitted.filedOn)} abgegeben.`
                : `Die Einkommensteuererklärung ${data.year} ist abgegeben.`}
              {gesperrt
                ? " Die Angaben sind deshalb gesperrt; sie dienen nur noch der Prognose künftiger Jahre."
                : " Du bearbeitest die Angaben gerade. Änderungen wirken nur auf die Prognose, die übermittelte Erklärung bleibt unverändert."}
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => setBearbeiten(!bearbeiten)}>
              {gesperrt ? "Angaben korrigieren" : "Bearbeitung beenden"}
            </button>
          </div>
        )}
        <fieldset disabled={gesperrt} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <h2 id="est-heading">Einkommensteuererklärung {data.year}</h2>
            <SentPill sent={est.sent} submitted={est.submitted} verwaltet={est.verwaltet} />
          </div>
          <Issues issues={est.issues} />
          {hatErklaert(est.erklaert) && (
            <div style={{ marginBottom: 12 }}>
              <ErklaerteZeilen zeilen={est.erklaert} reihenfolge={EST_ZEILEN} kern={["est_zve", "est_festgesetzt", "est_erstattung"]} />
            </div>
          )}
          <ScrollTable className="report-table">
            <tbody>
              <Row label="Steuerpflichtige Person" value={est.person.a ?? "–"} text />
              <Row label="Veranlagung" value={est.zusammen ? `Zusammen mit ${est.person.b ?? "–"}` : "Einzeln"} text />
              {/* Ohne Buchungen im Jahr steht hier 0,00 — das ist keine Aussage über den Gewinn,
                  sondern über Habens Datenlage (#869) */}
              {est.gewinn !== 0 && <Row label="Gewinn laut EÜR" value={formatEuro(est.gewinn)} />}
              <Row label="Anlagen" value={est.anlagen.join(", ")} text />
            </tbody>
          </ScrollTable>
          {(() => {
            const prognose = (
              <ScrollTable className="report-table">
                <tbody>
                  {est.prognose.einkuenfteArbeit !== 0 && (
                    <Row label="Einkünfte aus Arbeitslohn (geschätzt)" value={formatEuro(est.prognose.einkuenfteArbeit)} />
                  )}
                  <Row label="Zu versteuerndes Einkommen (geschätzt)" value={formatEuro(est.prognose.zvE)} />
                  <Row
                    label="Voraussichtliche Steuer"
                    value={formatEuro(est.prognose.gesamt)}
                    kz={[
                      `ESt ${formatEuro(est.prognose.einkommensteuer)}`,
                      est.prognose.soli ? `Soli ${formatEuro(est.prognose.soli)}` : "",
                      est.prognose.kirchensteuer ? `KiSt ${formatEuro(est.prognose.kirchensteuer)}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  {est.prognose.steuerabzug > 0 && (
                    <>
                      <Row label="Bereits einbehalten (Lohnsteuer, Soli, KiSt)" value={formatEuro(est.prognose.steuerabzug)} />
                      <Row
                        label={est.prognose.verbleibend >= 0 ? "Voraussichtlich nachzuzahlen" : "Voraussichtliche Erstattung"}
                        value={formatEuro(Math.abs(est.prognose.verbleibend))}
                        total
                      />
                    </>
                  )}
                </tbody>
              </ScrollTable>
            );
            // Bei abgegebener Erklärung ist die Schaetzung eine Nebenrechnung; die echten Zahlen
            // stehen oben in der Karte "ausserhalb von Haben abgegeben" (#869)
            return est.submitted === null ? (
              prognose
            ) : (
              <details className="est-block">
                <summary>
                  <span className="est-block-title">Schätzung aus Habens Buchungen</span>
                  <span className="small muted">nicht die abgegebene Erklärung</span>
                </summary>
                <div style={{ paddingTop: 12 }}>{prognose}</div>
              </details>
            );
          })()}

          <AnlageNFields wer={nameA} draft={anA} onChange={setAnA} />
          {est.zusammen && <AnlageNFields wer={nameB} draft={anB} onChange={setAnB} />}

          {(() => {
            const v = (p: "a" | "b") => {
              const x = a.vorsorge[p];
              return sumOf(x?.rentenversicherung, x?.gkv, x?.gpv, x?.gkvZusatz, x?.pkv, x?.ppv);
            };
            const total = v("a") + (est.zusammen ? v("b") : 0) + (a.vorsorge.sonstige ?? 0);
            return (
              <Block title="Vorsorgeaufwand" summary={sumText(total)} open={false}>
                <h4 className="est-sub">{est.zusammen ? (est.person.a ?? "Person A") : "Beiträge"}</h4>
                {vorsorgeFields("a", a.vorsorge.a)}
                {est.zusammen && (
                  <>
                    <h4 className="est-sub">{est.person.b ?? "Ehegatte"}</h4>
                    {vorsorgeFields("b", a.vorsorge.b)}
                  </>
                )}
                <div className="form-grid">
                  <Amount name="sonstige" label="Weitere Vorsorge (Haftpflicht, Unfall, Risikoleben)" value={a.vorsorge.sonstige} />
                </div>
              </Block>
            );
          })()}

          <Block
            title="Sonderausgaben und Belastungen"
            summary={sumText(sumOf(a.sonderausgaben.kirchensteuerGezahlt, a.sonderausgaben.spenden, a.krankheitskosten))}
            open={false}
          >
            <div className="form-grid">
              <Amount
                name="kistGezahlt"
                label="Gezahlte Kirchensteuer"
                value={a.sonderausgaben.kirchensteuerGezahlt}
                hint="ohne Kirchensteuer auf Kapitalerträge"
              />
              <Amount name="kistErstattet" label="Erstattete Kirchensteuer" value={a.sonderausgaben.kirchensteuerErstattet} />
              <Amount name="spenden" label="Spenden und Mitgliedsbeiträge" value={a.sonderausgaben.spenden} hint="an steuerbegünstigte Empfänger im Inland" />
              <Amount name="krankheitskosten" label="Krankheitskosten" value={a.krankheitskosten} hint="selbst getragen, nach Erstattungen" />
            </div>
          </Block>

          <Block
            title="Haushaltsnahe Aufwendungen (§ 35a EStG)"
            summary={sumText(sumOf(a.haushaltsnah.minijobs, a.haushaltsnah.dienstleistungen, a.haushaltsnah.handwerker))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="minijobs" label="Minijobs im Haushalt" value={a.haushaltsnah.minijobs} />
              <Amount
                name="dienstleistungen"
                label="Haushaltsnahe Dienstleistungen"
                value={a.haushaltsnah.dienstleistungen}
                hint="z. B. Reinigung, Gartenpflege"
              />
              <Amount name="handwerker" label="Handwerkerleistungen" value={a.haushaltsnah.handwerker} hint="nur Arbeits-, Maschinen- und Fahrtkosten" />
            </div>
          </Block>

          <Block title="Kinder" summary={kinder.length === 0 ? "keine" : `${kinder.length} ${kinder.length === 1 ? "Kind" : "Kinder"}`} open={false}>
            {kinder.map((k, index) => (
              <div key={k.key} className="form-grid" role="group" aria-label={`Kind ${index + 1}`}>
                <Field label="Vorname">
                  {(control) => <input {...control} value={k.vorname} onChange={(e) => updateKind(k.key, { vorname: e.target.value })} required />}
                </Field>
                <Field label="Geburtsdatum">
                  {(control) => (
                    <input {...control} type="date" value={k.geburtsdatum} onChange={(e) => updateKind(k.key, { geburtsdatum: e.target.value })} required />
                  )}
                </Field>
                <Field label="Steuer-ID">
                  {(control) => <input {...control} inputMode="numeric" value={k.idnr ?? ""} onChange={(e) => updateKind(k.key, { idnr: e.target.value })} />}
                </Field>
                <Field label="Familienkasse">
                  {(control) => (
                    <input {...control} required value={k.familienkasse ?? ""} onChange={(e) => updateKind(k.key, { familienkasse: e.target.value })} />
                  )}
                </Field>
                <Field label="Abweichender Nachname">
                  {(control) => <input {...control} value={k.name ?? ""} onChange={(e) => updateKind(k.key, { name: e.target.value })} />}
                </Field>
                <Field label="Kinderbetreuungskosten (€)">
                  {(control) => (
                    <input
                      {...control}
                      inputMode="decimal"
                      value={k.kinderbetreuung}
                      onChange={(e) => updateKind(k.key, { kinderbetreuung: e.target.value })}
                      placeholder="0,00"
                    />
                  )}
                </Field>
                <div className="actions" style={{ gridColumn: "1 / -1" }}>
                  <button type="button" className="btn btn-danger" onClick={() => setKinder((list) => list.filter((x) => x.key !== k.key))}>
                    Kind entfernen
                  </button>
                </div>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setKinder((list) => [...list, { key: Math.max(-1, ...list.map((x) => x.key)) + 1, vorname: "", geburtsdatum: "", kinderbetreuung: "" }])
                }
              >
                + Kind hinzufügen
              </button>
            </div>
          </Block>

          <Block
            title="Kapitalerträge (Anlage KAP)"
            summary={sumText(sumOf(a.kap?.ertraegeMitSteuerabzug, a.kap?.ertraegeOhneSteuerabzugInland, a.kap?.ertraegeAusland))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="kapMit" label="Erträge mit Steuerabzug" value={a.kap?.ertraegeMitSteuerabzug} hint="laut Steuerbescheinigung der Bank" />
              <Amount name="kapSpb" label="Davon genutzter Sparer-Pauschbetrag" value={a.kap?.sparerPauschbetrag} />
              <Amount name="kapOhneInl" label="Inländische Erträge ohne Steuerabzug" value={a.kap?.ertraegeOhneSteuerabzugInland} />
              <Amount name="kapAusl" label="Ausländische Erträge" value={a.kap?.ertraegeAusland} />
              <Amount name="kapESt" label="Einbehaltene Kapitalertragsteuer" value={a.kap?.kapitalertragsteuer} />
              <Amount name="kapSoli" label="Solidaritätszuschlag" value={a.kap?.soli} />
              <Amount name="kapKiSt" label="Kirchensteuer zur Kapitalertragsteuer" value={a.kap?.kirchensteuer} />
              <label className="checkbox" style={{ alignSelf: "end" }}>
                <input type="checkbox" name="guenstigerpruefung" defaultChecked={a.kap?.guenstigerpruefung ?? false} />
                Günstigerprüfung beantragen
              </label>
            </div>
          </Block>

          <p className="small muted" style={{ margin: 0 }}>
            Beträge in Euro; ELSTER bekommt volle Euro, nur die Steuern auf Kapitalerträge mit Cent. Übermittelt werden die gespeicherten Angaben.
          </p>
          {/* Speichern bleibt unten sichtbar; der Hinweis steht davor, weil der Footer mit negativem Rand darüber liegt */}
          <div className="form-sticky-footer">
            <NoticeBanner notice={notice} />
            <div className="actions" style={{ alignItems: "center" }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Angaben speichern
              </button>
              <span className="small muted">Voraussichtliche Steuer {formatEuro(est.prognose.gesamt)}</span>
            </div>
          </div>
        </fieldset>
      </form>
      <AbgabeVermerken art="est" year={data.year} today={data.today} berechnet={est.prognose.verbleibend} vermerkt={est.submitted} />
      <SubmitPanel form="est" data={data} blocked={blocked} sent={Boolean(est.sent)} submitted={est.submitted} />
    </section>
  );
}

function SubmitPanel({
  form,
  data,
  blocked,
  sent,
  submitted,
}: {
  form: Form;
  data: Data;
  blocked: boolean;
  sent: boolean;
  submitted: Data["ust"]["submitted"];
}) {
  const router = useRouter();
  const submit = useServerFn(submitAnnualReturn);
  const loadWerte = useServerFn(getMeinElsterWerte);
  const { busy, notice, setNotice, run } = useAction();
  const berechnet = form === "ust" ? data.ust.abschluss : form === "euer" ? data.euer.gewinn : 0;

  return (
    <div className="stack sticky-panel">
      <ElsterSubmit
        setup={data}
        title={`${FORM_LABEL[form]} übermitteln`}
        className="card"
        ready={!blocked && !submitted}
        busy={busy}
        notice={notice}
        lockedHint={
          submitted
            ? "Außerhalb von Haben abgegeben. Eine Übermittlung aus Haben ist nicht mehr nötig."
            : sent
              ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal."
              : undefined
        }
        confirmTitle={`${FORM_LABEL[form]} ${data.year} verbindlich senden?`}
        confirmFacts={[
          { label: form === "euer" ? "Meldung" : "Steuerart", value: FORM_LABEL[form] },
          { label: "Zeitraum", value: String(data.year) },
        ]}
        confirmText={`Die ${FORM_LABEL[form]} ${data.year} geht verbindlich an das Finanzamt.`}
        footer="Erst mit „Nur prüfen“ oder einer Testübermittlung prüft ERiC die Daten gegen die Vorgaben des Jahres. Die PIN wird nicht gespeichert."
        onSubmit={(kind, pin) =>
          run(async () => {
            const result = await submit({ data: { form, year: data.year, kind, pin } });
            setNotice(elsterNotice(kind, result, "Übermittelt."));
            await router.invalidate();
          })
        }
      />
      {(form === "ust" || form === "euer") && <AbgabeVermerken art={form} year={data.year} today={data.today} berechnet={berechnet} vermerkt={submitted} />}
      {!data.herstellerIdConfigured && !sent && !submitted && (
        <MeinElsterWerte load={() => loadWerte({ data: { form, year: data.year } })} label={`${FORM_LABEL[form]} ${data.year}`} blocked={blocked} />
      )}
    </div>
  );
}

function History({ data }: { data: Data }) {
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
