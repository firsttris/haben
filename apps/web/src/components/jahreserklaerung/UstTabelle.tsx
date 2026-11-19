import { formatDeduction, formatEuro, isKapitalgesellschaft } from "@haben/core";
import { Block } from "./Block.tsx";
import { Row } from "./Row.tsx";
import type { Data } from "./typen.ts";

/**
 * Die zwei Schlusszeilen der Umsatzsteuererklärung. Mit Vermerk stehen dort die erklärten Beträge (#1076), weil
 * Habens eigene Rechnung die Veranlagung nicht kennt und in einem Jahr ohne Buchungen das Vorzeichen umkehrt.
 */
function UstSummen({ anzeige }: { anzeige: Data["ust"]["anzeige"] }) {
  const zusatz = (ausVermerk: boolean) => (ausVermerk ? " laut Vermerk" : "");
  return (
    <>
      <Row
        label={`Vorauszahlungssoll (gesendete Voranmeldungen)${zusatz(anzeige.ausVermerk.vorauszahlungen)}`}
        value={formatDeduction(anzeige.vorauszahlungen)}
      />
      <Row
        label={`${anzeige.abschluss >= 0 ? "Abschlusszahlung" : "Erstattung"}${zusatz(anzeige.ausVermerk.abschluss)}`}
        value={formatEuro(anzeige.abschluss)}
        total
      />
    </>
  );
}

/**
 * Habens Rechnung zur Umsatzsteuererklärung: zuerst die Summen, die Einzelzeilen mit Kennzahl dahinter eingeklappt (#1253).
 * Habens Rechnung bleibt stehen, auch wenn erklärte Zeilen vorliegen: was fehlt, kommt von hier (#869, #997).
 */
export function UstTabelle({ data }: { data: Data }) {
  const { ust } = data;
  const f = ust.figures;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        {Object.keys(ust.erklaert).length > 0 && <div className="section-label">Habens Rechnung aus den Buchungen, zum Vergleich mit den erklärten Zeilen</div>}
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
            <Row label={ust.steuer >= 0 ? "Umsatzsteuer" : "Überschuss"} value={formatEuro(ust.steuer)} total />
            <UstSummen anzeige={ust.anzeige} />
          </tbody>
        </table>
      </div>
      <Block title="Zeilen anzeigen" summary="Umsätze und Vorsteuer, mit Kennzahl" open={false}>
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
            {(f.kz48Zeile46 ?? 0) !== 0 && (
              <Row label="Steuerfreie Umsätze ohne Vorsteuerabzug (Vermietung, § 4 Nr. 12)" kz="46" extra={formatEuro(f.kz48Zeile46!)} value="–" />
            )}
            {(f.kz48Zeile47 ?? 0) !== 0 && (
              <Row
                label={`Steuerfreie Umsätze ohne Vorsteuerabzug (§ 4 Nr. ${f.kz48Zeile47Nummern ?? "?"})`}
                kz="48"
                extra={formatEuro(f.kz48Zeile47!)}
                value="–"
              />
            )}
            {ust.kz48Gesperrt.length > 0 && (
              <Row
                label="Steuerfreie Umsätze ohne Vorsteuerabzug, nicht zuordenbar"
                kz="48"
                extra={formatEuro(ust.kz48Gesperrt.reduce((s, e) => s + e.betrag, 0))}
                value="–"
              />
            )}
            <Row label="Abziehbare Vorsteuer aus Rechnungen" kz="66" extra="" value={formatDeduction(f.vorsteuer)} />
            {(f.kz61 ?? 0) !== 0 && <Row label="Vorsteuer aus innergemeinschaftlichem Erwerb" kz="61" extra="" value={formatDeduction(f.kz61!)} />}
            {(f.kz62 ?? 0) !== 0 && <Row label="Entstandene Einfuhrumsatzsteuer" kz="62" extra="" value={formatDeduction(f.kz62!)} />}
            {(f.kz67 ?? 0) !== 0 && <Row label="Vorsteuer aus §-13b-Leistungen" kz="67" extra="" value={formatDeduction(f.kz67!)} />}
          </tbody>
        </table>
      </Block>
      <p className="small muted" style={{ margin: 0 }}>
        Bemessungsgrundlagen in vollen Euro, die Steuer daraus wie in der Voranmeldung. {data.versteuerung === "ist" ? "Ist-Versteuerung" : "Soll-Versteuerung"}
        .{/* Privatnutzung als unentgeltliche Wertabgabe bucht Haben nur im Einzelunternehmen (docs/anlagen.md) */}
        {!isKapitalgesellschaft(data.rechtsform) && " Die private Kfz-Nutzung ist in den Umsätzen zu 19 % enthalten."}
      </p>
    </div>
  );
}
