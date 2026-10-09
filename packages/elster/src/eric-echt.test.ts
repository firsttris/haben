import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBankverbindungXml, isValidIdnr } from "./bankverbindung.ts";
import { buildEuerXml, buildUstErklaerungXml, type AveuerAnlage, type EuerFigures } from "./erklaerung.ts";
import { buildEstXml, type EstAngaben, type EstArbeitnehmer, type EstXmlInput } from "./est.ts";
import { checkFormats, ericMeldungen } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { buildNachrichtXml } from "./nachricht.ts";
import { EricProcessClient } from "./process-client.ts";
import { computeUstva } from "@haben/core";
import { buildUstvaXml, type UstvaXmlInput } from "./xml.ts";

/**
 * Prüft alle Nachrichten von Haben mit dem echten ERiC: Schema und Plausibilität, lokal (ERIC_VALIDIERE),
 * es wird nichts gesendet. Jedes Eingabefeld kommt in mindestens einem Fall vor. Läuft nur mit ERiC
 * (ERIC_HOME oder ERIC_DIR), sonst übersprungen:
 *   ERIC_DIR=data/eric pnpm vitest run packages/elster/src/eric-echt.test.ts
 * ERiC lehnt die frühere Test-Hersteller-ID 74931 ab; ohne ELSTER_HERSTELLER_ID prüft der Test lokal mit
 * einer Platzhalter-ID.
 */
const ericHome = process.env.ERIC_HOME?.trim() || ericHomeIn(resolve(process.env.ERIC_DIR || "data/eric"));
const herstellerId = process.env.ELSTER_HERSTELLER_ID || "12345";

/** Gültige IdNr aus zehn Ziffern: die passende Prüfziffer suchen */
function idnr(first10: string): string {
  const found = [..."0123456789"].map((d) => first10 + d).find(isValidIdnr);
  if (!found) throw new Error(`Keine gültige IdNr zu ${first10}`);
  return found;
}
const idA = idnr("8609574271");
const idB = idnr("6592997048");
const idKind1 = idnr("5728640371");
const idKind2 = idnr("4113750816");

const stnr = "2893081508152";
const absender = { name: "Tris Software", strasse: "Hauptstraße 12a", plz: "70173", ort: "Stuttgart" };
const envelope = (year: number) => ({ year, steuernummer13: stnr, bundesland: "BW", absender, herstellerId, produktVersion: "0.1.0", test: true });

// ---------------------------------------------------------------------------
// Umsatzsteuer-Voranmeldung

/** Kz83 rechnet Haben selbst; ERiC prüft die Summe nicht nach */
const ustva = (year: number, figures: Omit<UstvaXmlInput["figures"], "kz83">, extra: Partial<UstvaXmlInput> = {}) => () =>
  buildUstvaXml({
    period: { year, month: 3 },
    steuernummer13: "9198011310010",
    figures: { ...figures, kz83: computeUstva(figures).kz83 },
    datenlieferant: { name: "Erika Mustermann", strasse: "Hauptstr. 1", plz: "10115", ort: "Berlin" },
    herstellerId,
    produktVersion: "0.1.0",
    test: true,
    ...extra,
  });
/** Alle Kennzahlen, die Haben kennt, mit stimmigen Steuerbeträgen */
const alleKennzahlen: Omit<UstvaXmlInput["figures"], "kz83"> = {
  kz81: 1_000_000,
  kz66: 30_000,
  kz86: 100_000,
  kz21: 200_000,
  kz45: 50_000,
  kz48: 40_000,
  kz46: 300_000,
  kz47: 57_000,
  kz84: 100_000,
  kz85: 19_000,
  kz67: 76_000,
};

// ---------------------------------------------------------------------------
// Anlage EÜR mit AVEÜR

const allgemein = { artDesBetriebs: "Softwareentwicklung", einkunftsart: "selbstaendig" as const };
const anlagen = (year: number): AveuerAnlage[] => [
  { gruppe: "kfz", bezeichnung: "Tesla Model 3", anschaffung: `${year - 1}-03-15`, anschaffungskosten: 4_000_000, buchwertBeginn: 3_444_444, afa: 666_667, abgang: 0, buchwertEnde: 2_777_777, elektro: true },
  { gruppe: "kfz", bezeichnung: "VW Caddy", anschaffung: `${year - 2}-05-01`, anschaffungskosten: 2_400_000, buchwertBeginn: 1_600_000, afa: 400_000, abgang: 0, buchwertEnde: 1_200_000, elektro: false },
  { gruppe: "buero", bezeichnung: "Schreibtisch", anschaffung: `${year}-01-10`, anschaffungskosten: 120_000, buchwertBeginn: 120_000, afa: 9_000, abgang: 0, buchwertEnde: 111_000 },
  { gruppe: "andere", bezeichnung: "MacBook Pro", anschaffung: `${year}-02-01`, anschaffungskosten: 233_333, buchwertBeginn: 233_333, afa: 233_333, abgang: 0, buchwertEnde: 0 },
  { gruppe: "andere", bezeichnung: "Kamera (verkauft)", anschaffung: `${year - 2}-04-01`, anschaffungskosten: 150_000, buchwertBeginn: 90_000, afa: 10_000, abgang: 80_000, buchwertEnde: 0 },
  { gruppe: "sammelposten", bezeichnung: `Sammelposten ${year}`, anschaffung: `${year}-06-01`, anschaffungskosten: 90_000, buchwertBeginn: 90_000, afa: 18_000, abgang: 0, buchwertEnde: 72_000 },
  { gruppe: "sammelposten", bezeichnung: `Sammelposten ${year - 1}`, anschaffung: `${year - 1}-06-01`, anschaffungskosten: 50_000, buchwertBeginn: 40_000, afa: 10_000, abgang: 0, buchwertEnde: 30_000 },
  { gruppe: "sammelposten", bezeichnung: `Sammelposten ${year - 2}`, anschaffung: `${year - 2}-06-01`, anschaffungskosten: 50_000, buchwertBeginn: 30_000, afa: 10_000, abgang: 0, buchwertEnde: 20_000 },
];
/** Alle Felder der EÜR, die Haben füllt; AfA, Sammelposten und Restbuchwert passend zu den Anlagen oben */
const alleEuerFelder: EuerFigures = {
  steuerpflichtig: 8_000_000,
  steuerfrei: 1_000_000,
  vereinnahmteUst: 1_577_000,
  erstatteteUst: 20_000,
  anlagenabgang: 100_000,
  privateKfz: 300_000,
  fremdleistungen: 500_000,
  afaBeweglich: 666_667 + 400_000 + 9_000 + 233_333 + 10_000,
  gwg: 50_000,
  sammelposten: 38_000,
  restbuchwert: 80_000,
  telekommunikation: 40_000,
  reisekosten: 30_000,
  fortbildung: 60_000,
  beratung: 120_000,
  beitraegeVersicherungen: 45_000,
  edv: 60_000,
  arbeitsmittel: 25_000,
  werbung: 35_000,
  vorsteuer: 200_000,
  gezahlteUst: 1_200_000,
  uebrige: 15_000,
  verpflegung: 4_200,
  tagespauschale: 126_000,
  kfzLeasing: 240_000,
  kfzSteuerVersicherung: 70_000,
  kfzSonstige: 80_000,
  fahrtNutzungseinlage: 37_200,
  entnahmen: 2_400_000,
  // Fahrten mit dem Privatwagen sind eine Nutzungseinlage und stecken in den Einlagen
  einlagen: 50_000,
};

// ---------------------------------------------------------------------------
// Einkommensteuer

const personA = { idnr: idA, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "IT-Berater" };
const personB = { idnr: idB, vorname: "Erika", name: "Muster-Schmidt", geburtsdatum: "1987-09-01", religion: "02", beruf: "Ärztin" };
const arbeitnehmer = (steuerklasse: 1 | 3 | 4): EstArbeitnehmer => ({
  bescheinigungen: [
    { steuerklasse, brutto: 4_200_050, lohnsteuer: 612_340, soli: 0, kirchensteuer: 48_987, rvArbeitgeber: 390_605, rvArbeitnehmer: 390_605, kvArbeitnehmer: 341_204, pvArbeitnehmer: 75_601, avArbeitnehmer: 54_601 },
    { steuerklasse: 6, brutto: 600_000, lohnsteuer: 80_000 },
  ],
  werbungskosten: {
    wege: { tage: 180, km: 23.6, adresse: "77815 Bühl, Industriestraße 4", arbeitstageJeWoche: 5, urlaubstage: 30 },
    homeofficeTage: 40,
    arbeitsmittel: 34_900,
    fortbildung: 45_000,
    berufsverbaende: 12_000,
    sonstige: 1_600,
  },
});
/** Alle Angaben, die Haben kennt */
const alleAngaben = (year: number): EstAngaben => ({
  vorsorge: {
    a: { rentenversicherung: 300_000, pkv: 600_000, ppv: 40_049, pkvErstattung: 50_000 },
    b: { gkv: 300_000, gpv: 60_000, gkvZusatz: 20_000 },
    sonstige: 25_000,
  },
  sonderausgaben: { kirchensteuerGezahlt: 12_000, kirchensteuerErstattet: 3_000, spenden: 10_000 },
  krankheitskosten: 150_000,
  haushaltsnah: { minijobs: 60_000, dienstleistungen: 90_000, handwerker: 80_000 },
  kinder: [
    { idnr: idKind1, vorname: "Lena", geburtsdatum: `${year}-03-05`, familienkasse: "Familienkasse BW", kinderbetreuung: 200_000 },
    { idnr: idKind2, vorname: "Tom", name: "Schmidt", geburtsdatum: "2018-07-14", familienkasse: "Familienkasse BW" },
  ],
  kap: { ertraegeMitSteuerabzug: 120_000, sparerPauschbetrag: 100_000, ertraegeOhneSteuerabzugInland: 30_000, ertraegeAusland: 20_000, kapitalertragsteuer: 5_000, soli: 275, kirchensteuer: 400 },
  arbeitnehmer: { b: arbeitnehmer(4) },
});
const leereAngaben: EstAngaben = { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] };
const est = (year: number, overrides: Partial<EstXmlInput> = {}) => (): string =>
  buildEstXml({
    ...envelope(year),
    personA,
    personB,
    verheiratetSeit: "2015-06-20",
    anschrift: { strasse: "Hauptstraße 12a", plz: "77815", ort: "Bühl" },
    telefon: "07223 12345",
    iban: "DE89 3704 0044 0532 0130 00",
    gewinn: { einkunftsart: "selbstaendig", taetigkeit: "IT-Beratung", betrag: 8_543_250 },
    angaben: alleAngaben(year),
    ...overrides,
  });

const jahre = [2023, 2024, 2025];
const faelle: [string, () => string][] = [
  // Voranmeldung
  ["UStVA 2026 einfach", ustva(2026, { kz81: 100_000, kz86: 50_000, kz66: 1_745 })],
  ["UStVA 2025 einfach", ustva(2025, { kz81: 100_000, kz86: 50_000, kz66: 1_745 })],
  ["UStVA 2026 alle Kennzahlen", ustva(2026, alleKennzahlen)],
  ["UStVA 2025 alle Kennzahlen", ustva(2025, alleKennzahlen)],
  ["UStVA § 13b als Leistungsempfänger", ustva(2026, { kz81: 0, kz86: 0, kz66: 0, kz46: 12_345, kz47: 2_345, kz84: 5_000, kz85: 950, kz67: 3_295 })],
  ["UStVA Erstattung", ustva(2026, { kz81: 0, kz86: 0, kz66: 1_200 })],
  ["UStVA Nullmeldung", ustva(2026, { kz81: 0, kz86: 0, kz66: 0 })],
  ["UStVA berichtigt", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 1_745 }, { berichtigt: true })],
  ["UStVA Dezember", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0 }, { period: { year: 2026, month: 12 } })],
  ["UStVA echt (ohne Testmerker)", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0 }, { test: false })],
  ["UStVA langer Name, Sonderzeichen", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0 }, { datenlieferant: { name: `Müller & Söhne <"Softwareentwicklung und Beratung"> GmbH`, strasse: "Weg 'A' 1 mit sehr langem Straßennamen", plz: "10115", ort: "Frankfurt am Main-Sachsenhausen Süd" } })],
  // Umsatzsteuererklärung
  ...jahre.flatMap((year): [string, () => string][] => [
    [`USt-Erklärung ${year} Ist`, () => buildUstErklaerungXml({ ...envelope(year), versteuerung: "ist", figures: { base19: 10_000_049, tax19: 1_900_009, base7: 50_000, tax7: 3_500, vorsteuer: 120_000, vorauszahlungen: 1_700_000 } })],
    [`USt-Erklärung ${year} Soll mit Erstattung`, () => buildUstErklaerungXml({ ...envelope(year), versteuerung: "soll", figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 50_000, vorauszahlungen: -40_000 } })],
    [`USt-Erklärung ${year} nur 7 %`, () => buildUstErklaerungXml({ ...envelope(year), versteuerung: "ist", figures: { base19: 0, tax19: 0, base7: 1_000_000, tax7: 70_000, vorsteuer: 0, vorauszahlungen: 70_000 } })],
  ]),
  // Anlage EÜR
  ...jahre.flatMap((year): [string, () => string][] => [
    [`Anlage EÜR ${year} alle Felder und Anlagen`, () => buildEuerXml({ ...envelope(year), allgemein, figures: alleEuerFelder, anlagen: anlagen(year) })],
    [`Anlage EÜR ${year} Gewerbe`, () => buildEuerXml({ ...envelope(year), allgemein: { artDesBetriebs: "Handel", einkunftsart: "gewerbe" }, figures: { steuerpflichtig: 1_000_000, vereinnahmteUst: 190_000, uebrige: 50_000 }, anlagen: [] })],
    [`Anlage EÜR ${year} Kleinunternehmer`, () => buildEuerXml({ ...envelope(year), allgemein, figures: { kleinunternehmer: 2_000_000, edv: 50_000 }, anlagen: [] })],
    [`Anlage EÜR ${year} Verlust`, () => buildEuerXml({ ...envelope(year), allgemein, figures: { steuerpflichtig: 100_000, vereinnahmteUst: 19_000, fremdleistungen: 500_000, entnahmen: 0, einlagen: 400_000 }, anlagen: [] })],
  ]),
  // Einkommensteuer
  ...jahre.flatMap((year): [string, () => string][] => [
    [`ESt ${year} Zusammenveranlagung, alle Angaben`, est(year)],
    [`ESt ${year} Einzelveranlagung`, est(year, { personB: undefined, verheiratetSeit: undefined, angaben: { ...alleAngaben(year), vorsorge: { a: alleAngaben(year).vorsorge.a, sonstige: 25_000 }, kinder: [], arbeitnehmer: { a: arbeitnehmer(1) } } })],
    [`ESt ${year} Gewerbe mit Verlust`, est(year, { gewinn: { einkunftsart: "gewerbe", taetigkeit: "Handel", betrag: -100_050 } })],
    [`ESt ${year} Gewerbe mit Gewinn`, est(year, { gewinn: { einkunftsart: "gewerbe", taetigkeit: "Handel", betrag: 4_000_000 } })],
  ]),
  ["ESt 2025 Anlage N für beide", est(2025, { angaben: { ...alleAngaben(2025), arbeitnehmer: { a: arbeitnehmer(3), b: arbeitnehmer(4) } } })],
  ["ESt 2025 Homeoffice ohne anderen Arbeitsplatz", est(2025, { angaben: { ...alleAngaben(2025), arbeitnehmer: { b: { ...arbeitnehmer(4), werbungskosten: { homeofficeTage: 210, keinAndererArbeitsplatz: true } } } } })],
  ["ESt 2025 Günstigerprüfung", est(2025, { angaben: { ...leereAngaben, kap: { guenstigerpruefung: true, ertraegeMitSteuerabzug: 120_000, sparerPauschbetrag: 100_000, kapitalertragsteuer: 5_000, soli: 275 } } })],
  ["ESt 2025 nur Kapitalerträge ohne Steuerabzug", est(2025, { angaben: { ...leereAngaben, kap: { ertraegeOhneSteuerabzugInland: 30_000, ertraegeAusland: 20_000 } } })],
  ["ESt 2025 ohne weitere Angaben", est(2025, { angaben: leereAngaben, telefon: undefined })],
  // Nachrichten an das Finanzamt
  ["Sonstige Nachricht", () => buildNachrichtXml({ steuernummer13: stnr, bundesland: "BW", absender, betreff: "Antrag auf Herabsetzung der Vorauszahlungen", text: "Sehr geehrte Damen und Herren,\n<bitte> herabsetzen.", herstellerId, produktVersion: "0.1.0", test: true })],
  ["Sonstige Nachricht als natürliche Person", () => buildNachrichtXml({ steuernummer13: stnr, bundesland: "BW", absender, person: { idnr: idA, vorname: "Max", name: "Muster" }, betreff: "Test", text: "Hallo", herstellerId, produktVersion: "0.1.0", test: true })],
  ["Sonstige Nachricht, Hausnummer mit Bereich", () => buildNachrichtXml({ steuernummer13: stnr, bundesland: "BW", absender: { ...absender, strasse: "Am Ring 12-14" }, betreff: "Test", text: "x".repeat(1000), herstellerId, produktVersion: "0.1.0", test: true })],
  ["Änderung der Bankverbindung", () => buildBankverbindungXml({ steuernummer13: stnr, bundesland: "BW", person: { idnr: idA, anrede: "Herrn", vorname: "Max", name: "Muster & Sohn", geburtsdatum: "1980-03-15" }, iban: "DE89 3704 0044 0532 0130 00", herstellerId, produktVersion: "0.1.0", test: true })],
  ["Änderung der Bankverbindung, Frau", () => buildBankverbindungXml({ steuernummer13: stnr, bundesland: "BW", person: { idnr: idB, anrede: "Frau", vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01" }, iban: "DE02120300000000202051", herstellerId, produktVersion: "0.1.0", test: true })],
];

describe.skipIf(!ericHome)("Echtes ERiC: Nachrichten lokal prüfen", () => {
  const client = new EricProcessClient({ ericHome: ericHome! });

  it.each(faelle)("%s", async (_name, build) => {
    const result = await client.validate(build());
    expect(result.ok, `${result.code} ${result.message}\n${ericMeldungen(result.responseXml).join("\n")}`).toBe(true);
  }, 60_000);

  it.each([2024, 2025])("Belegabruf, Abrufberechtigung und Postfach (%i)", async (veranlagungsjahr) => {
    const results = await checkFormats(client, {
      idnr: idA,
      geburtsdatum: "1985-04-12",
      datenlieferant: "Haben Formatprüfung",
      herstellerId,
      veranlagungsjahr,
      produktVersion: "0.1.0",
    });
    expect(results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.code} ${r.message}`)).toEqual([]);
  }, 120_000);
});
