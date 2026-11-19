import { formatEuro } from "@haben/core";
import { ScrollTable } from "../ScrollTable.tsx";
import { Block } from "./Block.tsx";
import { Row } from "./Row.tsx";
import type { Data } from "./typen.ts";

/**
 * Habens Rechnung zur Anlage EÜR: zuerst Summen und Gewinn, die Zeilen mit Feldkennung dahinter eingeklappt (#1253).
 * Habens Rechnung bleibt stehen, auch wenn erklärte Zeilen vorliegen: was fehlt, kommt von hier (#869, #997).
 */
export function EuerTabelle({ data }: { data: Data }) {
  const { euer, euerRows } = data;
  const zeile = (r: (typeof euerRows.einnahmen)[number]) => <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        {Object.keys(euer.erklaert).length > 0 && (
          <div className="section-label">Habens Rechnung aus den Buchungen, zum Vergleich mit den erklärten Zeilen</div>
        )}
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th scope="col">Zeile</th>
              <th scope="col" className="num">
                Betrag
              </th>
            </tr>
          </thead>
          <tbody>
            <Row label="Summe Betriebseinnahmen" value={formatEuro(euer.einnahmen)} total />
            <Row label="Summe Betriebsausgaben" value={formatEuro(euer.ausgaben)} total />
            <Row label={euer.gewinn >= 0 ? "Gewinn" : "Verlust"} value={formatEuro(euer.gewinn)} total />
          </tbody>
        </ScrollTable>
      </div>
      <Block title="Zeilen anzeigen" summary="Einnahmen, Ausgaben, Entnahmen und Einlagen, mit Feldkennung" open={false}>
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
            {euerRows.einnahmen.map(zeile)}
            {euerRows.ausgaben.map(zeile)}
            {euerRows.privat.map(zeile)}
          </tbody>
        </ScrollTable>
      </Block>
    </div>
  );
}
