import { currentYear, MONTHS, formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Icon } from "../Icon.tsx";
import { ScrollBox } from "../ScrollTable.tsx";
import { Status } from "../Status.tsx";

import { BB_CONFIG, type MigrationData } from "./migration-quellen.ts";

/* Abgleich der übernommenen Jahre mit den Summen der Quelle (Migration.tsx) */

type VatMonth = MigrationData["years"][number]["vat"][number];

const SPECIAL_COLUMNS = [
  { key: "kz21", label: "Kz 21", title: "Sonstige Leistungen ins EU-Ausland (Reverse Charge)" },
  { key: "kz41", label: "Kz 41", title: "Innergemeinschaftliche Lieferungen" },
  { key: "kz43", label: "Kz 43", title: "Steuerfreie Ausfuhrlieferungen" },
  { key: "kz45", label: "Kz 45", title: "Nicht steuerbare Leistungen ins Drittland" },
  { key: "kz60", label: "Kz 60", title: "Umsätze, für die der Empfänger die Steuer nach § 13b UStG schuldet" },
  { key: "kz87", label: "Kz 87", title: "Umsätze zu 0 % nach § 12 Abs. 3 UStG (Photovoltaik)" },
  { key: "steuerfrei", label: "Steuerfrei", title: "In der bisherigen Buchhaltung als steuerfrei markiert: Kz 48 oder Kleinunternehmer" },
  { key: "oss", label: "OSS", title: "Fernverkäufe und elektronische Dienstleistungen über das OSS-Verfahren" },
  { key: "kz46", label: "Kz 46", title: "Bezogene sonstige Leistungen nach § 13b Abs. 1 UStG (Bemessungsgrundlage)" },
  { key: "kz47", label: "Kz 47", title: "Steuer zu Kz 46" },
  { key: "kz84", label: "Kz 84", title: "Andere bezogene Leistungen nach § 13b UStG (Bemessungsgrundlage)" },
  { key: "kz85", label: "Kz 85", title: "Steuer zu Kz 84" },
  { key: "kz67", label: "Kz 67", title: "Vorsteuer aus Leistungen nach § 13b UStG" },
  { key: "kz89", label: "Kz 89", title: "Innergemeinschaftliche Erwerbe zu 19 % (Bemessungsgrundlage)" },
  { key: "kz93", label: "Kz 93", title: "Innergemeinschaftliche Erwerbe zu 7 % (Bemessungsgrundlage)" },
  { key: "kz61", label: "Kz 61", title: "Vorsteuer aus innergemeinschaftlichem Erwerb" },
  {
    key: "otherPurchases",
    label: "Andere Bezüge",
    title: "Ausgaben mit eigener Steuerart aus sevDesk, deren Kennzahlen Haben nicht kennt oder nicht abgerufen hat",
  },
] as const;

/** Spalten für Sonderfälle nur, wenn im Jahr etwas drinsteht */
function specialColumns(months: VatMonth[]) {
  return SPECIAL_COLUMNS.filter((c) => months.some((m) => m[c.key] !== 0));
}

/**
 * Archiviert, aber weder Einnahme noch Ausgabe: im Einzelunternehmen Privates und Geldtransit, bei GmbH und UG
 * Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen. Sichtbar, damit der Vergleich mit der alten Buchhaltung
 * aufgeht und nichts still fehlt.
 */
function NeutralSums({ year, rows }: { year: number; rows: MigrationData["years"][number]["neutral"] }) {
  return (
    <ScrollBox label={`Weder Einnahme noch Ausgabe ${year}`}>
      <table className="data-table" aria-label={`Weder Einnahme noch Ausgabe ${year}`}>
        <caption className="small muted" style={{ textAlign: "left", captionSide: "top", paddingBottom: 4 }}>
          Weder Einnahme noch Ausgabe, deshalb nicht in den Summen oben und nicht in der Umsatzsteuer
        </caption>
        <thead>
          <tr>
            <th>Art</th>
            <th className="num">Anzahl</th>
            <th className="num">Zufluss</th>
            <th className="num">Abfluss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.kind}>
              <td>{row.label}</td>
              <td className="num">{row.count}</td>
              <td className="num">{formatEuro(row.zufluss)}</td>
              <td className="num">{formatEuro(row.abfluss)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}

export function YearCheck({ year, versteuerung, product }: { year: MigrationData["years"][number]; versteuerung: "ist" | "soll"; product: string }) {
  return (
    <section className="card stack" aria-labelledby={`year-${year.year}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 id={`year-${year.year}`} style={{ margin: 0 }}>
          Geschäftsjahr {year.year}
        </h3>
        {year.ready ? (
          <Status tone="ok" inline>
            Vollständig
          </Status>
        ) : (
          <Status tone="warn" emphasis="notice" inline>
            Unvollständig
          </Status>
        )}
      </div>
      <div className="grid-main">
        <ul className="checks">
          {year.checks.map((check) => (
            <li key={check.label}>
              <span className={check.ok ? "ok" : "open"} aria-hidden="true">
                <Icon name={check.ok ? "check" : "alert"} />
              </span>
              <span>
                {check.label}
                <span className="visually-hidden">{check.ok ? " – erfüllt" : " – offen"}</span>
              </span>
              <span className="small muted">{check.detail}</span>
            </li>
          ))}
        </ul>
        <dl className="facts">
          <dt>Einnahmen netto</dt>
          <dd className="amount">{formatEuro(year.einnahmen.net)}</dd>
          <dt>Umsatzsteuer</dt>
          <dd className="amount">{formatEuro(year.einnahmen.tax)}</dd>
          <dt>Ausgaben netto</dt>
          <dd className="amount">{formatEuro(year.ausgaben.net)}</dd>
          <dt>Vorsteuer</dt>
          <dd className="amount">{formatEuro(year.ausgaben.tax)}</dd>
          <dt>Letzte Rechnungsnummer</dt>
          <dd className="mono">{year.lastInvoiceNumber ?? "–"}</dd>
        </dl>
      </div>
      <div className="small muted">
        {year.sumsFrom === "datev"
          ? `${product === BB_CONFIG.product || year.sevdeskExport ? "Die Belege liegen nur zum Nachschlagen im Archiv" : "Keine Belege per API"}: Summen aus dem DATEV-Buchungsstapel, nach Erlös-, Aufwands- und Steuerkonten des Kontenrahmens geschätzt. Vergleiche sie mit den Auswertungen in ${product}.`
          : year.sumsFrom === "gemischt"
            ? `Summen nach Belegdatum, dazu der Teil aus BuchhaltungsButler aus dessen DATEV-Buchungsstapel (geschätzt nach Kontenklassen). Vergleiche sie mit den Auswertungen in ${product} und BuchhaltungsButler.`
            : `Summen nach Belegdatum. Vergleiche sie mit den Auswertungen in ${product}.`}{" "}
        {year.bookings && year.bookings.unmatched > 0 && (
          <Link to="/archiv" activeProps={{}} search={{ ansicht: "buchungen", jahr: year.year, ohneBeleg: true }}>
            Buchungen ohne passenden Beleg ansehen
          </Link>
        )}{" "}
        {(year.withoutFile > 0 || year.files.anhangFehlt > 0) && (
          <Link to="/archiv" activeProps={{}} search={{ ansicht: "belege", jahr: year.year, ohneDatei: true }}>
            Belege mit fehlender Datei ansehen
          </Link>
        )}
      </div>
      {year.neutral.length > 0 && <NeutralSums year={year.year} rows={year.neutral} />}
      {year.vatIssue && (
        <p className="banner banner-info" role="status">
          {year.vatIssue}
        </p>
      )}
      {year.vat.length > 0 && (
        <details>
          <summary>Umsatzsteuer je Monat zum Vergleich mit den übermittelten Voranmeldungen</summary>
          <div className="table-scroll">
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Monat</th>
                  <th className="num">Kz 81</th>
                  <th className="num">Kz 86</th>
                  <th className="num">Kz 66</th>
                  {specialColumns(year.vat).map((c) => (
                    <th key={c.key} className="num" title={c.title}>
                      {c.label}
                    </th>
                  ))}
                  <th className="num">Andere Sätze</th>
                </tr>
              </thead>
              <tbody>
                {year.vat.map((m) => (
                  <tr key={m.month}>
                    <td>{MONTHS[Number(m.month.slice(5)) - 1]}</td>
                    <td className="num">{formatEuro(m.kz81)}</td>
                    <td className="num">{formatEuro(m.kz86)}</td>
                    <td className="num">{formatEuro(m.kz66)}</td>
                    {specialColumns(year.vat).map((c) => (
                      <td key={c.key} className="num">
                        {formatEuro(m[c.key])}
                      </td>
                    ))}
                    <td className="num">{formatEuro(m.otherBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Aus den übernommenen Belegen berechnet:{" "}
            {versteuerung === "ist" ? "Einnahmen nach Zahlungsdatum (Ist-Versteuerung)" : "Einnahmen nach Rechnungsdatum (Soll-Versteuerung)"}, Ausgaben
            (Vorsteuer, § 13b, innergemeinschaftlicher Erwerb) nach Belegdatum. Kz 21, 41 und 60 zählen immer nach Belegdatum. „Steuerfrei“ gehört in Kz 48,
            wenn die Umsätze nach § 4 Nr. 8–28 UStG steuerfrei sind, und fehlt bei Kleinunternehmern ganz; „OSS“ meldest du nicht in der Voranmeldung. Kleine
            Abweichungen entstehen, wenn in {product} nachträglich korrigiert wurde.
          </p>
        </details>
      )}
      {year.year === currentYear() && year.lastInvoiceNumber && (
        <p className="small" style={{ margin: 0 }}>
          Deine Rechnungsnummern sollen lückenlos weiterlaufen: Stelle die nächste Nummer in den{" "}
          <Link to="/einstellungen" search={{ bereich: "rechnungen" }}>
            Einstellungen
          </Link>{" "}
          auf die Nummer nach {year.lastInvoiceNumber}.
        </p>
      )}
    </section>
  );
}
