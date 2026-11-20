import { EVATR_VERGLEICH, type EvatrArt, type EvatrVergleich, evatrMeldung, germanDay } from "@haben/core";
import { formatDate } from "./format.ts";
import { renderUstidBestaetigungPdf } from "./pdf.ts";

/*
 * Eine gespeicherte Antwort des BZSt zur Bestätigung einer ausländischen USt-IdNr. (§ 18e Nr. 1 UStG, #1491) als PDF für
 * Ablage, Steuerberatung oder Außenprüfung. Eine schriftliche Bestätigung verschickt das BZSt nicht; Nachweis ist bei
 * Abfragen über die Schnittstelle der empfangene Datensatz (UStAE 18e.1 Abs. 2 Sätze 3 bis 5, FAQ des BZSt). Das PDF gibt
 * ihn wieder, unverändert am Ende, und sagt, dass es keine Bestätigung des BZSt ist. Es entsteht beim Abruf und wird nicht
 * gespeichert.
 */

export interface UstidBestaetigungDocument {
  /** Name des Kontakts in Haben, an dem die Antwort steht */
  kontakt: string;
  art: EvatrArt;
  anfragendeUstid: string;
  angefragteUstid: string;
  /** Bei der qualifizierten Abfrage gesendet; Straße und PLZ optional */
  firmenname: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  status: string;
  anfrageZeitpunkt: Date;
  gueltigAb: string | null;
  gueltigBis: string | null;
  ergFirmenname: string | null;
  ergStrasse: string | null;
  ergPlz: string | null;
  ergOrt: string | null;
  bzstId: string | null;
  /** Der empfangene Datensatz, wie er kam */
  antwort: string;
  /** Erstellt am, JJJJ-MM-TT */
  heute: string;
  /** Eigene Firma, für die Metadaten des PDFs */
  firma: string;
}

const zeitFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Berlin",
});

const vergleich = (wert: string | null) => (wert && wert in EVATR_VERGLEICH ? EVATR_VERGLEICH[wert as EvatrVergleich] : "–");
/** Gültigkeitsdaten kommen als Text vom BZSt; ein ISO-Datum steht deutsch da, alles andere wie empfangen */
const datum = (text: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? formatDate(text) : text);

/** Der Datensatz hat keine Leerzeichen, an denen Typst umbrechen könnte; er steht deshalb in Stücken fester Länge da */
const DATENSATZ_ZEILE = 80;
const stuecke = (text: string) =>
  Array.from({ length: Math.ceil(text.length / DATENSATZ_ZEILE) }, (_, i) => text.slice(i * DATENSATZ_ZEILE, (i + 1) * DATENSATZ_ZEILE));

/** Druckfertige Texte für templates/ustid-bestaetigung.typ */
export function ustidBestaetigungPdfData(doc: UstidBestaetigungDocument) {
  const qualifiziert = doc.art === "qualifiziert";
  const zeitpunkt = `${zeitFormat.format(doc.anfrageZeitpunkt)} Uhr`;
  const angaben = [
    ["Name", doc.firmenname, doc.ergFirmenname],
    ["Straße", doc.strasse, doc.ergStrasse],
    ["PLZ", doc.plz, doc.ergPlz],
    ["Ort", doc.ort, doc.ergOrt],
  ] as const;
  return {
    docTitle: `Antwort des BZSt zur USt-IdNr. ${doc.angefragteUstid} vom ${formatDate(germanDay(doc.anfrageZeitpunkt))}`,
    author: doc.firma,
    title: `Antwort des BZSt zur USt-IdNr. ${doc.angefragteUstid}`,
    untertitel: `Bestätigungsverfahren nach § 18e Nr. 1 UStG, ${qualifiziert ? "qualifizierte Abfrage mit Name und Anschrift" : "einfache Abfrage"} über die eVatR-Schnittstelle`,
    hinweis:
      "Dieses Blatt gibt die Antwort des BZSt wieder, wie Haben sie gespeichert hat; es ist keine Bestätigung des BZSt. Den empfangenen Datensatz zeigt es am Ende unverändert, nur umbrochen.",
    anfrage: [
      { label: "Angefragte USt-IdNr.", value: doc.angefragteUstid },
      { label: "Eigene USt-IdNr.", value: doc.anfragendeUstid },
      { label: "Kontakt in Haben", value: doc.kontakt },
      { label: "Zeitpunkt der Anfrage", value: zeitpunkt },
      { label: "ID der Antwort", value: doc.bzstId ?? "–" },
    ],
    ergebnis: [
      { label: "Status", value: `${evatrMeldung(doc)} (${doc.status})` },
      ...(doc.gueltigAb ? [{ label: "Gültig ab", value: datum(doc.gueltigAb) }] : []),
      ...(doc.gueltigBis ? [{ label: "Gültig bis", value: datum(doc.gueltigBis) }] : []),
    ],
    angaben: qualifiziert ? angaben.map(([label, gesendet, erg]) => ({ label, gesendet: gesendet ?? "nicht gesendet", ergebnis: vergleich(erg) })) : null,
    datensatz: stuecke(doc.antwort),
    erstellt: `Erstellt am ${formatDate(doc.heute)} mit Haben`,
  };
}

export function buildUstidBestaetigungPdf(doc: UstidBestaetigungDocument): Uint8Array {
  return renderUstidBestaetigungPdf(ustidBestaetigungPdfData(doc), doc.heute);
}
