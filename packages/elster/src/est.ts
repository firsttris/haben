import type { Cents } from "@haben/core";
import { isValidIdnr } from "./bankverbindung.ts";
import { checkEnvelope, envelope, render, vorsatz, type Envelope, type ErklaerungAbsender, type XmlNode } from "./erklaerung.ts";
import { anlageN } from "./est-anlage-n.ts";
import { anlageVorsorge } from "./est-vorsorge.ts";
import { einkommensersatz, gewinnAnlagen, hauptvordruck, kapAnlagen, sonderausgaben, anlageKind } from "./est-vordrucke.ts";
import { isIsoDate } from "./est-werte.ts";
import { splitStrasse } from "./nachricht.ts";
import { ElsterEingabeError } from "./xml.ts";

/**
 * Einkommensteuererklärung (E10, Unterfallart 10) mit Hauptvordruck ESt 1 A und den Anlagen
 * Sonderausgaben, außergewöhnliche Belastungen, haushaltsnahe Aufwendungen, Kind, G bzw. S, N, KAP
 * und Vorsorgeaufwand. Feldkennungen und Kontexte der Anlage N und der Arbeitnehmerzeilen der
 * Anlage Vorsorgeaufwand aus der Jahresdokumentation 2024. Aufbau und Feldkennungen wie bei viking; die Reihenfolge der Elemente folgt
 * der Jahresdokumentation der Finanzverwaltung (XSD-Reihenfolge).
 */

export interface EstPerson {
  idnr: string;
  vorname: string;
  name: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  /** Religionsschlüssel, z. B. "11" (keine), "02" (evangelisch) */
  religion: string;
  beruf: string;
}

/** Beiträge einer Person zur Basisabsicherung, Anlage Vorsorgeaufwand */
export interface EstVorsorgePerson {
  /** Gesetzliche Rentenversicherung ohne die Beiträge laut Lohnsteuerbescheinigung (Zeile 6, E2000601) */
  rentenversicherung?: Cents;
  /** Gesetzliche Krankenversicherung ohne Krankengeldanteil */
  gkv?: Cents;
  /** Soziale Pflegeversicherung */
  gpv?: Cents;
  /** Gesetzlich: über die Basisabsicherung hinaus (Wahlleistungen, Krankengeldanteil) */
  gkvZusatz?: Cents;
  /** Private Krankenversicherung, nur Basisabsicherung */
  pkv?: Cents;
  /** Private Pflege-Pflichtversicherung */
  ppv?: Cents;
  /** Erstattungen der privaten Kranken- und Pflegeversicherung */
  pkvErstattung?: Cents;
  /** Beiträge zu zertifizierten Basisrentenverträgen (Rürup, § 10 Abs. 1 Nr. 2 b EStG) */
  basisrente?: Cents;
  /** Privat: über die Basisabsicherung hinaus, also Wahlleistungen (§ 10 Abs. 1 Nr. 3 a EStG) */
  pkvWahlleistungen?: Cents;
  /**
   * Steuerfreier Arbeitgeberzuschuss zur gesetzlichen Krankenversicherung (§ 3 Nr. 62 EStG, Nr. 24 a).
   * ERiC verlangt dazu Beiträge zur Basiskrankenversicherung derselben Person (Regel 100240075).
   */
  agZuschussGkv?: Cents;
  /** Steuerfreier Arbeitgeberzuschuss zur privaten Krankenversicherung (§ 3 Nr. 62 EStG, Nr. 24 b) */
  agZuschussKv?: Cents;
  /** Steuerfreier Arbeitgeberzuschuss zur Pflegeversicherung (§ 3 Nr. 62 EStG, Nr. 24 c), gesetzlich wie privat */
  agZuschussPv?: Cents;
}

export interface EstKind {
  idnr?: string;
  vorname: string;
  /** Nur, wenn er vom Namen der Person A abweicht */
  name?: string;
  /** JJJJ-MM-TT */
  geburtsdatum: string;
  familienkasse?: string;
  /** Kinderbetreuungskosten im Jahr */
  kinderbetreuung?: Cents;
}

export interface EstKap {
  guenstigerpruefung?: boolean;
  /** Kapitalerträge mit inländischem Steuerabzug laut Steuerbescheinigung */
  ertraegeMitSteuerabzug?: Cents;
  /** Davon bereits in Anspruch genommener Sparer-Pauschbetrag */
  sparerPauschbetrag?: Cents;
  /** Inländische Kapitalerträge ohne Steuerabzug */
  ertraegeOhneSteuerabzugInland?: Cents;
  /** Ausländische Kapitalerträge ohne Steuerabzug */
  ertraegeAusland?: Cents;
  kapitalertragsteuer?: Cents;
  soli?: Cents;
  kirchensteuer?: Cents;
}

/** Eine Lohnsteuerbescheinigung; die Nummern beziehen sich auf deren Zeilen */
export interface EstLohnsteuerbescheinigung {
  steuerklasse: 1 | 2 | 3 | 4 | 5 | 6;
  /** Nr. 3 Bruttoarbeitslohn */
  brutto: Cents;
  /** Nr. 4 */
  lohnsteuer?: Cents;
  /** Nr. 5 */
  soli?: Cents;
  /** Nr. 6 Kirchensteuer des Arbeitnehmers */
  kirchensteuer?: Cents;
  /** Nr. 7 Kirchensteuer des Ehegatten (nur bei Konfessionsverschiedenheit) */
  kirchensteuerEhegatte?: Cents;
  /** Nr. 22a Arbeitgeberanteil zur gesetzlichen Rentenversicherung */
  rvArbeitgeber?: Cents;
  /** Nr. 23a Arbeitnehmeranteil zur gesetzlichen Rentenversicherung */
  rvArbeitnehmer?: Cents;
  /** Nr. 25 Arbeitnehmerbeiträge zur gesetzlichen Krankenversicherung */
  kvArbeitnehmer?: Cents;
  /** Nr. 26 Arbeitnehmerbeiträge zur sozialen Pflegeversicherung */
  pvArbeitnehmer?: Cents;
  /** Nr. 27 Arbeitnehmerbeiträge zur Arbeitslosenversicherung */
  avArbeitnehmer?: Cents;
}

export interface EstWerbungskosten {
  /** Wege zur ersten Tätigkeitsstätte (Entfernungspauschale) */
  wege?: { tage: number; km: number; adresse: string; arbeitstageJeWoche?: number; urlaubstage?: number };
  /** Homeoffice-Tage ohne Besuch der ersten Tätigkeitsstätte */
  homeofficeTage?: number;
  /** Für die Tätigkeit steht dauerhaft kein anderer Arbeitsplatz zur Verfügung */
  keinAndererArbeitsplatz?: boolean;
  arbeitsmittel?: Cents;
  fortbildung?: Cents;
  berufsverbaende?: Cents;
  gewerkschaft?: Cents;
  /** Weitere, etwa Kontoführung oder Bewerbungen */
  sonstige?: Cents;
  /** Häusliches Arbeitszimmer als Mittelpunkt der gesamten Tätigkeit: Aufwendungen oder Jahrespauschale (§ 4 Abs. 5 Satz 1 Nr. 6b, § 9 Abs. 5 EStG) */
  arbeitszimmer?: Cents;
  /**
   * Monate, in denen das Arbeitszimmer wenigstens zeitweise der Mittelpunkt der gesamten Tätigkeit war. Zeitanteilig sinkt die
   * Jahrespauschale um 105 EUR je fehlendem Monat. Das Feld geht nicht ins XML; es dient Habens Hinweis.
   */
  arbeitszimmerMonate?: number;
}

/** Arbeitslohn einer Person, Anlage N */
export interface EstArbeitnehmer {
  bescheinigungen: EstLohnsteuerbescheinigung[];
  werbungskosten: EstWerbungskosten;
}

/** Einkommensersatzleistung mit Progressionsvorbehalt (§ 32b EStG), Zeile des Hauptvordrucks */
export interface EstErsatzleistung {
  /** Art der Leistung, z. B. Arbeitslosengeld, Elterngeld, Krankengeld, Mutterschaftsgeld */
  art: string;
  betrag: Cents;
}

export interface EstAngaben {
  vorsorge: { a: EstVorsorgePerson; b?: EstVorsorgePerson /** Weitere sonstige Vorsorgeaufwendungen (Haftpflicht, Unfall, Risikoleben) */; sonstige?: Cents };
  sonderausgaben: { kirchensteuerGezahlt?: Cents; kirchensteuerErstattet?: Cents; spenden?: Cents };
  /** Krankheitskosten (außergewöhnliche Belastung) */
  krankheitskosten?: Cents;
  haushaltsnah: { minijobs?: Cents; dienstleistungen?: Cents /** nur Lohn-, Maschinen- und Fahrtkosten */; handwerker?: Cents };
  kinder: EstKind[];
  kap?: EstKap;
  /** Einkommensersatzleistungen je Person; steuerfrei, erhöhen aber den Steuersatz */
  ersatzleistungen?: { a?: EstErsatzleistung[]; b?: EstErsatzleistung[] };
  /** Anlage N je Person */
  arbeitnehmer?: { a?: EstArbeitnehmer; b?: EstArbeitnehmer };
}

export interface EstXmlInput extends Omit<Envelope, "datenArt" | "absender"> {
  personA: EstPerson;
  /** Ehegatte bei Zusammenveranlagung */
  personB?: EstPerson;
  /** JJJJ-MM-TT, Pflicht bei Zusammenveranlagung */
  verheiratetSeit?: string;
  anschrift: { strasse: string; plz: string; ort: string };
  telefon?: string;
  /** Erstattungskonto, Kontoinhaber Person A */
  iban?: string;
  /** Gewinn aus dem Betrieb laut EÜR */
  gewinn?: { einkunftsart: "gewerbe" | "selbstaendig"; taetigkeit: string; betrag: Cents };
  angaben: EstAngaben;
}

export { anlageN } from "./est-anlage-n.ts";
export { kindZeitraum } from "./est-werte.ts";

function checkPerson(label: string, p: EstPerson) {
  if (!isValidIdnr(p.idnr)) throw new ElsterEingabeError(`${label}: Die Identifikationsnummer ist ungültig.`);
  if (!p.vorname.trim() || !p.name.trim()) throw new ElsterEingabeError(`${label}: Vor- und Nachname fehlen.`);
  if (!isIsoDate(p.geburtsdatum)) throw new ElsterEingabeError(`${label}: Das Geburtsdatum fehlt.`);
}

export function buildEstXml(input: EstXmlInput): string {
  const a = input.personA;
  const b = input.personB;
  checkPerson("Person A", a);
  if (b) {
    checkPerson("Ehegatte", b);
    if (b.idnr === a.idnr) throw new ElsterEingabeError("Person A und Ehegatte haben dieselbe Identifikationsnummer.");
    if (!input.verheiratetSeit || !isIsoDate(input.verheiratetSeit)) throw new ElsterEingabeError("Für die Zusammenveranlagung fehlt das Heiratsdatum.");
  }
  const adresse = splitStrasse(input.anschrift.strasse);
  if (!adresse) throw new ElsterEingabeError("In der Anschrift fehlt die Hausnummer.");
  const absender: ErklaerungAbsender = { name: `${a.vorname} ${a.name}`, ...input.anschrift };
  const envelopeInput: Envelope = { ...input, absender, datenArt: "ESt" };
  checkEnvelope(envelopeInput);
  const x = input.angaben;
  const zusammen = Boolean(b);
  // ELSTER verlangt eine Bankverbindung oder die ausdrückliche Erklärung, dass keine besteht
  if (!input.iban?.trim()) throw new ElsterEingabeError("Für die Einkommensteuererklärung fehlt die Bankverbindung (IBAN in den Firmendaten).");
  // Ohne Zusammenveranlagung verlangt die Anlage Kind Angaben zum anderen Elternteil, die Haben nicht erfasst
  if (!zusammen && input.angaben.kinder.length > 0) {
    throw new ElsterEingabeError(
      "Kinder bei Einzelveranlagung: ELSTER verlangt Angaben zum anderen Elternteil, die Haben noch nicht erfasst. Bitte über Mein ELSTER abgeben.",
    );
  }

  const est1a = hauptvordruck(input, adresse);
  const kinder = x.kinder.map((kind) => anlageKind(kind, input.year, a));
  const personen: [string, EstArbeitnehmer | undefined][] = [
    ["PersonA", x.arbeitnehmer?.a],
    ["PersonB", zusammen ? x.arbeitnehmer?.b : undefined],
  ];
  const anlagenN = personen.flatMap(([person, an]) => (an && an.bescheinigungen.length > 0 ? [anlageN(person, an, input.year)] : []));

  // Eink_Ers steht in E10-2025.xsd innerhalb von ESt1A, direkt hinter Allg
  const est1aMitErsatz: XmlNode = ["ESt1A", [...(est1a[1] as readonly XmlNode[]), ...einkommensersatz(x, zusammen)]];

  return envelope(envelopeInput, [
    `<E10 xmlns="http://finkonsens.de/elster/elstererklaerung/est/e10/v${input.year}" version="${input.year}">`,
    ...[
      est1aMitErsatz,
      ...sonderausgaben(x),
      ...kinder,
      ...gewinnAnlagen(input),
      ...anlagenN,
      ...kapAnlagen(x, zusammen),
      anlageVorsorge(x, zusammen, personen),
    ].flatMap((node) => render(node, "  ")),
    ...render(vorsatz("10", envelopeInput, { a: a.idnr, ...(b ? { b: b.idnr } : {}) }), "  "),
    `</E10>`,
  ]);
}
