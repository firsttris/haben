import { isKapitalgesellschaft, toElsterSteuernummer, type KapgSteuerAngaben, type KapgSteuern } from "@haben/core";
import {
  buildGewStXml,
  buildKstXml,
  GEWST_JAHRE,
  KST_JAHRE,
  kstBerechnung,
  type ElsterClient,
  type ElsterResult,
  type GewStXmlInput,
  type KstXmlInput,
} from "@haben/elster";
import { desc, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { einlagekontoJahr } from "../ausschuettung/index.ts";
import { jahresabschluss } from "../buchhaltung/index.ts";
import { PRODUKT_VERSION, uebermitteln } from "../elster/index.ts";
import { companyIssues, loadCompany, type Company } from "../stammdaten/index.ts";
import { kapgErklaerungAngaben, kapgSteuernJahr, KoerperschaftError, type KapgErklaerungAngaben } from "./koerperschaft.ts";

/*
 * Körperschaft- und Gewerbesteuererklärung einer GmbH oder UG über ELSTER: Werte aus der Steuerberechnung des Jahres
 * (koerperschaft.ts), dazu die Angaben zur Erklärung (Anteilseigner, Verträge, Gründung). Prüfen, Test und Senden wie
 * die anderen Jahreserklärungen über das ELSTER-Gateway, Protokoll in annual_submissions (Formular kst bzw. gewst).
 * Echt gesendet wird erst, wenn das Jahr abgeschlossen ist: Die Erklärung beruht auf dem Jahresabschluss.
 */

export type KapgForm = "kst" | "gewst";

export interface KapgHinweis {
  tone: "fehler" | "hinweis";
  text: string;
  link?: "/einstellungen" | "/abschluss";
}

const FORM_NAME: Record<KapgForm, string> = { kst: "Körperschaftsteuererklärung", gewst: "Gewerbesteuererklärung" };
const JAHRE: Record<KapgForm, readonly number[]> = { kst: KST_JAHRE, gewst: GEWST_JAHRE };

interface Grundlagen {
  company: Company;
  steuern: KapgSteuern | null;
  /** Hebesatz und Vorträge des Jahres, auf denen steuern beruht */
  steuerAngaben: KapgSteuerAngaben | null;
  erklaerung: KapgErklaerungAngaben;
  closed: boolean;
  /** Fehler aus dem Jahresabschluss (Jahr nicht vorbei, offene Belege, AfA) */
  abschlussFehler: string[];
  /** Ausschüttungen des Jahres, Eigen- und Nennkapital für die Anlage KSt 1 F */
  einlagekonto: Awaited<ReturnType<typeof einlagekontoJahr>>;
}

async function grundlagen(year: number, today: string): Promise<Grundlagen | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const [jahr, { angaben }, abschluss, einlagekonto] = await Promise.all([
    kapgSteuernJahr(year),
    kapgErklaerungAngaben(year),
    jahresabschluss(year, today),
    einlagekontoJahr(company, year),
  ]);
  return {
    company,
    steuern: jahr?.gespeichert ? jahr.steuern : null,
    steuerAngaben: jahr?.gespeichert ? jahr.angaben : null,
    erklaerung: angaben,
    closed: abschluss.kapitalgesellschaft ? Boolean(abschluss.status) : false,
    abschlussFehler: abschluss.kapitalgesellschaft ? abschluss.issues.filter((i) => i.tone === "fehler").map((i) => i.text) : [],
    einlagekonto,
  };
}

function issuesFor(form: KapgForm, year: number, g: Grundlagen): KapgHinweis[] {
  const issues: KapgHinweis[] = [
    ...(JAHRE[form].includes(year)
      ? []
      : [{ tone: "fehler" as const, text: `Die ${FORM_NAME[form]} kennt Haben für ${JAHRE[form].join(" und ")}, nicht für ${year}.` }]),
    ...companyIssues(g.company).map((text) => ({ tone: "fehler" as const, text: `Firmendaten: ${text}`, link: "/einstellungen" as const })),
    ...g.abschlussFehler.map((text) => ({ tone: "fehler" as const, text, link: "/abschluss" as const })),
  ];
  if (!g.steuern) issues.push({ tone: "fehler", text: "Hebesatz und Verlustvorträge fehlen; sie stehen beim Jahresabschluss.", link: "/abschluss" });
  if (form === "kst" && g.erklaerung.anteilseigner.length === 0) issues.push({ tone: "fehler", text: "Die Anteilseigner fehlen." });
  if (form === "gewst" && !g.company.taetigkeit.trim()) {
    issues.push({ tone: "fehler", text: "Der Gegenstand des Unternehmens (Art des Betriebs) fehlt.", link: "/einstellungen" });
  }
  if (!g.closed) issues.push({ tone: "hinweis", text: `Echt senden lässt sich die Erklärung erst, wenn ${year} abgeschlossen ist.`, link: "/abschluss" });
  return issues;
}

function common(year: number, company: Company, test: boolean, herstellerId: string) {
  return {
    year,
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    bundesland: company.bundesland!,
    absender: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    herstellerId,
    produktVersion: PRODUKT_VERSION,
    test,
  };
}

const rechtsform = (company: Company) => (company.rechtsform === "ug" ? "ug" : "gmbh");

type Bereit = Grundlagen & { steuern: KapgSteuern; steuerAngaben: KapgSteuerAngaben };

/** Werte der Körperschaftsteuererklärung aus Berechnung und Angaben; die Summen rechnet der Baustein selbst */
export function kstInput(year: number, g: Bereit, test: boolean, herstellerId: string): KstXmlInput {
  const h = { kst: 0, soli: 0, kapest: 0, gewst: 0, sonstige: 0 };
  for (const z of g.steuern.hinzurechnungen) h[z.gk] += z.betrag;
  const e = g.erklaerung;
  return {
    ...common(year, g.company, test, herstellerId),
    rechtsform: rechtsform(g.company),
    sitz: g.company.ort,
    ...(e.gruendung ? { gruendung: e.gruendung } : {}),
    anteilseigner: e.anteilseigner,
    jahresergebnis: g.steuern.jahresergebnis,
    hinzurechnungen: h,
    verlustvortrag: g.steuerAngaben.verlustvortragKst,
    verlustruecktrag: g.steuerAngaben.verlustruecktrag ?? 0,
    einlagekonto: e.einlagekonto,
    ...g.einlagekonto,
    vertraege: e.vertraege,
  };
}

export function gewstInput(year: number, g: Bereit, test: boolean, herstellerId: string): GewStXmlInput {
  const h = { zinsen: 0, beweglich: 0, unbeweglich: 0, rechte: 0 };
  for (const z of g.steuern.gewstHinzurechnungen) h[z.art] += z.brutto;
  return {
    ...common(year, g.company, test, herstellerId),
    rechtsform: rechtsform(g.company),
    gegenstand: g.company.taetigkeit,
    betriebsstaette: { plz: g.company.plz, ort: g.company.ort },
    gewinn: g.steuern.einkommen,
    hinzurechnungen: h,
    rechteBeschraenktStpfl: g.erklaerung.rechteBeschraenktStpfl,
    verlustvortrag: g.steuerAngaben.verlustvortragGewst,
  };
}

async function history(year: number) {
  return db
    .select({
      id: schema.annualSubmissions.id,
      form: schema.annualSubmissions.form,
      kind: schema.annualSubmissions.kind,
      ok: schema.annualSubmissions.ok,
    })
    .from(schema.annualSubmissions)
    .where(eq(schema.annualSubmissions.year, year))
    .orderBy(desc(schema.annualSubmissions.createdAt));
}

/** Stand der beiden Erklärungen für die Seite Jahreserklärung; null für Einzelunternehmen */
export async function kapgErklaerungen(year: number, today: string) {
  const g = await grundlagen(year, today);
  if (!g) return null;
  const sent = await history(year);
  const istGesendet = (form: KapgForm) => sent.some((h) => h.form === form && h.kind === "send" && h.ok);
  const { angaben, gespeichert } = await kapgErklaerungAngaben(year);
  const bereit: Bereit | null = g.steuern && g.steuerAngaben ? { ...g, steuern: g.steuern, steuerAngaben: g.steuerAngaben } : null;
  const s = bereit?.steuern;
  return {
    angaben,
    gespeichert,
    closed: g.closed,
    kst: {
      issues: issuesFor("kst", year, g),
      sent: istGesendet("kst"),
      werte: bereit ? kstBerechnung(kstInput(year, bereit, true, "")) : null,
    },
    gewst: {
      issues: issuesFor("gewst", year, g),
      sent: istGesendet("gewst"),
      werte: s ? { gewinn: s.einkommen, gewerbeertrag: s.gewerbeertrag, messbetrag: s.messbetrag, gewst: s.gewst } : null,
    },
  };
}

export interface KapgSubmitOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
  today: string;
}

/** Prüft oder übermittelt die Körperschaft- bzw. Gewerbesteuererklärung; jeder Versuch steht mit XML und Werten im Protokoll */
export function submitKapg(actor: string, form: KapgForm, year: number, client: ElsterClient, options: KapgSubmitOptions): Promise<ElsterResult> {
  return uebermitteln(client, {
    sperre: `haben.jahreserklaerung.${form}.${year}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const g = await grundlagen(year, options.today);
      if (!g) throw new KoerperschaftError(`Die ${FORM_NAME[form]} gibt es nur für GmbH und UG.`);
      const blocking = issuesFor(form, year, g).filter((i) => i.tone === "fehler");
      if (blocking.length > 0) throw new KoerperschaftError(blocking.map((i) => i.text).join(" "));
      if (options.kind === "send") {
        if (!g.closed) throw new KoerperschaftError(`Das Jahr ${year} ist noch nicht abgeschlossen.`);
        if ((await history(year)).some((h) => h.form === form && h.kind === "send" && h.ok)) {
          throw new KoerperschaftError(`Diese ${FORM_NAME[form]} ist schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal.`);
        }
      }
      const withSteuern: Bereit = { ...g, steuern: g.steuern!, steuerAngaben: g.steuerAngaben! };
      if (form === "kst") {
        const input = kstInput(year, withSteuern, test, herstellerId);
        return { xml: buildKstXml(input), daten: { ...kstBerechnung(input), anteilseigner: input.anteilseigner.length } as Record<string, unknown> };
      }
      const input = gewstInput(year, withSteuern, test, herstellerId);
      return { xml: buildGewStXml(input), daten: { gewinn: input.gewinn, hinzurechnungen: input.hinzurechnungen, verlustvortrag: input.verlustvortrag } };
    },
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
