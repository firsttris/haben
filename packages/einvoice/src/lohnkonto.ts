import { formatDecimal, type Lohnkonto } from "@haben/core";
import { formatDate } from "./format.ts";
import { renderLohnPdf } from "./pdf.ts";

/*
 * Lohnkonto eines Arbeitnehmers für ein Kalenderjahr als PDF/A-3b (§ 41 Abs. 1 EStG, Einzelangaben nach § 4 LStDV).
 * Inhalt und Summen kommen aus `lohnkonto` in @haben/core; hier wird nur formatiert. Querformat, damit alle Spalten
 * nach § 4 Abs. 2 LStDV nebeneinander passen.
 */

export interface LohnkontoDocument {
  lohnkonto: Lohnkonto;
  arbeitgeber: { name: string; strasse: string; plz: string; ort: string };
  /** Erstellungsdatum */
  heute: string;
}

const betrag = (cents: number) => formatDecimal(cents);

/** Druckfertige Texte für templates/lohnkonto.typ */
export function lohnkontoPdfData({ lohnkonto: k, arbeitgeber: a, heute }: LohnkontoDocument) {
  const m = k.mitarbeiter;
  const zeile = (z: Lohnkonto["zeilen"][number]) => [
    formatDate(z.zahltag),
    `${String(z.monat).padStart(2, "0")}/${k.jahr}`,
    z.storno ? "Storno" : "Abrechnung",
    z.merkmale,
    ...[
      z.brutto,
      z.steuerBrutto,
      z.steuerfrei,
      z.pauschalBrutto,
      z.lohnsteuer,
      z.soli,
      z.kirchensteuer,
      z.pauschsteuer,
      z.svArbeitnehmer,
      z.svArbeitgeber,
      z.netto,
    ].map(betrag),
  ];
  const s = k.summe;
  return {
    docTitle: `Lohnkonto ${k.jahr} ${m.vorname} ${m.nachname}`,
    author: a.name,
    title: `Lohnkonto ${k.jahr}`,
    untertitel: "nach § 41 Abs. 1 EStG und § 4 LStDV",
    arbeitgeber: `${a.name}, ${a.strasse}, ${a.plz} ${a.ort}`,
    person: [
      { label: "Name", value: `${m.nachname}, ${m.vorname}` },
      { label: "Personalnummer", value: m.personalnummer },
      { label: "Geburtsdatum", value: formatDate(m.geburtsdatum) },
      { label: "Wohnung, Wohnort", value: m.anschrift.join(", ") || "–" },
      { label: "Steuer-ID", value: m.steuerId || "–" },
      { label: "Besteuerungsmerkmale", value: m.merkmale },
      { label: "Sozialversicherung", value: m.sozialversicherung },
      { label: "Beschäftigung", value: m.austritt ? `${formatDate(m.eintritt)} – ${formatDate(m.austritt)}` : `seit ${formatDate(m.eintritt)}` },
    ],
    spalten: [
      "Tag der Zahlung",
      "Zeitraum",
      "Art",
      "Merkmale",
      "Brutto",
      "Steuer­pflichtig",
      "Steuer­frei",
      "Pauschal versteuert",
      "Lohn­steuer",
      "Soli",
      "Kirchen­steuer",
      "Pausch­steuer",
      "SV AN",
      "SV AG",
      "Netto",
    ],
    zeilen: k.zeilen.map(zeile),
    summe: [
      "Summe",
      "",
      "",
      "",
      ...[
        s.brutto,
        s.steuerBrutto,
        s.steuerfrei,
        s.pauschalBrutto,
        s.lohnsteuer,
        s.soli,
        s.kirchensteuer,
        s.pauschsteuer,
        s.svArbeitnehmer,
        s.svArbeitgeber,
        s.netto,
      ].map(betrag),
    ],
    leer: k.zeilen.length === 0 ? `Im Jahr ${k.jahr} ist keine Abrechnung festgeschrieben.` : null,
    hinweise: [
      "Beträge in Euro. Ein Storno steht mit negativen Beträgen am Tag des Stornos. Sachbezüge, steuerfreie Bezüge, Freibeträge und Versorgungsbezüge rechnet Haben nicht; die Spalte „Steuerfrei“ bleibt daher 0.",
      k.aufbewahrenBis
        ? `Aufbewahren bis ${formatDate(k.aufbewahrenBis)} (Ablauf des sechsten Kalenderjahres nach der letzten Lohnzahlung, § 41 Abs. 1 Satz 9 EStG).`
        : "",
    ].filter(Boolean),
    erstellt: `Erstellt am ${formatDate(heute)}`,
  };
}

export function buildLohnkontoPdf(doc: LohnkontoDocument): Uint8Array {
  return renderLohnPdf("lohnkonto.typ", lohnkontoPdfData(doc), doc.heute, "Lohnkonto", {});
}
