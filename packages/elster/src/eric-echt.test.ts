import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBankverbindungXml, isValidIdnr } from "./bankverbindung.ts";
import { buildEuerXml, buildUstErklaerungXml, type AveuerAnlage, type EuerFigures } from "./erklaerung.ts";
import { buildEstXml, type EstAngaben, type EstArbeitnehmer, type EstXmlInput } from "./est.ts";
import { checkFormats, ericMeldungen } from "./formatprobe.ts";
import { ericHomeIn } from "./install.ts";
import { buildNachrichtXml } from "./nachricht.ts";
import { EricProcessClient } from "./process-client.ts";
import { parseWorkerCommand } from "./factory.ts";
import { ericTestTimeout } from "../test-fixtures/eric-zeit.ts";
import { computeUstva } from "@haben/core";
import { buildUstvaXml, datenartVersionFromXml, type UstvaXmlInput } from "./xml.ts";
import { hatJahresPlugin } from "./eric-plugins.ts";
import { buildDauerfristXml } from "./dauerfrist.ts";
import { buildZmXml, type ZmXmlInput } from "./zm.ts";

/**
 * Prüft alle Nachrichten von Haben mit dem echten ERiC: Schema und Plausibilität, lokal (ERIC_VALIDIERE),
 * es wird nichts gesendet. Jedes Eingabefeld kommt in mindestens einem Fall vor. Läuft nur mit ERiC
 * (ERIC_HOME oder ERIC_DIR), sonst übersprungen:
 *   ERIC_DIR=data/eric bun --bun vitest run packages/elster/src/eric-echt.test.ts
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
const ustva =
  (year: number, figures: Omit<UstvaXmlInput["figures"], "kz83">, extra: Partial<UstvaXmlInput> = {}) =>
  () =>
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
const dauerfrist = (year: number) => ({
  year,
  steuernummer13: "9198011310010",
  datenlieferant: { name: "Erika Mustermann", strasse: "Hauptstr. 1", plz: "10115", ort: "Berlin" },
  herstellerId,
  produktVersion: "0.1.0",
  test: true,
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
  kz41: 250_000,
  kz43: 80_000,
  kz89: 60_000,
  kz93: 20_000,
  kz61: 12_800,
  // Entstandene Einfuhrumsatzsteuer (Bescheid des Zolls)
  kz62: 38_000,
};

// ---------------------------------------------------------------------------
// Anlage EÜR mit AVEÜR

const allgemein = { artDesBetriebs: "Softwareentwicklung", einkunftsart: "selbstaendig" as const };
const anlagen = (year: number): AveuerAnlage[] => [
  {
    gruppe: "kfz",
    bezeichnung: "Tesla Model 3",
    anschaffung: `${year - 1}-03-15`,
    anschaffungskosten: 4_000_000,
    buchwertBeginn: 3_444_444,
    afa: 666_667,
    abgang: 0,
    buchwertEnde: 2_777_777,
    elektro: true,
  },
  {
    gruppe: "kfz",
    bezeichnung: "VW Caddy",
    anschaffung: `${year - 2}-05-01`,
    anschaffungskosten: 2_400_000,
    buchwertBeginn: 1_600_000,
    afa: 400_000,
    abgang: 0,
    buchwertEnde: 1_200_000,
    elektro: false,
  },
  {
    gruppe: "buero",
    bezeichnung: "Schreibtisch",
    anschaffung: `${year}-01-10`,
    anschaffungskosten: 120_000,
    buchwertBeginn: 120_000,
    afa: 9_000,
    abgang: 0,
    buchwertEnde: 111_000,
  },
  {
    gruppe: "andere",
    bezeichnung: "MacBook Pro",
    anschaffung: `${year}-02-01`,
    anschaffungskosten: 233_333,
    buchwertBeginn: 233_333,
    afa: 233_333,
    abgang: 0,
    buchwertEnde: 0,
  },
  {
    gruppe: "andere",
    bezeichnung: "Kamera (verkauft)",
    anschaffung: `${year - 2}-04-01`,
    anschaffungskosten: 150_000,
    buchwertBeginn: 90_000,
    afa: 10_000,
    abgang: 80_000,
    buchwertEnde: 0,
  },
  {
    gruppe: "sammelposten",
    bezeichnung: `Sammelposten ${year}`,
    anschaffung: `${year}-06-01`,
    anschaffungskosten: 90_000,
    buchwertBeginn: 90_000,
    afa: 18_000,
    abgang: 0,
    buchwertEnde: 72_000,
  },
  {
    gruppe: "sammelposten",
    bezeichnung: `Sammelposten ${year - 1}`,
    anschaffung: `${year - 1}-06-01`,
    anschaffungskosten: 50_000,
    buchwertBeginn: 40_000,
    afa: 10_000,
    abgang: 0,
    buchwertEnde: 30_000,
  },
  {
    gruppe: "sammelposten",
    bezeichnung: `Sammelposten ${year - 2}`,
    anschaffung: `${year - 2}-06-01`,
    anschaffungskosten: 50_000,
    buchwertBeginn: 30_000,
    afa: 10_000,
    abgang: 0,
    buchwertEnde: 20_000,
  },
];
/** Alle Felder der EÜR, die Haben füllt; AfA, Sammelposten und Restbuchwert passend zu den Anlagen oben */
const alleEuerFelder: EuerFigures = {
  // Zeilen 39 und 48 (#312)
  miete: 1_200_000,
  erhaltung: 30_000,
  steuerpflichtig: 8_000_000,
  steuerfrei: 1_000_000,
  vereinnahmteUst: 1_577_000,
  erstatteteUst: 20_000,
  anlagenabgang: 100_000,
  privateKfz: 300_000,
  sachentnahmen: 25_000,
  waren: 250_000,
  fremdleistungen: 500_000,
  personal: 1_200_000,
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
  // Schuldzinsen aus Darlehen: zur Finanzierung von Anlagevermögen und übrige
  schuldzinsenAnlage: 48_000,
  schuldzinsen: 24_000,
  vorsteuer: 200_000,
  gezahlteUst: 1_200_000,
  uebrige: 15_000,
  geschenke: 12_000,
  bewirtung: 21_000,
  bewirtungNichtAbziehbar: 9_000,
  // Gewerbesteuer samt Nebenleistungen, Spalte „nicht abziehbar“ (§ 4 Abs. 5b EStG)
  gewerbesteuerNichtAbziehbar: 154_300,
  verpflegung: 4_200,
  tagespauschale: 126_000,
  kfzLeasing: 240_000,
  kfzSteuerVersicherung: 70_000,
  kfzSonstige: 80_000,
  fahrtNutzungseinlage: 37_200,
  // Zeile 73 (#895): Pfad und Reihenfolge von E6003702 prüft hier ERiC gegen das Schema E77
  entfernungspauschale: 6_840,
  entnahmen: 2_400_000,
  // Fahrten mit dem Privatwagen und die Wege zur Betriebsstätte sind Einlagen
  einlagen: 56_840,
};

// ---------------------------------------------------------------------------
// Einkommensteuer

const personA = { idnr: idA, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", religion: "11", beruf: "IT-Berater" };
const personB = { idnr: idB, vorname: "Erika", name: "Muster-Schmidt", geburtsdatum: "1987-09-01", religion: "02", beruf: "Ärztin" };
const arbeitnehmer = (steuerklasse: 1 | 3 | 4): EstArbeitnehmer => ({
  bescheinigungen: [
    {
      steuerklasse,
      brutto: 4_200_050,
      lohnsteuer: 612_340,
      soli: 0,
      kirchensteuer: 48_987,
      rvArbeitgeber: 390_605,
      rvArbeitnehmer: 390_605,
      kvArbeitnehmer: 341_204,
      pvArbeitnehmer: 75_601,
      avArbeitnehmer: 54_601,
    },
    { steuerklasse: 6, brutto: 600_000, lohnsteuer: 80_000 },
  ],
  werbungskosten: {
    wege: { tage: 180, km: 23.6, adresse: "77815 Bühl, Industriestraße 4", arbeitstageJeWoche: 5, urlaubstage: 30 },
    homeofficeTage: 40,
    arbeitsmittel: 34_900,
    fortbildung: 45_000,
    berufsverbaende: 12_000,
    gewerkschaft: 24_000,
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
  kap: {
    ertraegeMitSteuerabzug: 120_000,
    sparerPauschbetrag: 100_000,
    ertraegeOhneSteuerabzugInland: 30_000,
    ertraegeAusland: 20_000,
    kapitalertragsteuer: 5_000,
    soli: 275,
    kirchensteuer: 400,
  },
  arbeitnehmer: { b: arbeitnehmer(4) },
});
const leereAngaben: EstAngaben = { vorsorge: { a: {} }, sonderausgaben: {}, haushaltsnah: {}, kinder: [] };
const est =
  (year: number, overrides: Partial<EstXmlInput> = {}) =>
  (): string =>
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

// 2026: EUER_2026 und ESt_2026 ab ERiC 45; USt_2026 schon in ERiC 43
const jahre = [2023, 2024, 2025, 2026];
// ---------------------------------------------------------------------------
// Zusammenfassende Meldung an das BZSt (Datenart ZMDO). ERiC weist Meldezeiträume in der Zukunft ab, deshalb das Vorjahr.

const zmJahr = new Date().getFullYear() - 1;
const zm =
  (extra: Partial<ZmXmlInput> = {}) =>
  () =>
    buildZmXml({
      period: { year: zmJahr, month: 43 },
      ustId: "DE136695976",
      anschrift: absender,
      zeilen: [
        { ustId: "ATU12345678", art: "S", betrag: 1_250_099 },
        { ustId: "FR12345678901", art: "S", betrag: -30_000 },
        { ustId: "NL123456789B01", art: "S", betrag: 99_999_999_999_00 },
      ],
      berichtigt: false,
      herstellerId,
      produktVersion: "0.1.0",
      test: true,
      ...extra,
    });

const faelle: [string, () => string][] = [
  // Voranmeldung
  ["UStVA 2027 einfach (ERiC 45)", ustva(2027, { kz81: 100_000, kz86: 50_000, kz66: 1_745 })],
  ["UStVA 2027 alle Kennzahlen", ustva(2027, alleKennzahlen)],
  ["UStVA 2026 einfach", ustva(2026, { kz81: 100_000, kz86: 50_000, kz66: 1_745 })],
  ["UStVA 2025 einfach", ustva(2025, { kz81: 100_000, kz86: 50_000, kz66: 1_745 })],
  ["UStVA 2026 alle Kennzahlen", ustva(2026, alleKennzahlen)],
  ["UStVA 2025 alle Kennzahlen", ustva(2025, alleKennzahlen)],
  ["UStVA § 13b als Leistungsempfänger", ustva(2026, { kz81: 0, kz86: 0, kz66: 0, kz46: 12_345, kz47: 2_345, kz84: 5_000, kz85: 950, kz67: 3_295 })],
  [
    "UStVA innergemeinschaftliche Lieferung, Ausfuhr und Erwerb",
    ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0, kz41: 300_000, kz43: 120_000, kz89: 50_000, kz93: 10_000, kz61: 10_200 }),
  ],
  ["UStVA Erstattung", ustva(2026, { kz81: 0, kz86: 0, kz66: 1_200 })],
  ["UStVA Einfuhrumsatzsteuer", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 1_900, kz62: 38_000 })],
  ["UStVA Nullmeldung", ustva(2026, { kz81: 0, kz86: 0, kz66: 0 })],
  ["UStVA berichtigt", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 1_745 }, { berichtigt: true })],
  ["UStVA Dezember", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0 }, { period: { year: 2026, month: 12 } })],
  ["UStVA 1. Quartal (Zeitraum 41)", ustva(2026, { kz81: 300_000, kz86: 0, kz66: 5_000 }, { period: { year: 2026, month: 41 } })],
  ["UStVA 4. Quartal 2025 (Zeitraum 44)", ustva(2025, alleKennzahlen, { period: { year: 2025, month: 44 } })],
  [
    "UStVA Dezember mit Abzug der Sondervorauszahlung (Kz 39)",
    ustva(2025, { kz81: 1_000_000, kz86: 0, kz66: 10_000, kz39: 40_000 }, { period: { year: 2025, month: 12 } }),
  ],
  // Antrag auf Dauerfristverlängerung (USt 1 H)
  ["Dauerfristverlängerung 2026 (vierteljährlich)", () => buildDauerfristXml({ ...dauerfrist(2026), sondervorauszahlung: null })],
  ["Sondervorauszahlung 2027 (monatlich)", () => buildDauerfristXml({ ...dauerfrist(2027), sondervorauszahlung: 400_000 })],
  ["Sondervorauszahlung 2026 (monatlich)", () => buildDauerfristXml({ ...dauerfrist(2026), sondervorauszahlung: 400_000 })],
  ["Sondervorauszahlung 2025 null Euro", () => buildDauerfristXml({ ...dauerfrist(2025), sondervorauszahlung: 0 })],
  ["Sondervorauszahlung 2026 berichtigt", () => buildDauerfristXml({ ...dauerfrist(2026), sondervorauszahlung: 318_100, berichtigt: true })],
  ["UStVA echt (ohne Testmerker)", ustva(2026, { kz81: 100_000, kz86: 0, kz66: 0 }, { test: false })],
  [
    "UStVA langer Name, Sonderzeichen",
    ustva(
      2026,
      { kz81: 100_000, kz86: 0, kz66: 0 },
      {
        datenlieferant: {
          name: `Müller & Söhne <"Softwareentwicklung und Beratung"> GmbH`,
          strasse: "Weg 'A' 1 mit sehr langem Straßennamen",
          plz: "10115",
          ort: "Frankfurt am Main-Sachsenhausen Süd",
        },
      },
    ),
  ],
  // Umsatzsteuererklärung
  ...jahre.flatMap((year): [string, () => string][] => [
    [
      `USt-Erklärung ${year} Ist`,
      () =>
        buildUstErklaerungXml({
          ...envelope(year),
          versteuerung: "ist",
          figures: { base19: 10_000_049, tax19: 1_900_009, base7: 50_000, tax7: 3_500, vorsteuer: 120_000, vorauszahlungen: 1_700_000 },
        }),
    ],
    [
      `USt-Erklärung ${year} Soll mit Erstattung`,
      () =>
        buildUstErklaerungXml({
          ...envelope(year),
          versteuerung: "soll",
          figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 50_000, vorauszahlungen: -40_000 },
        }),
    ],
    [
      `USt-Erklärung ${year} nur 7 %`,
      () =>
        buildUstErklaerungXml({
          ...envelope(year),
          versteuerung: "ist",
          figures: { base19: 0, tax19: 0, base7: 1_000_000, tax7: 70_000, vorsteuer: 0, vorauszahlungen: 70_000 },
        }),
    ],
  ]),
  // Anlage EÜR
  ...jahre.flatMap((year): [string, () => string][] => [
    [`Anlage EÜR ${year} alle Felder und Anlagen`, () => buildEuerXml({ ...envelope(year), allgemein, figures: alleEuerFelder, anlagen: anlagen(year) })],
    [
      `Anlage EÜR ${year} Gewerbe`,
      () =>
        buildEuerXml({
          ...envelope(year),
          allgemein: { artDesBetriebs: "Handel", einkunftsart: "gewerbe" },
          figures: { steuerpflichtig: 1_000_000, vereinnahmteUst: 190_000, uebrige: 50_000 },
          anlagen: [],
        }),
    ],
    [
      // Erstattung der Gewerbesteuer eines Vorjahres über den Zahlungen des Jahres: nicht abziehbar negativ
      `Anlage EÜR ${year} Gewerbe mit Gewerbesteuer-Erstattung`,
      () =>
        buildEuerXml({
          ...envelope(year),
          allgemein: { artDesBetriebs: "Handel", einkunftsart: "gewerbe" },
          figures: { steuerpflichtig: 1_000_000, vereinnahmteUst: 190_000, uebrige: 50_000, gewerbesteuerNichtAbziehbar: -30_000 },
          anlagen: [],
        }),
    ],
    [
      `Anlage EÜR ${year} Kleinunternehmer`,
      () => buildEuerXml({ ...envelope(year), allgemein, figures: { kleinunternehmer: 2_000_000, edv: 50_000 }, anlagen: [] }),
    ],
    [
      // Negativer Saldo aus Zeile 58 (#933): wird als Betriebseinnahme in Zeile 18 umgegliedert, beide ohne Vorzeichen
      `Anlage EÜR ${year} Umsatzsteuer umgegliedert`,
      () =>
        buildEuerXml({
          ...envelope(year),
          allgemein,
          figures: { steuerpflichtig: 1_000_000, vereinnahmteUst: 190_000, gezahlteUst: -95_000 },
          anlagen: [],
        }),
    ],
    [
      `Anlage EÜR ${year} Verlust`,
      () =>
        buildEuerXml({
          ...envelope(year),
          allgemein,
          figures: { steuerpflichtig: 100_000, vereinnahmteUst: 19_000, fremdleistungen: 500_000, entnahmen: 0, einlagen: 400_000 },
          anlagen: [],
        }),
    ],
  ]),
  // Einkommensteuer
  ...jahre.flatMap((year): [string, () => string][] => [
    [`ESt ${year} Zusammenveranlagung, alle Angaben`, est(year)],
    [
      `ESt ${year} Einzelveranlagung`,
      est(year, {
        personB: undefined,
        verheiratetSeit: undefined,
        angaben: { ...alleAngaben(year), vorsorge: { a: alleAngaben(year).vorsorge.a, sonstige: 25_000 }, kinder: [], arbeitnehmer: { a: arbeitnehmer(1) } },
      }),
    ],
    [`ESt ${year} Gewerbe mit Verlust`, est(year, { gewinn: { einkunftsart: "gewerbe", taetigkeit: "Handel", betrag: -100_050 } })],
    [`ESt ${year} Gewerbe mit Gewinn`, est(year, { gewinn: { einkunftsart: "gewerbe", taetigkeit: "Handel", betrag: 4_000_000 } })],
  ]),
  ["ESt 2025 Anlage N für beide", est(2025, { angaben: { ...alleAngaben(2025), arbeitnehmer: { a: arbeitnehmer(3), b: arbeitnehmer(4) } } })],
  [
    "ESt 2025 Homeoffice ohne anderen Arbeitsplatz",
    est(2025, {
      angaben: { ...alleAngaben(2025), arbeitnehmer: { b: { ...arbeitnehmer(4), werbungskosten: { homeofficeTage: 210, keinAndererArbeitsplatz: true } } } },
    }),
  ],
  [
    "ESt 2025 Günstigerprüfung",
    est(2025, {
      angaben: {
        ...leereAngaben,
        kap: { guenstigerpruefung: true, ertraegeMitSteuerabzug: 120_000, sparerPauschbetrag: 100_000, kapitalertragsteuer: 5_000, soli: 275 },
      },
    }),
  ],
  [
    "ESt 2025 nur Kapitalerträge ohne Steuerabzug",
    est(2025, { angaben: { ...leereAngaben, kap: { ertraegeOhneSteuerabzugInland: 30_000, ertraegeAusland: 20_000 } } }),
  ],
  ["ESt 2025 ohne weitere Angaben", est(2025, { angaben: leereAngaben, telefon: undefined })],
  // Zusammenfassende Meldung
  [`ZM ${zmJahr} 3. Quartal, sonstige Leistungen mit Gutschrift`, zm()],
  [
    `ZM ${zmJahr} 4. Quartal, alle Umsatzarten`,
    zm({
      period: { year: zmJahr, month: 44 },
      zeilen: [
        { ustId: "XI123456789", art: "L", betrag: 500_000 },
        { ustId: "ESX1234567X", art: "D", betrag: 200_000 },
        { ustId: "EL123456789", art: "S", betrag: 100_000 },
      ],
    }),
  ],
  [`ZM ${zmJahr} Dezember (Monatsmeldung)`, zm({ period: { year: zmJahr, month: 12 } })],
  [`ZM ${zmJahr} Berichtigung, Zeile zurückgenommen`, zm({ berichtigt: true, zeilen: [{ ustId: "ATU12345678", art: "S", betrag: 0 }] })],
  [`ZM ${zmJahr} Straße ohne Hausnummer`, zm({ anschrift: { ...absender, strasse: "Am Markt" } })],
  // Nachrichten an das Finanzamt
  [
    "Sonstige Nachricht",
    () =>
      buildNachrichtXml({
        steuernummer13: stnr,
        bundesland: "BW",
        absender,
        betreff: "Antrag auf Herabsetzung der Vorauszahlungen",
        text: "Sehr geehrte Damen und Herren,\n<bitte> herabsetzen.",
        herstellerId,
        produktVersion: "0.1.0",
        test: true,
      }),
  ],
  [
    "Sonstige Nachricht als natürliche Person",
    () =>
      buildNachrichtXml({
        steuernummer13: stnr,
        bundesland: "BW",
        absender,
        person: { idnr: idA, vorname: "Max", name: "Muster" },
        betreff: "Test",
        text: "Hallo",
        herstellerId,
        produktVersion: "0.1.0",
        test: true,
      }),
  ],
  [
    "Sonstige Nachricht, Hausnummer mit Bereich",
    () =>
      buildNachrichtXml({
        steuernummer13: stnr,
        bundesland: "BW",
        absender: { ...absender, strasse: "Am Ring 12-14" },
        betreff: "Test",
        text: "x".repeat(1000),
        herstellerId,
        produktVersion: "0.1.0",
        test: true,
      }),
  ],
  [
    "Änderung der Bankverbindung",
    () =>
      buildBankverbindungXml({
        steuernummer13: stnr,
        bundesland: "BW",
        person: { idnr: idA, anrede: "Herrn", vorname: "Max", name: "Muster & Sohn", geburtsdatum: "1980-03-15" },
        iban: "DE89 3704 0044 0532 0130 00",
        herstellerId,
        produktVersion: "0.1.0",
        test: true,
      }),
  ],
  [
    "Änderung der Bankverbindung, Frau",
    () =>
      buildBankverbindungXml({
        steuernummer13: stnr,
        bundesland: "BW",
        person: { idnr: idB, anrede: "Frau", vorname: "Erika", name: "Muster", geburtsdatum: "1987-09-01" },
        iban: "DE02120300000000202051",
        herstellerId,
        produktVersion: "0.1.0",
        test: true,
      }),
  ],
];

/** Meldung zum Freigabedatum (ESt, EÜR des laufenden Jahres) und Rückgabecode dazu laut eric_fehlercodes.h */
const VOR_ABLAUF = "ACHTUNG, eine Übermittlung vor Ablauf des Veranlagungszeitraums ist nicht zulässig.";
const ERIC_GLOBAL_PRUEF_FEHLER = 610001002;

describe.skipIf(!ericHome)("Echtes ERiC: Nachrichten lokal prüfen", () => {
  const client = new EricProcessClient({ ericHome: ericHome!, workerCommand: parseWorkerCommand(process.env.ERIC_WORKER_COMMAND) });

  // Jahre, deren Plugin dem installierten ERiC fehlt (etwa 2027 vor ERiC 45), werden übersprungen statt rot
  const vorhanden = (build: () => string) => hatJahresPlugin(ericHome!, datenartVersionFromXml(build()));
  it.skip.each(faelle.filter(([, build]) => !vorhanden(build)))("%s (Plugin fehlt in diesem ERiC)", () => {});
  it.each(faelle.filter(([, build]) => vorhanden(build)))(
    "%s",
    async (_name, build) => {
      const result = await client.validate(build());
      // Vor Ablauf des Jahres sperrt ERiC Erklärungen dieses Jahres (Freigabedatum); alle anderen Prüfungen laufen trotzdem
      const meldungen = ericMeldungen(result.responseXml).filter((m) => !m.startsWith(VOR_ABLAUF));
      if (meldungen.length === 0 && result.code === ERIC_GLOBAL_PRUEF_FEHLER && ericMeldungen(result.responseXml).length > 0) return;
      expect(result.ok, `${result.code} ${result.message}\n${meldungen.join("\n")}`).toBe(true);
    },
    ericTestTimeout(60_000),
  );

  it.each([2024, 2025])(
    "Belegabruf, Abrufberechtigung und Postfach (%i)",
    async (veranlagungsjahr) => {
      const results = await checkFormats(client, {
        idnr: idA,
        geburtsdatum: "1985-04-12",
        datenlieferant: "Haben Formatprüfung",
        herstellerId,
        veranlagungsjahr,
        produktVersion: "0.1.0",
      });
      expect(results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.code} ${r.message}`)).toEqual([]);
    },
    ericTestTimeout(120_000),
  );
});
