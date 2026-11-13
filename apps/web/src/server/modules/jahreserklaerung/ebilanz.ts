import {
  anlagenspiegelZeile,
  ebilanzPosition,
  ebilanzZuordnung,
  isKapitalgesellschaft,
  toElsterSteuernummer,
  type AnlagenspiegelZeile,
  type Cents,
  type Kontenrahmen,
} from "@haben/core";
import {
  buildEbilanzXml,
  EbilanzError,
  type EbilanzKontensaldo,
  ebilanzKontensalden,
  ebilanzPruefen,
  type EbilanzTaxonomie,
  ebilanzTaxonomie,
  ebilanzWerte,
  type ElsterClient,
  type ElsterResult,
} from "@haben/elster";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { accountName, ebilanzDavon, jahresabschluss, ledgerRange, listAssets, saldenliste } from "../buchhaltung/index.ts";
import { ericKennt, PRODUKT_VERSION, uebermitteln } from "../elster/index.ts";
import { companyIssues, loadCompany, type Company } from "../stammdaten/index.ts";

/*
 * E-Bilanz (§ 5b EStG) einer GmbH oder UG: Bilanz und GuV in der HGB-Taxonomie des Wirtschaftsjahres (6.9 bis 2026, 6.10
 * ab 2027, ebilanzTaxonomie in @haben/elster) aus den Salden des Jahres (Kontenzuordnung in @haben/core, ebilanz.ts), mit
 * dem Kontennachweis je Konto, Betriebsvermögensvergleich aus den Eigenkapitalkonten, Anlagenspiegel
 * aus dem Anlagenverzeichnis, Davon-Positionen zu Restlaufzeiten aus den bestätigten Angaben (§ 268 Abs. 4 und 5 HGB;
 * die Taxonomie verlangt sie nicht, sie gehören aber zur Handelsbilanz). Prüfen, Test und Senden laufen wie die Jahreserklärungen über das ELSTER-Gateway und
 * stehen im selben Protokoll (annual_submissions, Formular „ebilanz“). Echt gesendet wird nur ein abgeschlossenes Jahr.
 */

export class EbilanzSubmitError extends UserError {}

export interface EbilanzHinweis {
  tone: "fehler" | "hinweis";
  text: string;
}

export interface EbilanzDaten {
  taxonomie: EbilanzTaxonomie;
  werte: Record<string, Cents>;
  /** Kontennachweis: Saldo je Konto auf seiner Position */
  konten: EbilanzKontensaldo[];
  bvv: { eigenkapitalVorjahr: Cents; ausschuettungen: Cents; einlagen: Cents };
  anlagen: AnlagenspiegelZeile[];
}

const EIGENKAPITAL = "bs.eqLiab.equity.";

/**
 * Betriebsvermögensvergleich aus den Eigenkapitalkonten: Eigenkapital am Ende des Vorjahres ist ihr EB-Wert (Vortrag und
 * Eröffnungsbuchungen), Einlagen sind die Buchungen im Haben des Jahres, Ausschüttungen die im Soll. Das Jahresergebnis
 * steht auf keinem Konto (Haben schließt die GuV nicht ab), deshalb ergibt der Vergleich genau die GuV.
 */
function betriebsvermoegen(
  kontenrahmen: Kontenrahmen,
  rows: readonly { account: string; vortrag: Cents; sollJahr: Cents; habenJahr: Cents }[],
): EbilanzDaten["bvv"] {
  const equity = rows.filter((r) => ebilanzPosition(kontenrahmen, r.account, 1)?.startsWith(EIGENKAPITAL));
  return {
    eigenkapitalVorjahr: -equity.reduce((sum, r) => sum + r.vortrag, 0),
    einlagen: equity.reduce((sum, r) => sum + r.habenJahr, 0),
    ausschuettungen: equity.reduce((sum, r) => sum + r.sollJahr, 0),
  };
}

/** Werte, BVV und Anlagenspiegel des Jahres und was die Übermittlung hindert */
export async function ebilanzDaten(year: number, company: Company): Promise<{ daten: EbilanzDaten; issues: EbilanzHinweis[] }> {
  const kontenrahmen = company.kontenrahmen;
  const rows = (await saldenliste(ledgerRange(year), { aufgeloest: true })).filter((r) => r.kontenrahmen === kontenrahmen);
  const { zuordnung, fehlend } = ebilanzZuordnung(kontenrahmen, rows);
  const konto = (account: string) => `${account}${accountName(kontenrahmen, account) ? ` ${accountName(kontenrahmen, account)}` : ""}`;
  const issues: EbilanzHinweis[] = fehlend.map(({ account }) => ({
    tone: "fehler",
    text: account.startsWith("9")
      ? `Konto ${konto(account)} ist nicht ausgeglichen; die E-Bilanz braucht eine vollständige Eröffnung.`
      : `Konto ${konto(account)} hat keine Position in der E-Bilanz; umbuchen oder die E-Bilanz von der Steuerberatung senden lassen.`,
  }));
  const anlagen: AnlagenspiegelZeile[] = [];
  for (const asset of await listAssets(year)) {
    const zeile = anlagenspiegelZeile(
      kontenrahmen,
      {
        account: asset.account,
        acquisitionDate: asset.acquisitionDate,
        cost: asset.cost,
        method: asset.method,
        usefulLifeMonths: asset.usefulLifeMonths,
        opening: asset.openingDate && asset.openingBookValue !== null ? { date: asset.openingDate, bookValue: asset.openingBookValue } : null,
        disposalDate: asset.disposalDate,
      },
      asset.schedule,
      year,
    );
    if (zeile) anlagen.push(zeile);
  }
  const davon = (await ebilanzDavon(year, kontenrahmen)) ?? {};
  const taxonomie = ebilanzTaxonomie(year);
  return {
    daten: {
      taxonomie,
      werte: { ...ebilanzWerte(zuordnung, taxonomie), ...davon },
      konten: ebilanzKontensalden(zuordnung, (account) => accountName(kontenrahmen, account), taxonomie),
      bvv: betriebsvermoegen(kontenrahmen, rows),
      anlagen,
    },
    issues,
  };
}

function xmlFor(year: number, company: Company, daten: EbilanzDaten, test: boolean, herstellerId: string, erstellt: string): string {
  return buildEbilanzXml({
    year,
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    firma: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort, telefon: company.telefon, email: company.email },
    ...daten,
    herstellerId,
    produktVersion: PRODUKT_VERSION,
    test,
    erstellt,
  });
}

export async function ebilanzSubmissions(year: number) {
  return (
    db
      .select({
        id: schema.annualSubmissions.id,
        kind: schema.annualSubmissions.kind,
        ok: schema.annualSubmissions.ok,
        code: schema.annualSubmissions.code,
        message: schema.annualSubmissions.message,
        transferTicket: schema.annualSubmissions.transferTicket,
        hasPdf: sql<boolean>`${schema.annualSubmissions.protocolPdf} is not null`,
        createdAt: schema.annualSubmissions.createdAt,
      })
      .from(schema.annualSubmissions)
      // Ein Vermerk gilt nur für Umsatzsteuererklärung und Anlage EÜR; die E-Bilanz kennt nur Prüfung, Test und Sendung.
      // Der Filter bleibt, damit später ergänzte Arten nicht im Verlauf der E-Bilanz auftauchen; er verengt den Typ nicht.
      .where(
        and(
          eq(schema.annualSubmissions.form, "ebilanz"),
          eq(schema.annualSubmissions.year, year),
          inArray(schema.annualSubmissions.kind, ["validate", "test", "send"]),
        ),
      )
      .orderBy(desc(schema.annualSubmissions.createdAt))
  );
}

/** Stand der E-Bilanz eines Jahres für die Abschluss-Seite; null für Einzelunternehmen */
export async function ebilanzOverview(year: number, today: string) {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const issues = await ebilanzIssues(year, today, company);
  const history = await ebilanzSubmissions(year);
  return { taxonomie: ebilanzTaxonomie(year), issues, history, sent: history.find((h) => h.kind === "send" && h.ok) ?? null };
}

/**
 * Alles, was gegen die Übermittlung spricht: Firmendaten, offene Punkte des Abschlusses, Konten ohne Position und
 * Widersprüche, die erst der Baustein findet (Anlagenspiegel gegen Bilanz, Betriebsvermögensvergleich gegen GuV).
 */
async function ebilanzIssues(year: number, today: string, company: Company): Promise<EbilanzHinweis[]> {
  const abschluss = await jahresabschluss(year, today);
  const taxonomie = ebilanzTaxonomie(year);
  const base: EbilanzHinweis[] = [
    ...companyIssues(company).map((text) => ({ tone: "fehler" as const, text: `Firmendaten: ${text}` })),
    ...(ericKennt(`Bilanz_${taxonomie}`)
      ? []
      : [
          {
            tone: "fehler" as const,
            // BMF-Schreiben vom 8. Juni 2026; das Plugin bringt erst ERiC 45 mit (ERiC-Releasenotes 45.1, Kap. 3.1.8)
            text: `Für ${year} gilt die HGB-Taxonomie ${taxonomie}, die das installierte ERiC nicht prüfen kann. Unter Einstellungen › ERiC eine Version ab 45 installieren.`,
          },
        ]),
    ...(abschluss.kapitalgesellschaft ? abschluss.issues.filter((i) => i.tone === "fehler") : []),
    ...(abschluss.kapitalgesellschaft && !abschluss.status
      ? [{ tone: "hinweis" as const, text: `Echt senden lässt sich die E-Bilanz erst, wenn ${year} abgeschlossen ist.` }]
      : []),
    ...((await ebilanzDavon(year, company.kontenrahmen))
      ? []
      : [{ tone: "hinweis" as const, text: "Ohne bestätigte Restlaufzeiten fehlen die Davon-Positionen zu Restlaufzeiten bis und über einem Jahr." }]),
  ];
  if (base.some((i) => i.tone === "fehler")) return base;
  const { daten, issues } = await ebilanzDaten(year, company);
  if (issues.length > 0) return [...base, ...issues];
  try {
    ebilanzPruefen({ year, ...daten });
  } catch (error) {
    if (!(error instanceof EbilanzError)) throw error;
    return [...base, { tone: "fehler", text: error.message }];
  }
  return base;
}

export interface EbilanzSubmitOptions {
  kind: "validate" | "test" | "send";
  pin?: string;
  herstellerId?: string;
  today: string;
}

/** Prüft oder übermittelt die E-Bilanz über das ELSTER-Gateway; jeder Versuch wird mit XML und Werten gespeichert. */
export function submitEbilanz(actor: string, year: number, client: ElsterClient, options: EbilanzSubmitOptions): Promise<ElsterResult> {
  return uebermitteln(client, {
    sperre: `haben.jahreserklaerung.ebilanz.${year}`,
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    vorbereiten: async ({ test, herstellerId }) => {
      const company = await loadCompany();
      if (!isKapitalgesellschaft(company.rechtsform)) throw new EbilanzSubmitError("Eine E-Bilanz übermittelt Haben nur für GmbH und UG.");
      const blocking = (await ebilanzIssues(year, options.today, company)).filter((i) => i.tone === "fehler");
      if (blocking.length > 0) throw new EbilanzSubmitError(blocking.map((i) => i.text).join(" "));
      if (options.kind === "send") {
        const abschluss = await jahresabschluss(year, options.today);
        if (!abschluss.kapitalgesellschaft || !abschluss.status) throw new EbilanzSubmitError(`Das Jahr ${year} ist noch nicht abgeschlossen.`);
        if ((await ebilanzSubmissions(year)).some((h) => h.kind === "send" && h.ok)) {
          throw new EbilanzSubmitError("Diese E-Bilanz ist schon übermittelt. Eine berichtigte geht über die Steuerberatung oder das ELSTER-Portal.");
        }
      }
      const { daten } = await ebilanzDaten(year, company);
      return { xml: xmlFor(year, company, daten, test, herstellerId, options.today), daten };
    },
    protokollieren: (result, xml, daten) =>
      withActor(actor, (tx) =>
        tx.insert(schema.annualSubmissions).values({
          form: "ebilanz",
          year,
          kind: options.kind,
          ok: result.ok,
          code: result.code,
          message: result.message,
          transferTicket: result.transferTicket ?? null,
          figures: { ...daten },
          requestXml: xml,
          responseXml: result.responseXml,
          serverResponseXml: result.serverResponseXml,
          protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
        }),
      ),
  });
}
