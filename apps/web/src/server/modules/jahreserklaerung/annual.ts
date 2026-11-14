import { UserError } from "../../errors.ts";
import {
  ACCOUNTS,
  taxOf,
  toElsterSteuernummer,
  toWholeEuros,
  type Cents,
  type Prognose,
  type EuerResult,
  type ExpenseCategory,
  type PauschaleArt,
  frequencyAt,
  filingPeriodsOfYear,
  homeofficeSatz,
  isKapitalgesellschaft,
  monthsOfPeriod,
  periodKey,
  sondervorauszahlungFor,
  STEUER_KONTEN,
  type Kontenrahmen,
  type VatFrequencySetting,
} from "@haben/core";
import {
  buildEstXml,
  buildEuerXml,
  buildUstErklaerungXml,
  splitStrasse,
  ERSTES_ERKLAERUNGSJAHR,
  euerTotals,
  euerUstUmgliedern,
  euerVorzeichenMeldungen,
  ustErklaerungLeer,
  ustErklaerungResult,
  type AveuerAnlage,
  type ElsterClient,
  type ElsterResult,
  type EstAngaben,
  type EuerFigureKey,
  type EuerFigures,
  type UstErklaerungFigures,
} from "@haben/elster";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { listAssets } from "../buchhaltung/index.ts";
import { companyIssues, kleinunternehmerForYear, loadCompany, versteuerungForYear, type Company } from "../stammdaten/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { loadEstAngaben, prognose } from "./income-tax.ts";
import { listPauschalen } from "../buchhaltung/index.ts";
import {
  euerForYear,
  lohnZahlungenUmJahreswechsel,
  umsatzsteuerVorjahreUmJahreswechsel,
  vorauszahlungVorjahrHinweis,
  ZEHN_TAGE_REGEL,
  zehnTageKennzeichen,
  type ZehnTageKennzeichen,
} from "../auswertungen/index.ts";
import { computeVatFigures, loadDauerfrist, loadFrequencies } from "../umsatzsteuer/index.ts";
import { PRODUKT_VERSION, uebermitteln } from "../elster/index.ts";

export class AnnualError extends UserError {}

export type AnnualForm = "ust" | "euer" | "est";

export interface Issue {
  /** fehler: nicht sendbar; hinweis: sendbar, aber prüfen */
  tone: "fehler" | "hinweis";
  text: string;
  link?: "/einstellungen" | "/anlagen" | "/umsatzsteuer" | "/bank" | "/pauschalen";
  /** Zeitraum der Umsatzsteuer für den Link („2025-Q4“); ohne Angabe leitet /umsatzsteuer auf den laufenden Zeitraum um */
  zeitraum?: string;
}

export interface IssueOptions {
  /** Für das Jahr liegt ein Vermerk „außerhalb von Haben abgegeben“ vor; Meldungen aus Habens eigenen (leeren) Daten treten zurück (#869) */
  vermerkt?: boolean;
}

// ------------------------------------------------------------------ Umsatzsteuererklärung

export interface UstYear {
  figures: UstErklaerungFigures;
  steuer: Cents;
  abschluss: Cents;
  /** Steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48, Zeile 46/47/49): Zeile und §-4-Nummer kann Haben noch nicht übermitteln */
  kz48: Cents;
  /** Monate ohne gesendete Voranmeldung (Monat oder Quartal), ohne die befreiten */
  missingMonths: number[];
  /** Letzter Voranmeldungszeitraum des Jahres nach der Einstellung: „2025-Q4“ bzw. „2025-12“, null ohne Voranmeldung */
  lastFilingPeriod: string | null;
}

/**
 * Letzter Voranmeldungszeitraum eines Jahres nach der Einstellung. Der Hinweis zu fehlenden Voranmeldungen verlinkt
 * damit einen Zeitraum des betroffenen Jahres statt des laufenden (#869).
 */
export function lastFilingPeriodKey(settings: readonly VatFrequencySetting[], year: number): string | null {
  const last = filingPeriodsOfYear(settings, year).at(-1);
  return last ? periodKey(last) : null;
}

/** Zahlen der Umsatzsteuererklärung: Summe der zwölf Monate aus den Buchungen, Vorauszahlungen aus den gesendeten Voranmeldungen */
export async function ustYear(year: number): Promise<UstYear> {
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => computeVatFigures({ year, month: i + 1 })));
  const total = (
    key:
      | "kz81"
      | "kz86"
      | "kz21"
      | "kz45"
      | "kz48"
      | "kz66"
      | "kz46"
      | "kz47"
      | "kz84"
      | "kz85"
      | "kz41"
      | "kz43"
      | "kz89"
      | "tax89"
      | "kz93"
      | "tax93"
      | "kz61"
      | "kz62"
      | "kz67",
  ) => months.reduce((s, m) => s + m[key], 0);
  // Wie in der Voranmeldung: Bemessungsgrundlage in vollen Euro, Steuer daraus
  const base19 = toWholeEuros(total("kz81"));
  const base7 = toWholeEuros(total("kz86"));

  // Je Monat zählt die zuletzt gesendete Anmeldung (bei Berichtigungen die berichtigte)
  const sent = await db
    .select({ month: schema.vatReturns.month, kz83: schema.vatReturns.kz83, sentAt: schema.vatReturns.sentAt })
    .from(schema.vatReturns)
    .where(and(eq(schema.vatReturns.year, year), eq(schema.vatReturns.status, "sent")))
    .orderBy(desc(schema.vatReturns.sentAt));
  const latest = new Map<number, Cents>();
  for (const row of sent) if (!latest.has(row.month)) latest.set(row.month, row.kz83);
  // Ein gesendetes Quartal deckt seine drei Monate; befreite Monate fehlen nicht
  const covered = new Set([...latest.keys()].flatMap((month) => monthsOfPeriod({ year, month }).map((m) => m.month)));
  const frequencies = await loadFrequencies();

  const figures: UstErklaerungFigures = {
    base19,
    tax19: taxOf(base19, 1900),
    base7,
    tax7: taxOf(base7, 700),
    vorsteuer: total("kz66"),
    // Vorauszahlungssoll einschließlich der Sondervorauszahlung: Um sie ist die Voranmeldung für Dezember gemindert (Kz 39)
    vorauszahlungen: [...latest.values()].reduce((s, v) => s + v, 0) + sondervorauszahlungFor(await loadDauerfrist(), year),
    // Auch hier Bemessungsgrundlagen in vollen Euro; die Steuerbeträge bleiben centgenau
    kz21: toWholeEuros(total("kz21")),
    kz45: toWholeEuros(total("kz45")),
    kz41: toWholeEuros(total("kz41")),
    kz43: toWholeEuros(total("kz43")),
    kz89: toWholeEuros(total("kz89")),
    tax89: total("tax89"),
    kz93: toWholeEuros(total("kz93")),
    tax93: total("tax93"),
    kz46: toWholeEuros(total("kz46")),
    kz47: total("kz47"),
    kz84: toWholeEuros(total("kz84")),
    kz85: total("kz85"),
    kz61: total("kz61"),
    kz62: total("kz62"),
    kz67: total("kz67"),
  };
  return {
    figures,
    ...ustErklaerungResult(figures),
    kz48: total("kz48"),
    missingMonths: Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !covered.has(m) && frequencyAt(frequencies, { year, month: m }) !== "keine"),
    lastFilingPeriod: lastFilingPeriodKey(frequencies, year),
  };
}

/** `kleinunternehmer`: Status im Jahr der Erklärung (kleinunternehmerForYear), nicht der heutige */
export function ustIssues(kleinunternehmer: boolean, data: UstYear, year: number, { vermerkt = false }: IssueOptions = {}): Issue[] {
  const issues: Issue[] = [];
  if (kleinunternehmer) {
    issues.push({
      tone: "fehler",
      text:
        year >= 2024
          ? "Als Kleinunternehmer gibst du ab 2024 keine Umsatzsteuererklärung mehr ab, außer das Finanzamt fordert dazu auf."
          : `Für ${year} gibst du auch als Kleinunternehmer noch eine Umsatzsteuererklärung ab (erst ab 2024 nicht mehr). Die Angaben für Kleinunternehmer kann Haben nicht übermitteln; gib sie im ELSTER-Portal ab.`,
    });
  }
  // Steuerfreie Umsätze ohne Vorsteuerabzug gehören je nach Nummer in § 4 UStG in verschiedene Zeilen (46, 47, 49), mit der Nummer als Text
  if (data.kz48 !== 0) {
    issues.push({
      tone: "fehler",
      text: "Das Jahr enthält steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48). Diese Zeile kann Haben noch nicht übermitteln; gib die Erklärung mit den Werten unten im ELSTER-Portal ab.",
    });
  }
  // Mit Vermerk hat das Finanzamt die Erklärung längst; Habens leere Daten sagen dazu nichts mehr
  if (!vermerkt && ustErklaerungLeer(data.figures) && data.kz48 === 0) {
    issues.push({ tone: "fehler", text: "Keine Umsätze und keine Vorsteuer: eine Nullerklärung geht über das ELSTER-Portal." });
  }
  if (data.missingMonths.length > 0 && !kleinunternehmer) {
    issues.push({
      tone: "hinweis",
      text: `${data.missingMonths.length === 12 ? "Für keinen Monat gibt es" : `Für ${data.missingMonths.length} Monat${data.missingMonths.length === 1 ? "" : "e"} fehlt`} eine in Haben gesendete Voranmeldung. Als Vorauszahlungssoll zählen nur diese; Voranmeldungen aus einem anderen Programm fehlen darin.`,
      link: "/umsatzsteuer",
      ...(data.lastFilingPeriod ? { zeitraum: data.lastFilingPeriod } : {}),
    });
  }
  return issues;
}

// ------------------------------------------------------------------ Anlage EÜR

/** Kategorie der Belege → Zeile der Anlage EÜR; Anlagen über die AfA, die Einfuhrumsatzsteuer als gezahlte Vorsteuer */
const EUER_CATEGORY_FIELDS: Record<Exclude<ExpenseCategory, "anlage" | "einfuhrumsatzsteuer">, EuerFigureKey> = {
  software: "edv",
  edv: "edv",
  // Anlage EÜR 2025: Erhaltungsaufwendungen (Zeile 48, Kz 225) und Miete/Pacht für Geschäftsräume (Zeile 39, Kz 150)
  reparatur: "erhaltung",
  miete: "miete",
  hardware: "gwg",
  telefon: "telekommunikation",
  internet: "telekommunikation",
  buero: "arbeitsmittel",
  literatur: "arbeitsmittel",
  porto: "arbeitsmittel",
  // Anlage EÜR 2025, Zeile 60 „Übrige unbeschränkt abziehbare Betriebsausgaben“
  betriebsbedarf: "uebrige",
  fortbildung: "fortbildung",
  fahrtkosten: "kfzSonstige",
  uebernachtung: "reisekosten",
  werbung: "werbung",
  bewirtung: "bewirtung",
  geschenke: "geschenke",
  beratung: "beratung",
  buchfuehrung: "beratung",
  wareneinkauf: "waren",
  fremdleistung: "fremdleistungen",
  geldverkehr: "uebrige",
  kfzBetrieb: "kfzSonstige",
  kfzVersicherung: "kfzSteuerVersicherung",
  kfzSteuer: "kfzSteuerVersicherung",
  kfzReparatur: "kfzSonstige",
  kfzLeasing: "kfzLeasing",
  // Zeile 70 „Sonstige tatsächliche Fahrtkosten ohne AfA und Zinsen“; eine Zeile „sonstige Kfz-Kosten“ gibt es nicht
  kfzSonstige: "kfzSonstige",
  versicherung: "beitraegeVersicherungen",
  beitraege: "beitraegeVersicherungen",
  // Zeile 30: Gehälter, Löhne und Versicherungsbeiträge für Arbeitnehmer (Anleitung zur Anlage EÜR 2025)
  berufsgenossenschaft: "personal",
  versorgungskassen: "personal",
  sonstiges: "uebrige",
};

/**
 * Pauschalen ohne Beleg: Homeoffice als Tagespauschale, Fahrten als Nutzungseinlage, Verpflegung als beschränkt abziehbar,
 * die Wege zur Betriebsstätte in der eigenen Zeile der Entfernungspauschale (Zeile 73 der Anlage EÜR 2025)
 */
const PAUSCHALE_FIELDS: Record<PauschaleArt, EuerFigureKey> = {
  homeoffice: "tagespauschale",
  fahrt: "fahrtNutzungseinlage",
  verpflegung: "verpflegung",
  entfernung: "entfernungspauschale",
};

/** Verteilt die EÜR von Haben auf die Zeilen der Anlage EÜR. Summen und Gewinn bleiben gleich. */
function euerFigures(euer: EuerResult): EuerFigures {
  const figures: EuerFigures = {};
  const add = (key: EuerFigureKey, cents: Cents) => {
    if (cents !== 0) figures[key] = (figures[key] ?? 0) + cents;
  };
  for (const line of [...euer.einnahmen, ...euer.ausgaben]) {
    if (line.key.startsWith("ausgabe:")) {
      const category = line.key.slice("ausgabe:".length) as ExpenseCategory;
      add(category in EUER_CATEGORY_FIELDS ? EUER_CATEGORY_FIELDS[category as keyof typeof EUER_CATEGORY_FIELDS] : "uebrige", line.amount);
      continue;
    }
    if (line.key.startsWith("pauschale:")) {
      add(PAUSCHALE_FIELDS[line.key.slice("pauschale:".length) as PauschaleArt], line.amount);
      continue;
    }
    const key = (
      {
        einnahmenKleinunternehmer: "kleinunternehmer",
        einnahmenSteuerpflichtig: "steuerpflichtig",
        einnahmenSteuerfrei: "steuerfrei",
        privateKfz: "privateKfz",
        sachentnahmen: "sachentnahmen",
        vereinnahmteUst: "vereinnahmteUst",
        ustEntnahmen: "vereinnahmteUst",
        erstatteteUst: "erstatteteUst",
        afa: "afaBeweglich",
        gwg: "gwg",
        sammelposten: "sammelposten",
        restbuchwert: "restbuchwert",
        personal: "personal",
        // Zinsen und Zuschläge zu betrieblichen Steuern: übrige unbeschränkt abziehbare Betriebsausgaben, nicht die
        // Schuldzinsen der Zeilen 55 und 56 (die rechnen für § 4 Abs. 4a EStG mit Darlehenszinsen)
        steuerNebenleistungen: "uebrige",
        schuldzinsenAnlage: "schuldzinsenAnlage",
        schuldzinsen: "schuldzinsen",
        vorsteuer: "vorsteuer",
        gezahlteUst: "gezahlteUst",
        // Kursgewinne sind nicht steuerbare Einnahmen, Kursverluste übrige Ausgaben
        kursgewinne: "steuerfrei",
        kursverluste: "uebrige",
      } as const
    )[line.key as Exclude<EuerResult["einnahmen"][number]["key"], `ausgabe:${string}` | `pauschale:${string}`>];
    add(key, line.amount);
  }
  if (euer.bewirtungNichtAbziehbar !== 0) figures.bewirtungNichtAbziehbar = euer.bewirtungNichtAbziehbar;
  if (euer.gewerbesteuerNichtAbziehbar !== 0) figures.gewerbesteuerNichtAbziehbar = euer.gewerbesteuerNichtAbziehbar;
  return figures;
}

/** Entnahmen und Einlagen laut Journal (Privatkonten), je Buchung in deren Kontenrahmen, damit ein Wechsel das Vorjahr nicht verfälscht */
async function privateMovements(year: number) {
  const rows = await db
    .select({
      kontenrahmen: schema.journalEntries.kontenrahmen,
      account: schema.journalLines.account,
      saldo: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(
      and(
        gte(schema.journalEntries.date, `${year}-01-01`),
        lt(schema.journalEntries.date, `${year + 1}-01-01`),
        or(
          ...(["SKR03", "SKR04"] as const).map((kr) =>
            and(
              eq(schema.journalEntries.kontenrahmen, kr),
              inArray(schema.journalLines.account, [
                ACCOUNTS[kr].privatentnahmen,
                ACCOUNTS[kr].spenden,
                STEUER_KONTEN[kr].privatsteuern,
                ACCOUNTS[kr].privateinlagen,
              ]),
            ),
          ),
        ),
      ),
    )
    .groupBy(schema.journalEntries.kontenrahmen, schema.journalLines.account);
  const saldo = (konto: (kr: Kontenrahmen) => string) => rows.filter((r) => r.account === konto(r.kontenrahmen)).reduce((sum, r) => sum + Number(r.saldo), 0);
  // Private Steuern vom Geschäftskonto (Privatsteuern, steuerzahlung.ts) sind Entnahmen, ihre Erstattungen mindern sie.
  // Übersteigen die Erstattungen die Zahlungen, ist der Rest eine Einlage: Die Anlage EÜR kennt keine negativen Entnahmen.
  const privatsteuern = saldo((kr) => STEUER_KONTEN[kr].privatsteuern);
  return {
    // Private Spenden (Zuwendungen, Spenden) sind Entnahmen wie jede andere
    entnahmen: saldo((kr) => ACCOUNTS[kr].privatentnahmen) + saldo((kr) => ACCOUNTS[kr].spenden) + Math.max(0, privatsteuern),
    einlagen: -saldo((kr) => ACCOUNTS[kr].privateinlagen) + Math.max(0, -privatsteuern) || 0,
  };
}

export interface EuerYear {
  /** Jahr der Erklärung; die Zeilen der Anlage EÜR in den Meldungen richten sich danach (euerUstZeilen) */
  year: number;
  figures: EuerFigures;
  einnahmen: Cents;
  ausgaben: Cents;
  gewinn: Cents;
  anlagen: AveuerAnlage[];
  /** Anlagen, deren AfA bzw. Privatnutzung für das Jahr noch nicht gebucht ist */
  pendingAssets: number;
  /** Lohnzahlungen um den Jahreswechsel (§ 11 Abs. 2 Satz 2 EStG), siehe lohnZahlungenUmJahreswechsel */
  lohnUmJahreswechsel: number;
  /** Umsatzsteuer früherer Jahre um den Jahreswechsel, siehe umsatzsteuerVorjahreUmJahreswechsel */
  ustUmJahreswechsel: number;
  /** Vorauszahlungen für das Vorjahr, die hier zählen, weil es gesperrt war (vorauszahlungVorjahrHinweis) */
  vorauszahlungHinweis: string | null;
  /** Welche Vorauszahlungen um den Jahreswechsel diese EÜR verschiebt; wird mit der Übermittlung gespeichert (ZEHN_TAGE_REGEL) */
  zehnTage: ZehnTageKennzeichen;
  /** Umsatzsteuer, die zwischen Zeile 18 und Zeile 58 umgegliedert wurde (#933); leer, wenn nichts umzugliedern war */
  ustUmgliederung: string[];
}

export async function euerYear(year: number): Promise<EuerYear> {
  const [euer, movements, assets, lohnUmJahreswechsel, ustUmJahreswechsel, vorauszahlungHinweis, zehnTage] = await Promise.all([
    euerForYear(year),
    privateMovements(year),
    listAssets(year),
    lohnZahlungenUmJahreswechsel(year),
    umsatzsteuerVorjahreUmJahreswechsel(year),
    vorauszahlungVorjahrHinweis(year),
    zehnTageKennzeichen(year),
  ]);
  // Ein negativer Saldo zwischen Zeile 58 und Zeile 18 wird umgegliedert, damit Anzeige und Übermittlung gleich sind (#933)
  const roheFiguren: EuerFigures = { ...euerFigures(euer), ...movements };
  const { figures, umgliederungen: ustUmgliederung } = euerUstUmgliedern(roheFiguren, year);
  const anlagen: AveuerAnlage[] = assets
    .filter((a) => a.year && a.method !== "gwg")
    .map((a) => ({
      gruppe: a.method === "sammelposten" ? "sammelposten" : a.kind === "kfz" ? "kfz" : a.kind === "buero" ? "buero" : "andere",
      bezeichnung: a.name,
      anschaffung: a.acquisitionDate,
      anschaffungskosten: a.cost,
      // Zugänge des Jahres stehen wie bei EasyCash&Tax im Buchwert zu Beginn
      buchwertBeginn: a.year!.opening + a.year!.addition,
      afa: a.year!.depreciation,
      abgang: a.year!.disposal,
      buchwertEnde: a.year!.closing,
      // Antrieb ist bei erfasster Privatnutzung und bei der AfA nach § 7 Abs. 2a EStG bekannt; sonst gilt das Kfz als Verbrenner
      ...(a.kind === "kfz" ? { elektro: a.method === "elektro" || (a.privateUse ? a.privateUse.drive !== "verbrenner" : false) } : {}),
    }));
  const pendingAssets = assets.filter((a) => a.pending).length;
  return {
    year,
    figures,
    ...euerTotals(figures),
    anlagen,
    pendingAssets,
    lohnUmJahreswechsel,
    ustUmJahreswechsel,
    vorauszahlungHinweis,
    zehnTage,
    ustUmgliederung,
  };
}

export function euerIssues(company: Company, data: EuerYear, { vermerkt = false }: IssueOptions = {}): Issue[] {
  const issues: Issue[] = [];
  // Zeile 18 und 58 der Anlage EÜR nehmen kein Vorzeichen an: ein negativer Saldo wird umgegliedert (#933, Vorgabe aus #708)
  for (const text of data.ustUmgliederung) issues.push({ tone: "hinweis", text, link: "/bank" });
  // Rückfall: bliebe danach ein negativer Betrag übrig, lehnt ERiC beim Senden ab (#708)
  for (const text of euerVorzeichenMeldungen(data.figures, data.year)) issues.push({ tone: "fehler", text, link: "/bank" });
  if (!company.einkunftsart || !company.taetigkeit.trim()) {
    issues.push({ tone: "fehler", text: "Für die Anlage EÜR fehlen Einkunftsart und Art des Betriebs.", link: "/einstellungen" });
  }
  if (data.pendingAssets > 0) {
    issues.push({
      tone: "fehler",
      text: `Für ${data.pendingAssets === 1 ? "eine Anlage" : `${data.pendingAssets} Anlagen`} ist die AfA bzw. Privatnutzung des Jahres noch nicht gebucht; Entnahmen und Anlagenverzeichnis wären unvollständig.`,
      link: "/anlagen",
    });
  }
  // Siehe ustIssues: der Vermerk „außerhalb von Haben abgegeben“ ersetzt die Meldung über Habens leere Daten
  if (!vermerkt && data.einnahmen === 0 && data.ausgaben === 0) issues.push({ tone: "fehler", text: "Keine Betriebseinnahmen und -ausgaben im Jahr." });
  if (data.lohnUmJahreswechsel > 0) {
    issues.push({
      tone: "hinweis",
      text: `${data.lohnUmJahreswechsel === 1 ? "Eine Lohnzahlung liegt" : `${data.lohnUmJahreswechsel} Lohnzahlungen liegen`} zwischen 22. Dezember und 10. Januar. Regelmäßig wiederkehrende Ausgaben gehören dann in das Jahr, zu dem sie wirtschaftlich gehören (§ 11 Abs. 2 Satz 2 EStG), etwa die Lohnsteuer für Dezember. Haben zählt sie am Tag der Zahlung; prüfe die Zuordnung mit der Steuerberatung.`,
      link: "/bank",
    });
  }
  if (data.ustUmJahreswechsel > 0) {
    issues.push({
      tone: "hinweis",
      text: `${data.ustUmJahreswechsel === 1 ? "Eine Zahlung" : `${data.ustUmJahreswechsel} Zahlungen`} „Umsatzsteuer früherer Jahre“ zwischen 22. Dezember und 10. Januar. Eine Abschlusszahlung zählt im Jahr der Zahlung. Ist es die Vorauszahlung für Dezember bzw. das vierte Quartal, ordne sie der Voranmeldung zu: Ohne Dauerfristverlängerung ist sie am 10. Januar fällig, und Haben zählt sie dann im Vorjahr (§ 11 Abs. 2 Satz 2 EStG).`,
      link: "/bank",
    });
  }
  if (data.vorauszahlungHinweis) issues.push({ tone: "hinweis", text: data.vorauszahlungHinweis, link: "/bank" });
  return issues;
}

// ------------------------------------------------------------------ Einkommensteuererklärung

export interface EstYear {
  angaben: EstAngaben;
  /** Gewinn laut EÜR, landet in Anlage S bzw. G */
  gewinn: Cents;
  zusammen: boolean;
  person: { a: string | null; b: string | null };
  /** Anlagen, die Haben mitschickt */
  anlagen: string[];
  /** Geschätzte Steuer aus Gewinn und Angaben */
  prognose: Prognose;
}

async function estYear(year: number, euer?: EuerYear): Promise<EstYear> {
  const [company, angaben, euerData] = await Promise.all([loadCompany(), loadEstAngaben(year), euer ?? euerYear(year)]);
  const t = company.taxpayer;
  const zusammen = t.veranlagung === "zusammen";
  const k = angaben.kap;
  const has = (...values: (number | undefined)[]) => values.some((v) => (v ?? 0) > 0);
  const vor = [angaben.vorsorge.a, zusammen ? angaben.vorsorge.b : undefined].flatMap((v) => (v ? Object.values(v) : []));
  // Sozialversicherung laut Lohnsteuerbescheinigung landet ebenfalls in der Anlage Vorsorgeaufwand
  const vorLohn = [angaben.arbeitnehmer?.a, zusammen ? angaben.arbeitnehmer?.b : undefined]
    .flatMap((an) => an?.bescheinigungen ?? [])
    .flatMap((b) => [b.rvArbeitnehmer, b.rvArbeitgeber, b.kvArbeitnehmer, b.pvArbeitnehmer, b.avArbeitnehmer]);
  const anlagen = [
    "ESt 1 A",
    has(angaben.sonderausgaben.kirchensteuerGezahlt, angaben.sonderausgaben.kirchensteuerErstattet, angaben.sonderausgaben.spenden) && "Sonderausgaben",
    has(angaben.krankheitskosten) && "Außergewöhnliche Belastungen",
    has(angaben.haushaltsnah.minijobs, angaben.haushaltsnah.dienstleistungen, angaben.haushaltsnah.handwerker) && "Haushaltsnahe Aufwendungen",
    angaben.kinder.length > 0 && `Kind (${angaben.kinder.length})`,
    company.einkunftsart === "gewerbe" ? "G" : company.einkunftsart === "selbstaendig" ? "S" : false,
    ...(
      [
        ["a", t.a?.vorname],
        ["b", zusammen ? t.b?.vorname : undefined],
      ] as const
    ).map(([p, vorname]) =>
      (p === "a" || zusammen) && (angaben.arbeitnehmer?.[p]?.bescheinigungen.length ?? 0) > 0 ? `N${vorname ? ` (${vorname})` : ""}` : false,
    ),
    k && (k.guenstigerpruefung || has(k.ertraegeMitSteuerabzug, k.ertraegeOhneSteuerabzugInland, k.ertraegeAusland, k.kapitalertragsteuer)) && "KAP",
    has(...vor, ...vorLohn, angaben.vorsorge.sonstige) && "Vorsorgeaufwand",
  ].filter((a): a is string => Boolean(a));
  return {
    angaben,
    gewinn: euerData.gewinn,
    zusammen,
    person: { a: t.a ? `${t.a.vorname} ${t.a.name}` : null, b: zusammen && t.b ? `${t.b.vorname} ${t.b.name}` : null },
    anlagen,
    prognose: await prognose(year, euerData.gewinn, angaben),
  };
}

function estIssues(company: Company, euer: EuerYear): Issue[] {
  const issues: Issue[] = [];
  const t = company.taxpayer;
  if (!t.a) issues.push({ tone: "fehler", text: "Persönliche Angaben (Steuer-ID, Name, Geburtsdatum) fehlen.", link: "/einstellungen" });
  if (t.veranlagung === "zusammen" && (!t.b || !t.verheiratetSeit)) {
    issues.push({ tone: "fehler", text: "Für die Zusammenveranlagung fehlen Angaben zum Ehegatten oder das Heiratsdatum.", link: "/einstellungen" });
  }
  if (company.strasse && !splitStrasse(company.strasse))
    issues.push({ tone: "fehler", text: "In der Anschrift fehlt die Hausnummer.", link: "/einstellungen" });
  if (!company.einkunftsart) {
    issues.push({ tone: "fehler", text: "Einkunftsart fehlt; ohne sie weiß Haben nicht, ob der Gewinn in Anlage G oder S gehört.", link: "/einstellungen" });
  }
  if (euer.pendingAssets > 0) {
    issues.push({ tone: "fehler", text: "AfA bzw. Privatnutzung des Jahres ist noch nicht gebucht; der Gewinn wäre falsch.", link: "/anlagen" });
  }
  issues.push({
    tone: "hinweis",
    text: "Haben schickt nur die hier gezeigten Angaben. Renten, Vermietung und andere Einkünfte ergänzt du im ELSTER-Portal, falls du sie hast.",
  });
  return issues;
}

/** Die Homeoffice-Tagespauschale gibt es je Person höchstens für 210 Tage, in EÜR und Anlage N zusammen */
async function homeofficeIssues(year: number, est: EstYear): Promise<Issue[]> {
  const satz = homeofficeSatz(year);
  const imN = est.angaben.arbeitnehmer?.a?.bescheinigungen.length ? (est.angaben.arbeitnehmer.a.werbungskosten.homeofficeTage ?? 0) : 0;
  if (!satz || imN === 0) return [];
  const { homeoffice } = await listPauschalen(year);
  if (homeoffice.tage + imN <= satz.maxTage) return [];
  return [
    {
      tone: "hinweis",
      text: `Homeoffice: ${homeoffice.tage} Tage in der EÜR und ${imN} in der Anlage N sind zusammen mehr als ${satz.maxTage}. Die Pauschale gibt es je Person nur einmal; jeder Tag zählt entweder für die selbständige Arbeit oder für die Anstellung.`,
      link: "/pauschalen",
    },
  ];
}

// ------------------------------------------------------------------ Übersicht und Übermittlung

function yearIssues(year: number, today: string): Issue[] {
  if (year < ERSTES_ERKLAERUNGSJAHR) return [{ tone: "fehler", text: `Jahreserklärungen sendet Haben ab ${ERSTES_ERKLAERUNGSJAHR}.` }];
  if (year >= Number(today.slice(0, 4))) return [{ tone: "fehler", text: "Die Erklärung lässt sich erst nach Ablauf des Jahres übermitteln." }];
  return [];
}

export async function submissions(year: number) {
  return (
    db
      .select({
        id: schema.annualSubmissions.id,
        form: schema.annualSubmissions.form,
        kind: schema.annualSubmissions.kind,
        ok: schema.annualSubmissions.ok,
        code: schema.annualSubmissions.code,
        message: schema.annualSubmissions.message,
        transferTicket: schema.annualSubmissions.transferTicket,
        filedOn: schema.annualSubmissions.filedOn,
        note: schema.annualSubmissions.note,
        amount: sql<number | null>`(${schema.annualSubmissions.figures}->>'amount')::bigint`.mapWith(Number),
        hasPdf: sql<boolean>`${schema.annualSubmissions.protocolPdf} is not null`,
        createdAt: schema.annualSubmissions.createdAt,
      })
      .from(schema.annualSubmissions)
      // Die E-Bilanz steht auf der Abschluss-Seite (ebilanz.ts)
      .where(and(eq(schema.annualSubmissions.year, year), inArray(schema.annualSubmissions.form, ["ust", "euer", "est", "kst", "gewst"])))
      .orderBy(desc(schema.annualSubmissions.createdAt))
      .then((rows) => rows as (Omit<(typeof rows)[number], "form"> & { form: AnnualForm })[])
  );
}

export async function annualOverview(year: number, today: string) {
  const company = await loadCompany();
  const [ust, euer, history] = await Promise.all([ustYear(year), euerYear(year), submissions(year)]);
  const est = await estYear(year, euer);
  const base = [
    ...yearIssues(year, today),
    ...companyIssues(company).map((text): Issue => ({ tone: "fehler", text: `Firmendaten: ${text}`, link: "/einstellungen" })),
  ];
  const sent = (form: AnnualForm) => history.find((h) => h.form === form && h.kind === "send" && h.ok) ?? null;
  // Eine außerhalb von Haben abgegebene Erklärung zählt als erledigt und trägt ihren Betrag (Umsatzsteuer: Abschlusszahlung, EÜR: Gewinn)
  const submitted = (form: AnnualForm) => {
    const vermerk = history.find((h) => h.form === form && h.kind === "vermerk" && h.ok);
    if (!vermerk) return null;
    return {
      id: vermerk.id,
      filedOn: vermerk.filedOn,
      transferTicket: vermerk.transferTicket,
      note: vermerk.note,
      amount: vermerk.amount,
      hasPdf: vermerk.hasPdf,
    };
  };
  // Ein Vermerk „außerhalb von Haben abgegeben“ nimmt den Meldungen zu Habens leerem Jahr den Grund (#869)
  const ustVermerk = submitted("ust");
  const euerVermerk = submitted("euer");
  return {
    year,
    ust: {
      ...ust,
      issues: [...base, ...ustIssues(await kleinunternehmerForYear(year), ust, year, { vermerkt: ustVermerk !== null })],
      sent: sent("ust"),
      submitted: ustVermerk,
    },
    euer: { ...euer, issues: [...base, ...euerIssues(company, euer, { vermerkt: euerVermerk !== null })], sent: sent("euer"), submitted: euerVermerk },
    // Für die Einkommensteuererklärung gibt es keinen Vermerk: Was außerhalb von Haben abgegeben wurde, weiß
    // Haben nicht. Die Seite zeigt sie deshalb nicht als offene Pflicht (#869).
    est: {
      ...est,
      issues: [...base, ...estIssues(company, euer), ...(await homeofficeIssues(year, est))],
      sent: sent("est"),
      submitted: submitted("est"),
      verwaltet: false,
    },
    history,
    versteuerung: await versteuerungForYear(year),
    rechtsform: company.rechtsform,
  };
}

export interface AnnualSubmitOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
  today: string;
}

/** Prüft oder übermittelt eine Jahreserklärung über das ELSTER-Gateway; jeder Versuch wird mit XML und Werten gespeichert. */
export function submitAnnual(actor: string, form: AnnualForm, year: number, client: ElsterClient, options: AnnualSubmitOptions): Promise<ElsterResult> {
  return uebermitteln(client, {
    sperre: `haben.jahreserklaerung.${form}.${year}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: ({ test, herstellerId }) => prepare(form, year, options, test, herstellerId),
    protokollieren: (result, xml, figures) =>
      withActor(actor, (tx) =>
        tx.insert(schema.annualSubmissions).values({
          form,
          year,
          kind: options.kind,
          ok: result.ok,
          code: result.code,
          message: result.message,
          transferTicket: result.transferTicket ?? null,
          figures,
          requestXml: xml,
          responseXml: result.responseXml,
          serverResponseXml: result.serverResponseXml,
          protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
        }),
      ),
  });
}

/** Unter der Sendesperre: Prüfungen, schon übermittelt?, XML und die gespeicherten Werte */
async function prepare(form: AnnualForm, year: number, options: AnnualSubmitOptions, test: boolean, herstellerId: string) {
  // Eine außerhalb von Haben abgegebene Erklärung ersetzt die Echtübermittlung; beides zugleich wäre eine doppelte Abgabe
  if (options.kind === "send") {
    const [vermerkt] = await db
      .select({ id: schema.annualSubmissions.id })
      .from(schema.annualSubmissions)
      .where(and(eq(schema.annualSubmissions.form, form), eq(schema.annualSubmissions.year, year), eq(schema.annualSubmissions.kind, "vermerk")));
    if (vermerkt) throw new AnnualError("Die Erklärung ist außerhalb von Haben abgegeben; eine Übermittlung aus Haben ist nicht mehr vorgesehen.");
  }
  const checked = await checkAnnual(form, year, options.today);
  const [already] = await db
    .select({ id: schema.annualSubmissions.id })
    .from(schema.annualSubmissions)
    .where(
      and(
        eq(schema.annualSubmissions.form, form),
        eq(schema.annualSubmissions.year, year),
        eq(schema.annualSubmissions.kind, "send"),
        eq(schema.annualSubmissions.ok, true),
      ),
    );
  if (already && options.kind === "send") {
    throw new AnnualError("Diese Erklärung ist schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal.");
  }
  return annualXml(form, year, checked, test, herstellerId);
}

type Checked = { company: Awaited<ReturnType<typeof loadCompany>>; data: UstYear | EuerYear };

/** Firmendaten und Werte des Jahres; Fehler aus den Prüfungen brechen ab */
export async function checkAnnual(form: AnnualForm, year: number, today: string): Promise<Checked> {
  const company = await loadCompany();
  // Eine Kapitalgesellschaft bilanziert und zahlt Körperschaftsteuer: keine Anlage EÜR, keine Einkommensteuer
  if (form !== "ust" && isKapitalgesellschaft(company.rechtsform)) {
    throw new AnnualError(`${company.rechtsform === "ug" ? "Eine UG" : "Eine GmbH"} gibt keine Anlage EÜR und keine Einkommensteuererklärung ab.`);
  }
  const data = form === "ust" ? await ustYear(year) : await euerYear(year);
  const formIssues =
    form === "ust"
      ? ustIssues(await kleinunternehmerForYear(year), data as UstYear, year)
      : form === "euer"
        ? euerIssues(company, data as EuerYear)
        : estIssues(company, data as EuerYear);
  const issues = [...yearIssues(year, today), ...companyIssues(company).map((text): Issue => ({ tone: "fehler", text })), ...formIssues].filter(
    (i) => i.tone === "fehler",
  );
  if (issues.length > 0) throw new AnnualError(issues.map((i) => i.text).join(" "));
  return { company, data };
}

/** Das XML der Erklärung und die Werte, die mit einem Versuch gespeichert werden */
export async function annualXml(form: AnnualForm, year: number, { company, data }: Checked, test: boolean, herstellerId: string) {
  const common = {
    year,
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    bundesland: company.bundesland!,
    absender: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    herstellerId,
    produktVersion: PRODUKT_VERSION,
    test,
  };
  let xml: string;
  let figures: Record<string, unknown>;
  if (form === "ust") {
    const ust = data as UstYear;
    // Die Erklärung geht im Folgejahr raus; maßgeblich ist die Versteuerung des Jahres, nicht die aktuelle
    xml = buildUstErklaerungXml({ ...common, versteuerung: await versteuerungForYear(year), figures: ust.figures });
    figures = { ...ust.figures, steuer: ust.steuer, abschluss: ust.abschluss };
  } else if (form === "est") {
    const euer = data as EuerYear;
    const est = await estYear(year, euer);
    const t = company.taxpayer;
    xml = buildEstXml({
      ...common,
      personA: t.a!,
      ...(est.zusammen ? { personB: t.b!, verheiratetSeit: t.verheiratetSeit! } : {}),
      anschrift: { strasse: company.strasse, plz: company.plz, ort: company.ort },
      telefon: company.telefon,
      iban: company.iban || undefined,
      gewinn: { einkunftsart: company.einkunftsart!, taetigkeit: company.taetigkeit, betrag: est.gewinn },
      angaben: est.angaben,
    });
    // Welche Vorauszahlungen um den Jahreswechsel der Gewinn verschiebt; danach richten sich beide Jahre (#583, euer-jahreswechsel.ts)
    figures = { ...est.angaben, gewinn: est.gewinn, zusammen: est.zusammen, [ZEHN_TAGE_REGEL]: euer.zehnTage };
  } else {
    const euer = data as EuerYear;
    xml = buildEuerXml({
      ...common,
      allgemein: { artDesBetriebs: company.taetigkeit.trim(), einkunftsart: company.einkunftsart! },
      figures: euer.figures,
      anlagen: euer.anlagen,
    });
    figures = { ...euer.figures, gewinn: euer.gewinn, anlagen: euer.anlagen, [ZEHN_TAGE_REGEL]: euer.zehnTage };
  }

  return { xml, daten: figures };
}

export async function loadAnnualProtocol(id: string) {
  const [row] = await db
    .select({ form: schema.annualSubmissions.form, year: schema.annualSubmissions.year, pdf: schema.annualSubmissions.protocolPdf })
    .from(schema.annualSubmissions)
    .where(eq(schema.annualSubmissions.id, id));
  if (!row?.pdf) return null;
  const name = {
    ust: "Umsatzsteuererklaerung",
    euer: "EUER",
    est: "Einkommensteuererklaerung",
    kst: "Koerperschaftsteuererklaerung",
    gewst: "Gewerbesteuererklaerung",
    ebilanz: "E-Bilanz",
  }[row.form];
  return { pdf: row.pdf, filename: `${name}-${row.year}-Protokoll.pdf` };
}
