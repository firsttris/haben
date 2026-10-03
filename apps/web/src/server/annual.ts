import { ACCOUNTS, taxOf, toElsterSteuernummer, toWholeEuros, type Cents, type Prognose, type EuerResult, type ExpenseCategory, type PauschaleArt, homeofficeSatz } from "@haben/core";
import {
  buildEstXml,
  buildEuerXml,
  buildUstErklaerungXml,
  splitStrasse,
  ERSTES_ERKLAERUNGSJAHR,
  euerTotals,
  TEST_HERSTELLER_ID,
  ustErklaerungResult,
  type AveuerAnlage,
  type ElsterClient,
  type ElsterResult,
  type EstAngaben,
  type EuerFigureKey,
  type EuerFigures,
  type UstErklaerungFigures,
} from "@haben/elster";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { listAssets } from "./assets.ts";
import { companyIssues, loadCompany, type Company } from "./company.ts";
import { decrypt } from "./crypto.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { loadEstAngaben, prognose } from "./income-tax.ts";
import { listPauschalen } from "./pauschalen.ts";
import { euerForYear } from "./reports.ts";
import { computeVatFigures } from "./vat-figures.ts";
import { loadActiveCertificate, PRODUKT_VERSION } from "./vat.ts";

export class AnnualError extends Error {}

export type AnnualForm = "ust" | "euer" | "est";

export interface Issue {
  /** fehler: nicht sendbar; hinweis: sendbar, aber prüfen */
  tone: "fehler" | "hinweis";
  text: string;
  link?: "/einstellungen" | "/anlagen" | "/umsatzsteuer" | "/bank" | "/pauschalen";
}

// ------------------------------------------------------------------ Umsatzsteuererklärung

export interface UstYear {
  figures: UstErklaerungFigures;
  steuer: Cents;
  abschluss: Cents;
  /** Umsätze, die Haben (noch) nicht in die Erklärung schreiben kann */
  kz21: Cents;
  kz45: Cents;
  kz48: Cents;
  /** Monate ohne gesendete Voranmeldung */
  missingMonths: number[];
}

/** Zahlen der Umsatzsteuererklärung: Summe der zwölf Monate aus den Buchungen, Vorauszahlungen aus den gesendeten Voranmeldungen */
export async function ustYear(year: number): Promise<UstYear> {
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => computeVatFigures({ year, month: i + 1 })));
  const total = (key: "kz81" | "kz86" | "kz21" | "kz45" | "kz48" | "kz66") => months.reduce((s, m) => s + m[key], 0);
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

  const figures: UstErklaerungFigures = {
    base19,
    tax19: taxOf(base19, 1900),
    base7,
    tax7: taxOf(base7, 700),
    vorsteuer: total("kz66"),
    vorauszahlungen: [...latest.values()].reduce((s, v) => s + v, 0),
  };
  return {
    figures,
    ...ustErklaerungResult(figures),
    kz21: total("kz21"),
    kz45: total("kz45"),
    kz48: total("kz48"),
    missingMonths: Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !latest.has(m)),
  };
}

function ustIssues(company: Company, data: UstYear): Issue[] {
  const issues: Issue[] = [];
  if (company.kleinunternehmer) {
    issues.push({ tone: "fehler", text: "Als Kleinunternehmer gibst du ab 2024 keine Umsatzsteuererklärung mehr ab, außer das Finanzamt fordert dazu auf." });
  }
  const unsupported = [
    data.kz21 !== 0 && "Leistungen im EU-Ausland (Reverse Charge, Kz 21)",
    data.kz45 !== 0 && "nicht steuerbare Umsätze im Drittland (Kz 45)",
    data.kz48 !== 0 && "steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48)",
  ].filter(Boolean);
  if (unsupported.length > 0) {
    issues.push({
      tone: "fehler",
      text: `Das Jahr enthält ${unsupported.join(", ")}. Diese Zeilen kann Haben noch nicht übermitteln; gib die Erklärung mit den Werten unten im ELSTER-Portal ab.`,
    });
  }
  if (data.figures.tax19 + data.figures.tax7 === 0 && data.figures.vorsteuer === 0) {
    issues.push({ tone: "fehler", text: "Keine Umsätze und keine Vorsteuer: eine Nullerklärung geht über das ELSTER-Portal." });
  }
  if (data.missingMonths.length > 0 && !company.kleinunternehmer) {
    issues.push({
      tone: "hinweis",
      text: `${data.missingMonths.length === 12 ? "Für keinen Monat gibt es" : `Für ${data.missingMonths.length} Monat${data.missingMonths.length === 1 ? "" : "e"} fehlt`} eine in Haben gesendete Voranmeldung. Als Vorauszahlungssoll zählen nur diese; Voranmeldungen aus einem anderen Programm fehlen darin.`,
      link: "/umsatzsteuer",
    });
  }
  return issues;
}

// ------------------------------------------------------------------ Anlage EÜR

/** Kategorie der Belege → Zeile der Anlage EÜR */
export const EUER_CATEGORY_FIELDS: Record<Exclude<ExpenseCategory, "anlage">, EuerFigureKey> = {
  software: "edv",
  edv: "edv",
  hardware: "gwg",
  telefon: "telekommunikation",
  internet: "telekommunikation",
  buero: "arbeitsmittel",
  literatur: "arbeitsmittel",
  porto: "arbeitsmittel",
  fortbildung: "fortbildung",
  fahrtkosten: "kfzSonstige",
  uebernachtung: "reisekosten",
  werbung: "werbung",
  beratung: "beratung",
  buchfuehrung: "beratung",
  fremdleistung: "fremdleistungen",
  geldverkehr: "uebrige",
  kfzBetrieb: "kfzSonstige",
  kfzVersicherung: "kfzSteuerVersicherung",
  kfzSteuer: "kfzSteuerVersicherung",
  kfzReparatur: "kfzSonstige",
  kfzLeasing: "kfzLeasing",
  versicherung: "beitraegeVersicherungen",
  beitraege: "beitraegeVersicherungen",
  sonstiges: "uebrige",
};

/** Pauschalen ohne Beleg: Homeoffice als Tagespauschale, Fahrten als Nutzungseinlage, Verpflegung als beschränkt abziehbar */
const PAUSCHALE_FIELDS: Record<PauschaleArt, EuerFigureKey> = {
  homeoffice: "tagespauschale",
  fahrt: "fahrtNutzungseinlage",
  verpflegung: "verpflegung",
};

/** Verteilt die EÜR von Haben auf die Zeilen der Anlage EÜR. Summen und Gewinn bleiben gleich. */
export function euerFigures(euer: EuerResult): EuerFigures {
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
        vereinnahmteUst: "vereinnahmteUst",
        ustEntnahmen: "vereinnahmteUst",
        erstatteteUst: "erstatteteUst",
        afa: "afaBeweglich",
        gwg: "gwg",
        sammelposten: "sammelposten",
        restbuchwert: "restbuchwert",
        vorsteuer: "vorsteuer",
        gezahlteUst: "gezahlteUst",
      } as const
    )[line.key as Exclude<EuerResult["einnahmen"][number]["key"], `ausgabe:${string}` | `pauschale:${string}`>];
    add(key, line.amount);
  }
  return figures;
}

/** Entnahmen und Einlagen laut Journal (Privatkonten) */
async function privateMovements(year: number, kontenrahmen: Company["kontenrahmen"]) {
  const accounts = ACCOUNTS[kontenrahmen];
  const rows = await db
    .select({
      account: schema.journalLines.account,
      saldo: sql<string>`coalesce(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(
      and(
        inArray(schema.journalLines.account, [accounts.privatentnahmen, accounts.privateinlagen]),
        gte(schema.journalEntries.date, `${year}-01-01`),
        lt(schema.journalEntries.date, `${year + 1}-01-01`),
      ),
    )
    .groupBy(schema.journalLines.account);
  const saldo = (account: string) => Number(rows.find((r) => r.account === account)?.saldo ?? 0);
  return { entnahmen: saldo(accounts.privatentnahmen), einlagen: -saldo(accounts.privateinlagen) || 0 };
}

export interface EuerYear {
  figures: EuerFigures;
  einnahmen: Cents;
  ausgaben: Cents;
  gewinn: Cents;
  anlagen: AveuerAnlage[];
  /** Anlagen, deren AfA bzw. Privatnutzung für das Jahr noch nicht gebucht ist */
  pendingAssets: number;
}

export async function euerYear(year: number): Promise<EuerYear> {
  const company = await loadCompany();
  const [euer, movements, assets] = await Promise.all([euerForYear(year), privateMovements(year, company.kontenrahmen), listAssets(year)]);
  const figures: EuerFigures = { ...euerFigures(euer), ...movements };
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
    }));
  return { figures, ...euerTotals(figures), anlagen, pendingAssets: assets.filter((a) => a.pending).length };
}

function euerIssues(company: Company, data: EuerYear): Issue[] {
  const issues: Issue[] = [];
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
  if (data.einnahmen === 0 && data.ausgaben === 0) issues.push({ tone: "fehler", text: "Keine Betriebseinnahmen und -ausgaben im Jahr." });
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

export async function estYear(year: number, euer?: EuerYear): Promise<EstYear> {
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
    ...([
      ["a", t.a?.vorname],
      ["b", zusammen ? t.b?.vorname : undefined],
    ] as const).map(([p, vorname]) =>
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
  if (company.strasse && !splitStrasse(company.strasse)) issues.push({ tone: "fehler", text: "In der Anschrift fehlt die Hausnummer.", link: "/einstellungen" });
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
  return db
    .select({
      id: schema.annualSubmissions.id,
      form: schema.annualSubmissions.form,
      kind: schema.annualSubmissions.kind,
      ok: schema.annualSubmissions.ok,
      code: schema.annualSubmissions.code,
      message: schema.annualSubmissions.message,
      transferTicket: schema.annualSubmissions.transferTicket,
      hasPdf: sql<boolean>`${schema.annualSubmissions.protocolPdf} is not null`,
      createdAt: schema.annualSubmissions.createdAt,
    })
    .from(schema.annualSubmissions)
    .where(eq(schema.annualSubmissions.year, year))
    .orderBy(desc(schema.annualSubmissions.createdAt));
}

export async function annualOverview(year: number, today: string) {
  const company = await loadCompany();
  const [ust, euer, history] = await Promise.all([ustYear(year), euerYear(year), submissions(year)]);
  const est = await estYear(year, euer);
  const base = [...yearIssues(year, today), ...companyIssues(company).map((text): Issue => ({ tone: "fehler", text: `Firmendaten: ${text}`, link: "/einstellungen" }))];
  const sent = (form: AnnualForm) => history.find((h) => h.form === form && h.kind === "send" && h.ok) ?? null;
  return {
    year,
    ust: { ...ust, issues: [...base, ...ustIssues(company, ust)], sent: sent("ust") },
    euer: { ...euer, issues: [...base, ...euerIssues(company, euer)], sent: sent("euer") },
    est: { ...est, issues: [...base, ...estIssues(company, euer), ...(await homeofficeIssues(year, est))], sent: sent("est") },
    history,
    versteuerung: company.versteuerung,
  };
}

export interface AnnualSubmitOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
  today: string;
}

/** Prüft oder übermittelt eine Jahreserklärung; jeder Versuch wird mit XML und Werten gespeichert. */
export async function submitAnnual(
  actor: string,
  form: AnnualForm,
  year: number,
  client: ElsterClient,
  options: AnnualSubmitOptions,
): Promise<ElsterResult> {
  const company = await loadCompany();
  const data = form === "ust" ? await ustYear(year) : await euerYear(year);
  const formIssues =
    form === "ust" ? ustIssues(company, data as UstYear) : form === "euer" ? euerIssues(company, data as EuerYear) : estIssues(company, data as EuerYear);
  const issues = [
    ...yearIssues(year, options.today),
    ...companyIssues(company).map((text): Issue => ({ tone: "fehler", text })),
    ...formIssues,
  ].filter((i) => i.tone === "fehler");
  if (issues.length > 0) throw new AnnualError(issues.map((i) => i.text).join(" "));

  const [already] = await db
    .select({ id: schema.annualSubmissions.id })
    .from(schema.annualSubmissions)
    .where(and(eq(schema.annualSubmissions.form, form), eq(schema.annualSubmissions.year, year), eq(schema.annualSubmissions.kind, "send"), eq(schema.annualSubmissions.ok, true)));
  if (already && options.kind === "send") {
    throw new AnnualError("Diese Erklärung ist schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal.");
  }

  const test = options.kind !== "send";
  const herstellerId = test ? TEST_HERSTELLER_ID : options.herstellerId;
  if (!herstellerId) throw new AnnualError("Für die Echtübermittlung fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
  if (!test && "isFake" in client && client.isFake) {
    throw new AnnualError("Ohne ERiC ist keine Echtübermittlung möglich; Prüfen und Testübermittlung laufen nur simuliert.");
  }

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
    xml = buildUstErklaerungXml({ ...common, versteuerung: company.versteuerung, figures: ust.figures });
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
    figures = { ...est.angaben, gewinn: est.gewinn, zusammen: est.zusammen };
  } else {
    const euer = data as EuerYear;
    xml = buildEuerXml({
      ...common,
      allgemein: { artDesBetriebs: company.taetigkeit.trim(), einkunftsart: company.einkunftsart! },
      figures: euer.figures,
      anlagen: euer.anlagen,
    });
    figures = { ...euer.figures, gewinn: euer.gewinn, anlagen: euer.anlagen };
  }

  let result: ElsterResult;
  if (options.kind === "validate") {
    result = await client.validate(xml);
  } else {
    if (!options.pin) throw new AnnualError("Die Zertifikats-PIN fehlt.");
    const certificate = await loadActiveCertificate();
    if (!certificate) throw new AnnualError("Es ist kein ELSTER-Zertifikat hinterlegt.");
    result = await client.send(xml, decrypt(certificate.ciphertext), options.pin, { test });
  }

  await withActor(actor, (tx) =>
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
  );
  return result;
}

export async function loadAnnualProtocol(id: string) {
  const [row] = await db
    .select({ form: schema.annualSubmissions.form, year: schema.annualSubmissions.year, pdf: schema.annualSubmissions.protocolPdf })
    .from(schema.annualSubmissions)
    .where(eq(schema.annualSubmissions.id, id));
  if (!row?.pdf) return null;
  const name = { ust: "Umsatzsteuererklaerung", euer: "EUER", est: "Einkommensteuererklaerung" }[row.form];
  return { pdf: row.pdf, filename: `${name}-${row.year}-Protokoll.pdf` };
}

