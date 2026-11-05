import { formatDecimal, KONFESSIONEN, type LstbWerte } from "@haben/core";
import { formatDate } from "./format.ts";
import { renderLohnPdf } from "./pdf.ts";

/*
 * Ausdruck der elektronischen Lohnsteuerbescheinigung für den Arbeitnehmer (§ 41b Abs. 1 Satz 3 EStG) nach dem amtlichen
 * Muster: BMF-Schreiben vom 29.8.2025, „Ausdruck der elektronischen Lohnsteuerbescheinigung für 2026“
 * (https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2025-08-29-ausdruck-elektr-lstbesch-2026.html).
 * Zeilen und Texte wie im Muster; leer bleibt, was Haben nicht abrechnet. Bis 2025 stand in Zeile 28 der Beitrag zur privaten
 * Kranken- und Pflege-Pflichtversicherung (lstb202501.xsd), ab 2026 steht er links bei den Lohnsteuerabzugsmerkmalen.
 * Vor der Übermittlung entsteht nur ein Entwurf: Der Ausdruck bescheinigt maschinell übermittelte Daten mit Transferticket.
 */

export interface LstbAusdruckDocument {
  werte: LstbWerte;
  angaben: {
    arbeitnehmer: { idnr: string; ordnungsmerkmal: string; vorname: string; nachname: string; geburtsdatum: string; strasse: string; plz: string; ort: string };
    arbeitgeber: { name: string; steuernummer13: string; finanzamt: string; strasse: string; plz: string; ort: string };
  };
  /** Übermittelte Bescheinigung; null für den Entwurf */
  uebermittlung: { datum: string; transferTicket: string; korrektur: boolean; storniert: boolean } | null;
  heute: string;
}

const betrag = (cents: number) => (cents === 0 ? "" : formatDecimal(cents));
const zahl = (tausendstel: number) => (tausendstel / 1000).toLocaleString("de-DE", { maximumFractionDigits: 3 });
const ttmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Druckfertige Texte für templates/lohnsteuerbescheinigung.typ */
export function lstbAusdruckPdfData({ werte: w, angaben: { arbeitnehmer: n, arbeitgeber: a }, uebermittlung: u, heute }: LstbAusdruckDocument) {
  const ab2026 = w.jahr >= 2026;
  const m = w.merkmale.at(-1)!;
  const leer = "";
  const zeile = (nr: string, text: string, wert = leer) => ({ nr, text, wert });
  const fa = a.steuernummer13.slice(0, 4);
  return {
    docTitle: `Lohnsteuerbescheinigung ${w.jahr} ${n.vorname} ${n.nachname}`,
    author: a.name,
    title: `Ausdruck der elektronischen Lohnsteuerbescheinigung für ${w.jahr}`,
    untertitel: u ? "Nachstehende Daten wurden maschinell an die Finanzverwaltung übermittelt." : null,
    entwurf: u
      ? null
      : "Entwurf: noch nicht an die Finanzverwaltung übermittelt. Kein Ausdruck nach § 41b Abs. 1 Satz 3 EStG; erst nach der Übermittlung mit Transferticket.",
    arbeitnehmer: [`${n.vorname} ${n.nachname}`, n.strasse, `${n.plz} ${n.ort}`].filter(Boolean),
    kopf: [
      { label: "Korrektur:", value: u?.korrektur ? "ja" : leer },
      { label: "Stornierung:", value: u?.storniert ? "ja" : leer },
      { label: "Datum:", value: u ? formatDate(u.datum) : leer },
      { label: "Identifikationsnummer:", value: n.idnr },
      { label: "Personalnummer:", value: n.ordnungsmerkmal },
      { label: "Geburtsdatum:", value: formatDate(n.geburtsdatum) },
      { label: "Transferticket:", value: u?.transferTicket ?? leer },
    ],
    merkmale: [
      { label: "Steuerklasse/Faktor", value: m.faktor !== 1000 ? `${m.steuerklasse}/${zahl(m.faktor)}` : String(m.steuerklasse) },
      { label: "Zahl der Kinderfreibeträge", value: zahl(m.kinderfreibetraege) },
      { label: "Steuerfreier Jahresbetrag", value: leer },
      { label: "Jahreshinzurechnungsbetrag", value: leer },
      { label: "Kirchensteuermerkmale", value: m.konfession ?? "--" },
      ...(ab2026
        ? [
            { label: "Beiträge zur privaten Kranken- und Pflege-Pflichtversicherung (§ 39 Abs. 4 Nr. 4 Buchst. a EStG)", value: leer },
            {
              label: "Beiträge zur privaten Basiskranken- und Pflege-Pflichtversicherung (§ 39 Abs. 4 Nr. 4 Buchst. b EStG)",
              value: w.pkvBasis ? betrag(w.pkvBasis.letzterMonat) : leer,
            },
          ]
        : []),
    ],
    merkmaleHinweis:
      w.merkmale.length > 1
        ? `Im Jahr geändert: ${w.merkmale
            .map(
              (x) =>
                `ab ${formatDate(x.gueltigAb)} Steuerklasse ${x.steuerklasse}, Kinderfreibeträge ${zahl(x.kinderfreibetraege)}, ${x.konfession ? KONFESSIONEN[x.konfession] : "keine Kirchensteuer"}`,
            )
            .join("; ")}`
        : null,
    arbeitgeber: [a.name, a.strasse, `${a.plz} ${a.ort}`, `Steuernummer ${a.steuernummer13}`],
    zeilen: [
      zeile("1.", "Bescheinigungszeitraum", `${ttmm(w.von)} – ${ttmm(w.bis)}`),
      zeile("2.", "Zeiträume ohne Anspruch auf Arbeitslohn (Anzahl „U“)"),
      zeile("", "Großbuchstaben (S, M, F, FR)"),
      zeile("3.", "Bruttoarbeitslohn einschl. Sachbezüge", formatDecimal(w.bruttoarbeitslohn)),
      zeile("4.", "Einbehaltene Lohnsteuer von 3.", formatDecimal(w.lohnsteuer)),
      zeile("5.", "Einbehaltener Solidaritätszuschlag von 3.", formatDecimal(w.soli)),
      zeile("6.", "Einbehaltene Kirchensteuer des Arbeitnehmers von 3.", betrag(w.kirchensteuer)),
      zeile("7.", "Einbehaltene Kirchensteuer des Ehegatten/Lebenspartners von 3. (nur bei Konfessionsverschiedenheit)"),
      zeile("8.", "In 3. enthaltene Versorgungsbezüge"),
      zeile("9.", "Versorgungsbezüge für mehrere Kalenderjahre (in 3. enthalten)"),
      zeile("10.", "Arbeitslohn für mehrere Kalenderjahre, Entschädigungen, z. B. Abfindungen (in 3. enthalten, ohne 9.)"),
      zeile("11.", "unbesetzt"),
      zeile("12.", "unbesetzt"),
      zeile("13.–14.", "unbesetzt"),
      zeile("15.", "Leistungen, die dem Progressionsvorbehalt unterliegen (z. B. Lohnersatzleistungen)"),
      zeile("15a.", "(Saison-)Kurzarbeitergeld in 15. enthalten"),
      zeile("16. a)", "Steuerfreier Arbeitslohn nach Doppelbesteuerungsabkommen (DBA)"),
      zeile("16. b)", "Steuerfreier Arbeitslohn nach Auslandstätigkeitserlass"),
      zeile("17.", "Steuerfreie Arbeitgeberleistungen, die auf die Entfernungspauschale anzurechnen sind"),
      zeile("18.", "Pauschal mit 15 % besteuerte Arbeitgeberleistungen für Fahrten zwischen Wohnung und erster Tätigkeitsstätte"),
      zeile("19.", "unbesetzt"),
      zeile("20.", "Steuerfreie Verpflegungszuschüsse bei Auswärtstätigkeit"),
      zeile("21.", "Steuerfreie Arbeitgeberleistungen bei doppelter Haushaltsführung"),
      zeile("22. a)", "Arbeitgeberanteil/-zuschuss zur gesetzlichen Rentenversicherung", betrag(w.rvArbeitgeber)),
      zeile("22. b)", "Arbeitgeberanteil/-zuschuss an berufsständische Versorgungseinrichtungen"),
      zeile("23. a)", "Arbeitnehmeranteil zur gesetzlichen Rentenversicherung", betrag(w.rvArbeitnehmer)),
      zeile("23. b)", "Arbeitnehmeranteil an berufsständische Versorgungseinrichtungen"),
      zeile("24. a)", "Steuerfreie Arbeitgeberzuschüsse zur gesetzlichen Krankenversicherung"),
      zeile("24. b)", "Steuerfreie Arbeitgeberzuschüsse zur privaten Krankenversicherung"),
      zeile("24. c)", "Steuerfreie Arbeitgeberzuschüsse zur gesetzlichen Pflegeversicherung"),
      zeile("25.", "Arbeitnehmerbeiträge zur gesetzlichen Krankenversicherung", betrag(w.kvArbeitnehmer)),
      zeile("26.", "Arbeitnehmerbeiträge zur sozialen Pflegeversicherung", betrag(w.pvArbeitnehmer)),
      zeile("27.", "Arbeitnehmerbeiträge zur Arbeitslosenversicherung", betrag(w.avArbeitnehmer)),
      ab2026
        ? zeile("28.", "unbesetzt")
        : zeile("28.", "Beiträge zur privaten Kranken- und Pflege-Pflichtversicherung", w.pkvBasis ? betrag(w.pkvBasis.jahr) : leer),
      zeile("29.", "Bemessungsgrundlage für den Versorgungsfreibetrag zu 8."),
      zeile("30.", "Maßgebendes Kalenderjahr des Versorgungsbeginns zu 8. und/oder 9."),
      zeile("31.", "Zu 8. bei unterjähriger Zahlung: Erster und letzter Monat, für den Versorgungsbezüge gezahlt wurden"),
      zeile("32.", "Sterbegeld; Kapitalauszahlungen/Abfindungen und Nachzahlungen von Versorgungsbezügen – in 3. und 8. enthalten"),
      zeile("33.", "unbesetzt"),
      zeile("34.", "Freibetrag DBA Türkei"),
    ],
    finanzamt: `${a.finanzamt} (${fa})`,
    erstellt: `Erstellt am ${formatDate(heute)} mit Haben`,
  };
}

export function buildLstbAusdruckPdf(doc: LstbAusdruckDocument): Uint8Array {
  return renderLohnPdf("lohnsteuerbescheinigung.typ", lstbAusdruckPdfData(doc), doc.heute, "Lohnsteuerbescheinigung", {});
}
