import { formatEuro, type Bestandteil, type LegalInfo, type SvBeitraege } from "@haben/core";
import { formatDate, formatIban } from "./format.ts";
import { legalLine, renderLohnPdf } from "./pdf.ts";
import type { Letterhead } from "./types.ts";

/*
 * Entgeltabrechnung eines Monats als PDF/A-3b. Inhalt nach § 108 Abs. 1 GewO (Abrechnungszeitraum, Zusammensetzung des
 * Arbeitsentgelts, Art und Höhe der Abzüge) und als Entgeltbescheinigung nach § 108 Abs. 3 Satz 1 GewO mit den Angaben
 * aus § 1 der Entgeltbescheinigungsverordnung (EntgBV, https://www.gesetze-im-internet.de/entgbv/__1.html):
 * Abs. 1 Nr. 1 bis 11 zu Arbeitgeber und Beschäftigtem, Abs. 2 Nr. 1 bis 7 zu den Entgeltbestandteilen, Abs. 4 die
 * Kennzeichnung. Gerechnet ist alles vorher (`lohnabrechnung` in @haben/core); hier wird nur formatiert.
 */

export interface LohnabrechnungDocument extends Letterhead {
  arbeitgeber: { name: string; strasse: string; plz: string; ort: string };
  /** Pflichtangaben einer GmbH oder UG (§ 35a Abs. 1 GmbHG) */
  legalInfo?: LegalInfo;
  arbeitnehmer: {
    vorname: string;
    nachname: string;
    strasse: string;
    plz: string;
    ort: string;
    geburtsdatum: string;
    personalnummer: number;
    steuerId: string;
    svNummer: string;
    iban: string;
  };
  jahr: number;
  monat: number;
  zahltag: string;
  ausgestellt: string;
  eintritt: string;
  /** Nur in der Abrechnung des letzten Monats (§ 1 Abs. 1 Nr. 5 EntgBV) */
  austritt: string | null;
  steuertage: number;
  svTage: number;
  beschaeftigung: string;
  steuer: { steuerklasse: number; faktor: number; kinderfreibetraege: number; konfession: string | null };
  /** Null ohne Sozialversicherung (Gesellschafter-Geschäftsführer) */
  sv: null | {
    personengruppe: string;
    beitragsgruppen: string;
    einzugsstelle: string;
    /** § 1 Abs. 1 Nr. 9 EntgBV */
    pflegeKennziffer: string;
    uebergangsbereich: boolean;
  };
  bestandteile: Bestandteil[];
  betraege: {
    brutto: number;
    steuerBrutto: number;
    svBrutto: number;
    pauschalBrutto: number;
    lohnsteuer: number;
    soli: number;
    kirchensteuer: number;
    sv: SvBeitraege;
    netto: number;
    zuschuss: number;
    auszahlung: number;
  };
  /** Noch nicht festgeschrieben: Kennzeichnung als Entwurf */
  entwurf: boolean;
  /** Stufe C: als Entwurf gegenzuprüfen, bis ein echter Fall gegengerechnet ist */
  gegenpruefen: boolean;
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const STEUERKLASSEN = ["", "I", "II", "III", "IV", "V", "VI"];

const ja = (b: boolean) => (b ? "ja" : "nein");

/** „01.10.2026 – 31.10.2026“ */
function abrechnungszeitraum(jahr: number, monat: number): string {
  const mm = String(monat).padStart(2, "0");
  const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return `01.${mm}.${jahr} – ${letzter}.${mm}.${jahr}`;
}
const tausendstel = (n: number, stellen: number) => (n / 1000).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: 3 });
const row = (label: string, value: string) => ({ label, value });
const minus = (cents: number) => formatEuro(-cents);

function steuerZeilen(d: LohnabrechnungDocument) {
  const s = d.steuer;
  return [
    row("Steuer-ID", d.arbeitnehmer.steuerId || "–"),
    row("Steuerklasse", `${STEUERKLASSEN[s.steuerklasse]}${s.faktor !== 1000 ? `, Faktor ${tausendstel(s.faktor, 3)}` : ""}`),
    row("Kinderfreibeträge", tausendstel(s.kinderfreibetraege, 1)),
    row("Kirchensteuermerkmal", s.konfession ?? "keine Kirchensteuerpflicht"),
    row("Freibetrag, Hinzurechnungsbetrag", "keine"),
  ];
}

function svZeilen(d: LohnabrechnungDocument) {
  if (!d.sv) return [row("Sozialversicherung", "keine Beiträge (Gesellschafter-Geschäftsführer ohne Versicherungspflicht)")];
  return [
    row("Versicherungsnummer", d.arbeitnehmer.svNummer || "–"),
    row("Personengruppe", d.sv.personengruppe || "–"),
    row("Beitragsgruppenschlüssel", d.sv.beitragsgruppen || "–"),
    row("Einzugsstelle", d.sv.einzugsstelle || "–"),
    row("Pflegeversicherung, Kennziffer", d.sv.pflegeKennziffer),
    ...(d.sv.uebergangsbereich ? [row("Übergangsbereich", "Beschäftigung im Übergangsbereich nach § 20 Abs. 2 SGB IV")] : []),
  ];
}

/** Bezüge einzeln nach Art, mit den Angaben nach § 1 Abs. 2 Nr. 1 EntgBV */
function bezuege(d: LohnabrechnungDocument) {
  return d.bestandteile.map((b) => ({
    label: b.bezeichnung,
    art: b.laufend ? "laufend" : "einmalig",
    steuer: b.pauschalBesteuert ? "pauschal" : ja(b.steuerpflichtig),
    sv: ja(b.svPflichtig),
    gesamt: ja(b.gesamtbrutto),
    value: formatEuro(b.betrag),
  }));
}

/** Gesetzliche Abzüge (§ 1 Abs. 2 Nr. 3 EntgBV), laufend; Zeilen mit 0 nur, wo sie zur Art gehören */
function abzuege(d: LohnabrechnungDocument) {
  const b = d.betraege;
  const sv = b.sv;
  const steuern =
    d.betraege.pauschalBrutto > 0 && b.steuerBrutto === 0
      ? []
      : [row("Lohnsteuer", minus(b.lohnsteuer)), row("Solidaritätszuschlag", minus(b.soli)), row("Kirchensteuer", minus(b.kirchensteuer))];
  // Im Minijob trägt der Beschäftigte nur den Anteil zur Rentenversicherung; Zweige ohne Anteil fallen weg
  const beitraege = d.sv
    ? (
        [
          ["Krankenversicherung", sv.kv.an + sv.kvZusatz.an],
          ["Pflegeversicherung", sv.pv.an],
          ["Rentenversicherung", sv.rv.an],
          ["Arbeitslosenversicherung", sv.av.an],
        ] as const
      )
        .filter(([, an]) => an !== 0)
        .map(([label, an]) => row(label, minus(an)))
    : [];
  return [...steuern, ...beitraege];
}

/** Zur Information: was der Arbeitgeber zusätzlich trägt; kein Teil der Auszahlung */
function arbeitgeberZeilen(d: LohnabrechnungDocument) {
  const sv = d.betraege.sv;
  const zeilen = [
    row("Krankenversicherung", formatEuro(sv.kv.ag + sv.kvZusatz.ag)),
    row("Pflegeversicherung", formatEuro(sv.pv.ag)),
    row("Rentenversicherung", formatEuro(sv.rv.ag)),
    row("Arbeitslosenversicherung", formatEuro(sv.av.ag)),
    row("Umlage U1", formatEuro(sv.umlagen.u1)),
    row("Umlage U2", formatEuro(sv.umlagen.u2)),
    row("Insolvenzgeldumlage", formatEuro(sv.umlagen.insolvenzgeld)),
    row("Pauschsteuer (§ 40a Abs. 2 EStG)", formatEuro(sv.pauschsteuer)),
  ];
  return zeilen.filter((z) => z.value !== formatEuro(0));
}

/** Druckfertige Texte für templates/lohnabrechnung.typ */
export function lohnabrechnungPdfData(d: LohnabrechnungDocument) {
  const a = d.arbeitgeber;
  const n = d.arbeitnehmer;
  const name = `${n.vorname} ${n.nachname}`;
  const zeitraum = `${MONATE[d.monat - 1]} ${d.jahr}`;
  const b = d.betraege;
  return {
    docTitle: `Entgeltabrechnung ${zeitraum} ${name}`,
    author: a.name,
    title: `Entgeltabrechnung ${zeitraum}`,
    // § 1 Abs. 4 EntgBV
    kennzeichnung: "Bescheinigung nach § 108 Absatz 3 Satz 1 der Gewerbeordnung",
    entwurf: d.entwurf ? (d.gegenpruefen ? "Entwurf – gegen ein Lohnprogramm oder die Steuerberatung gegenprüfen" : "Entwurf – nicht festgeschrieben") : null,
    senderLine: [a.name, a.strasse, `${a.plz} ${a.ort}`].join(" · "),
    recipient: [name, n.strasse, `${n.plz} ${n.ort}`].filter((s) => s.trim()),
    meta: [
      row("Personalnummer", String(n.personalnummer)),
      row("Abrechnungszeitraum", abrechnungszeitraum(d.jahr, d.monat)),
      row("Zahltag", formatDate(d.zahltag)),
      row("Datum", formatDate(d.ausgestellt)),
    ],
    person: [
      row("Arbeitgeber", `${a.name}, ${a.strasse}, ${a.plz} ${a.ort}`),
      row("Beschäftigte(r)", `${name}, ${[n.strasse, `${n.plz} ${n.ort}`.trim()].filter(Boolean).join(", ")}`),
      row("Geburtsdatum", formatDate(n.geburtsdatum)),
      row("Beschäftigung", d.beschaeftigung),
      row("Beschäftigt seit", formatDate(d.eintritt)),
      ...(d.austritt ? [row("Beschäftigungsende", formatDate(d.austritt))] : []),
      row("Steuertage, SV-Tage", `${d.steuertage}, ${d.svTage}`),
      row("Mehrfachbeschäftigung", "nein"),
    ],
    steuer: steuerZeilen(d),
    sv: svZeilen(d),
    bezuege: bezuege(d),
    brutto: [
      row("Steuerpflichtiger Arbeitslohn, laufend", formatEuro(b.steuerBrutto)),
      row("Steuerpflichtiger Arbeitslohn, sonstige Bezüge", formatEuro(0)),
      row("Sozialversicherungsbrutto, laufend", formatEuro(b.svBrutto)),
      row("Sozialversicherungsbrutto, einmalig", formatEuro(0)),
      ...(b.pauschalBrutto > 0 ? [row("Pauschal besteuerte Bezüge (§ 40a Abs. 2 EStG)", formatEuro(b.pauschalBrutto))] : []),
      row("Gesamtbrutto", formatEuro(b.brutto)),
    ],
    abzuege: abzuege(d),
    netto: row("Nettoentgelt", formatEuro(b.netto)),
    zuschuss: b.zuschuss > 0 ? row("Zuschuss zur privaten Kranken- und Pflegeversicherung", formatEuro(b.zuschuss)) : null,
    auszahlung: row("Auszahlungsbetrag", formatEuro(b.auszahlung)),
    ueberweisung: n.iban ? `Überwiesen auf IBAN ${formatIban(n.iban)}` : null,
    arbeitgeber: arbeitgeberZeilen(d),
    hinweis: "Abzüge ohne einmalige Bezüge: Haben rechnet nur laufendes Entgelt. Das Kirchensteuermerkmal darfst du schwärzen (§ 2 Abs. 2 EntgBV).",
    footer: [[a.name, a.strasse, `${a.plz} ${a.ort}`], [], []],
    legal: legalLine(d.legalInfo),
  };
}

export function buildLohnabrechnungPdf(d: LohnabrechnungDocument): Uint8Array {
  return renderLohnPdf("lohnabrechnung.typ", lohnabrechnungPdfData(d), d.ausgestellt, "Entgeltabrechnung", d);
}
