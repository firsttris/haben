import { finanzamtsnummer, type Cents, type LstbWerte } from "@haben/core";
import { splitStrasse } from "./nachricht.ts";
import { checkSteuernummer13, elsterDecimal, ElsterEingabeError, elsterXml, escapeXml } from "./xml.ts";

/*
 * Elektronische Lohnsteuerbescheinigung (§ 41b EStG) über ERiC: Verfahren ElsterLohn, Datenart LStB, Datenart-Version
 * „ElsterLohn“ (Datenartversionmatrix, Plugin checkElsterLohn). Aufbau aus lstb202501.xsd, lstb_storno_000002.xsd und den
 * Beispielen ELO_DatenLieferung_LStB_202501_Neu/_Korrektur.xml und ELO_DatenLieferung_LStBStorno_v2_2025.xml der
 * ERiC-Dokumentation (Datenarten/ElsterLohn, ERiC 43.4.6.0 bis 45.1.5.0, Schnittstelle Lohnsteuerbescheinigung 1.36).
 *
 * Nur bis zum Bescheinigungszeitraum 2025: Ab 2026 gilt die Datenart LSTMitteilung im Verfahren ElsterKMV
 * (ERiC-Entwicklerhandbuch 45.1.5.0, Kap. 9.5.1 und 9.8). Deren Schema steht nicht im ERiC-Paket, sondern nur auf
 * esteuer.de; Haben hat es nicht und sendet für 2026 deshalb nichts (siehe docs/lohn-plan.md, PR 7).
 *
 * ERiC prüft die Nutzdaten von ElsterLohn nicht (Kap. 9.5.1, „Nutzdatenschemavalidierung: Nein“); Fehler meldet erst das
 * Verarbeitungsprotokoll. Die Tests prüfen das XML deshalb zusätzlich gegen das Schema.
 */

/** Jahre mit Schnittstelle im ERiC-Paket, je Jahr die Version der Lohnsteuerbescheinigung */
export const LSTB_SCHNITTSTELLEN: Readonly<Record<number, string>> = { 2025: "202501" };

/** Testmerker für LStB: nur Validierung im Annahmeserver und Protokoll (ERiC-Entwicklerhandbuch, Tabelle der Testmerker) */
export const TESTMERKER_LSTB = "220000000";

/** Warum ein Jahr nicht über ERiC geht; null, wenn es geht */
export function lstbOhneSchnittstelle(jahr: number): string | null {
  if (LSTB_SCHNITTSTELLEN[jahr]) return null;
  if (jahr >= 2026) {
    return `Ab 2026 geht die Lohnsteuerbescheinigung als LSTMitteilung über ElsterKMV; deren Schnittstelle liegt nicht im ERiC-Paket, Haben kann sie für ${jahr} noch nicht senden.`;
  }
  return `Die Lohnsteuerbescheinigung ${jahr} sendet Haben nicht; über ERiC geht nur ${Object.keys(LSTB_SCHNITTSTELLEN).join(", ")}.`;
}

export interface LStBArbeitgeber {
  name: string;
  steuernummer13: string;
  /** Name des Betriebsstättenfinanzamts, an das die Lohnsteuer abgeführt wurde */
  finanzamt: string;
  /** Bundesland des Betriebsstättenfinanzamts, Empfänger im NutzdatenHeader */
  bundesland: string;
  strasse: string;
  plz: string;
  ort: string;
}

export interface LStBArbeitnehmer {
  idnr: string;
  /** Ordnungsmerkmal des Arbeitgebers: die Personalnummer */
  ordnungsmerkmal: string;
  vorname: string;
  nachname: string;
  geburtsdatum: string;
  strasse: string;
  plz: string;
  ort: string;
}

/** Neu oder Korrektur mit der KmId der korrigierten Mitteilung; der Grund ist Pflicht ab dem 1. März des Folgejahres */
export type LStBAnweisung = { art: "Neu"; kmId: string } | { art: "Korrektur"; kmId: string; refKmId: string; korrekturGrund?: "Einfache Berichtigung" };

interface Umschlag {
  arbeitgeber: LStBArbeitgeber;
  herstellerId: string;
  produktVersion: string;
  test: boolean;
}

export interface LStBInput extends Umschlag {
  anweisung: LStBAnweisung;
  werte: LstbWerte;
  arbeitnehmer: LStBArbeitnehmer;
}

export interface LStBStornoInput extends Umschlag {
  kmId: string;
  /** KmId der zu stornierenden Mitteilung (Neu oder Korrektur) */
  refKmId: string;
  jahr: number;
  idnr: string;
  ordnungsmerkmal: string;
}

type Knoten = string | null | undefined | false;

/** Element mit Attributen; leere Kinder fallen weg, Attribute ohne Wert ebenso */
function tag(name: string, attrs: Record<string, string | undefined>, ...kinder: Knoten[]): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeXml(v!)}"`)
    .join("");
  const inhalt = kinder.filter((k): k is string => typeof k === "string" && k !== "");
  return inhalt.length > 0 ? `<${name}${a}>${inhalt.join("")}</${name}>` : `<${name}${a}/>`;
}
const text = (name: string, value: string | undefined) => (value === undefined ? null : `<${name}>${escapeXml(value)}</${name}>`);
/** Betrag mit Punkt und zwei Nachkommastellen (lstb_WertSType); null bei 0, das Element entfällt dann */
const wert = (name: string, cents: Cents) => (cents === 0 ? null : text(name, elsterDecimal(cents).replace(",", ".")));
const ttmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;

/** Längen laut allg000008.xsd; zu Langes wird abgelehnt statt abgeschnitten */
function pruefeLaenge(feld: string, value: string, max: number): string {
  const v = value.trim();
  if (!v || v.length > max) throw new ElsterEingabeError(`${feld} braucht 1 bis ${max} Zeichen: „${value}“.`);
  return v;
}

function adresse(feld: string, strasse: string, plz: string, ort: string): string {
  if (!/^\d{5}$/.test(plz)) throw new ElsterEingabeError(`${feld}: Die Postleitzahl muss fünfstellig sein (nur Inland).`);
  const s = splitStrasse(strasse);
  return [
    text("Str", s ? pruefeLaenge(`${feld}: Straße`, s.strasse, 33) : strasse.trim() ? pruefeLaenge(`${feld}: Straße`, strasse, 33) : undefined),
    text("Hausnummer", s?.hausnummer),
    text("HNrZusatz", s?.zusatz),
    text("Ort", pruefeLaenge(`${feld}: Ort`, ort, 34)),
    text("PLZ", plz),
  ]
    .filter(Boolean)
    .join("");
}

function pruefeIdnr(idnr: string) {
  if (!/^\d{11}$/.test(idnr)) throw new ElsterEingabeError(`Die Steuer-ID des Arbeitnehmers muss 11 Ziffern haben: ${idnr || "fehlt"}.`);
}

function pruefeOrdnungsmerkmal(om: string) {
  if (!/^[\p{L}\p{P}\p{Nd}]{1,32}$/u.test(om)) throw new ElsterEingabeError(`Ungültiges Ordnungsmerkmal: ${om}`);
}

function umschlag(u: Umschlag, nutzdaten: string): string {
  checkSteuernummer13(u.arbeitgeber.steuernummer13);
  const a = u.arbeitgeber;
  return elsterXml(
    {
      verfahren: "ElsterLohn",
      datenArt: "LStB",
      testmerker: u.test ? TESTMERKER_LSTB : undefined,
      // Ziel ist die Clearingstelle, Empfänger im NutzdatenHeader das Land (Kap. 9.5.1)
      ziel: "CS",
      herstellerId: u.herstellerId,
      datenlieferant: `${a.name}; ${a.strasse}; ${a.plz}; ${a.ort}`,
    },
    [{ ticket: "1", empfaenger: { id: "L", wert: a.bundesland }, produktVersion: u.produktVersion, nutzdaten: [nutzdaten] }],
  );
}

const kinder = (tausendstel: number) => (tausendstel / 1000).toFixed(1);
const faktor = (tausendstel: number) => (tausendstel / 1000).toFixed(3);

export function buildLStBXml(input: LStBInput): string {
  const { werte: w, arbeitnehmer: n, arbeitgeber: a, anweisung } = input;
  const version = LSTB_SCHNITTSTELLEN[w.jahr];
  if (!version) throw new ElsterEingabeError(lstbOhneSchnittstelle(w.jahr)!);
  checkSteuernummer13(a.steuernummer13);
  pruefeIdnr(n.idnr);
  pruefeOrdnungsmerkmal(n.ordnungsmerkmal);
  if (w.merkmale.length === 0 || w.merkmale.length > 24) throw new ElsterEingabeError("Die Bescheinigung braucht 1 bis 24 Stände der Besteuerungsmerkmale.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.geburtsdatum)) throw new ElsterEingabeError("Das Geburtsdatum des Arbeitnehmers fehlt.");

  const nutzdaten = tag(
    "Lohnsteuerbescheinigung",
    { xmlns: `http://finkonsens.de/rms/elo/lstb/v${version}`, version, art: "ELStAM" },
    tag(
      "Anweisung",
      { art: anweisung.art },
      text("KmId", anweisung.kmId),
      anweisung.art === "Korrektur" && text("RefKmId", anweisung.refKmId),
      anweisung.art === "Korrektur" && text("KorrekturGrund", anweisung.korrekturGrund),
    ),
    tag("Dauer", { jahr: String(w.jahr) }, text("Anfang", ttmm(w.von)), text("Ende", ttmm(w.bis))),
    tag(
      "Allgemein",
      {},
      text("IdNr", n.idnr),
      text("Ordnungsmerkmal", n.ordnungsmerkmal),
      tag(
        "Person",
        {},
        tag("Familienname", {}, text("Name", pruefeLaenge("Familienname", n.nachname, 35)), text("Vorname", pruefeLaenge("Vorname", n.vorname, 35))),
        text("Geburtsdatum", n.geburtsdatum.replaceAll("-", "")),
        tag("Adresse", {}, adresse("Anschrift des Arbeitnehmers", n.strasse, n.plz, n.ort)),
      ),
    ),
    tag(
      "Besteuerungsmerkmale",
      {},
      ...w.merkmale.map((m) =>
        tag(
          "ELStAM",
          { gueltig_ab: m.gueltigAb },
          tag("Steuerklasse", { faktor: m.faktor !== 1000 ? faktor(m.faktor) : undefined }, String(m.steuerklasse)),
          m.kinderfreibetraege > 0 && text("Kinder", kinder(m.kinderfreibetraege)),
          m.konfession && tag("Kirchensteuerabzug", { konfession: m.konfession }),
        ),
      ),
    ),
    tag(
      "Besteuerungsgrundlagen",
      {},
      // Zeilen 3 bis 5 sind Pflicht, auch mit 0
      text("BruttoArbLohn", elsterDecimal(w.bruttoarbeitslohn).replace(",", ".")),
      text("LSteuer", elsterDecimal(w.lohnsteuer).replace(",", ".")),
      text("Soli", elsterDecimal(w.soli).replace(",", ".")),
      wert("ArbnKiSteuer", w.kirchensteuer),
      wert("ArbgAnteilRenVers", w.rvArbeitgeber),
      wert("ArbnAnteilRenVers", w.rvArbeitnehmer),
      wert("ArbnAnteilKrankVers", w.kvArbeitnehmer),
      wert("ArbnAnteilPflegVers", w.pvArbeitnehmer),
      wert("ArbnAnteilArblVers", w.avArbeitnehmer),
      // Zeile 28 bis 2025: Beiträge zur privaten Kranken- und Pflege-Pflichtversicherung, die beim Lohnsteuerabzug berücksichtigt sind
      w.pkvBasis && wert("BeitrPrKrankVers", w.pkvBasis.jahr),
      tag(
        "Arbeitgeber",
        {},
        text("ArbGName", pruefeLaenge("Name des Arbeitgebers", a.name, 60)),
        text("ArbGFANr", finanzamtsnummer(a.steuernummer13)),
        text("ArbGFAName", pruefeLaenge("Name des Finanzamts", a.finanzamt, 100)),
        text("ArbGStNr", a.steuernummer13),
        tag("Adresse", {}, adresse("Anschrift des Arbeitgebers", a.strasse, a.plz, a.ort)),
      ),
    ),
  );
  return umschlag(input, nutzdaten);
}

/** Stornierung einer übermittelten Bescheinigung (LStBStorno Version 2, ab Zuflussjahr 2016) */
export function buildLStBStornoXml(input: LStBStornoInput): string {
  if (!LSTB_SCHNITTSTELLEN[input.jahr]) throw new ElsterEingabeError(lstbOhneSchnittstelle(input.jahr)!);
  checkSteuernummer13(input.arbeitgeber.steuernummer13);
  pruefeIdnr(input.idnr);
  pruefeOrdnungsmerkmal(input.ordnungsmerkmal);
  const nutzdaten = tag(
    "LStBStorno",
    { xmlns: "http://finkonsens.de/rms/elo/lstbstorno/v2", version: "2" },
    tag("Anweisung", { art: "Storno" }, text("KmId", input.kmId), text("RefKmId", input.refKmId)),
    text("Zuflussjahr", String(input.jahr)),
    tag("Allgemein", {}, text("IdNr", input.idnr), text("Ordnungsmerkmal", input.ordnungsmerkmal)),
    tag(
      "Arbeitgeber",
      {},
      text("ArbGName", pruefeLaenge("Name des Arbeitgebers", input.arbeitgeber.name, 60)),
      text("ArbGStNr", input.arbeitgeber.steuernummer13),
    ),
  );
  return umschlag(input, nutzdaten);
}
