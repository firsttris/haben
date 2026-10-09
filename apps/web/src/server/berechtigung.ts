import {
  buildSpezRechtAntragXml,
  buildSpezRechtFreischaltungXml,
  buildSpezRechtListeXml,
  buildSpezRechtStornoXml,
  parseBrmRueckgabe,
  parseSpezRechtAntragAntwort,
  parseSpezRechtListe,
  parseSpezRechtStatus,
  type ElsterClient,
  type ElsterResult,
} from "@haben/elster";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { loadCompany } from "./company.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";
import { FinanzamtError } from "./finanzamt.ts";
import { prepareElsterAbruf } from "./vast.ts";

/**
 * Berechtigung, die Belege des Ehegatten (Person B) abzurufen. Ablauf bei ELSTER:
 * 1. Antrag mit Steuer-ID und Geburtsdatum des Ehegatten; ELSTER schickt ihm einen Brief mit Freischaltcode,
 * 2. Freischaltung mit diesem Code vor Ablauf von „genehmigen bis“, danach ist die Berechtigung genehmigt,
 * 3. Widerruf jederzeit. Die Liste zeigt den Stand aller eigenen Anträge.
 * Jeder Schritt landet unveränderlich in brm_requests; der Stand ergibt sich aus dem Verlauf.
 */

export interface BrmOptions {
  kind: "test" | "send";
  /** leer: die gespeicherte PIN (beim Postfachabruf hinterlegt, gilt für alle Abrufe mit dem Zertifikat) */
  pin?: string;
  herstellerId?: string;
}

export interface Berechtigung {
  antragsId: string;
  status: string;
  genehmigenBis: string | null;
  gueltigBis: string | null;
  test: boolean;
  beantragtAm: Date;
  aktualisiertAm: Date;
}

export interface BrmSummary {
  ok: boolean;
  message: string;
  berechtigung: Berechtigung | null;
}

type Art = (typeof schema.brmRequests.$inferInsert)["art"];

async function ehegatte() {
  const company = await loadCompany();
  const b = company.taxpayer.b;
  if (!b) throw new FinanzamtError("Angaben zum Ehegatten fehlen (Einstellungen → Persönliche Angaben).");
  const a = company.taxpayer.a;
  const datenlieferant = `${a?.vorname ?? ""} ${a?.name ?? ""}`.trim() || company.name || "Haben";
  return { b, datenlieferant, mail: company.email };
}

/** Sendet einen Schritt und protokolliert ihn; fachliche Fehler im Nutzdatenblock zählen als Fehler */
async function sendBrm(
  actor: string,
  client: ElsterClient,
  options: BrmOptions,
  art: Art,
  build: (input: { datenlieferant: string; herstellerId: string; test: boolean }) => string,
  extract: (result: ElsterResult) => Partial<typeof schema.brmRequests.$inferInsert>,
  idnr: string | null,
  datenlieferant: string,
) {
  const { test, herstellerId, pfx, pin } = await prepareElsterAbruf(client, options);
  let xml: string;
  try {
    xml = build({ datenlieferant, herstellerId, test });
  } catch (error) {
    throw new FinanzamtError(error instanceof Error ? error.message : String(error));
  }
  const result = await client.send(xml, pfx, pin, { test, print: false });
  const rueckgabe = result.ok ? parseBrmRueckgabe(result.serverResponseXml) : undefined;
  const ok = result.ok && (rueckgabe?.code ?? 0) === 0;
  const message = result.ok && !ok ? `${rueckgabe!.text} (${rueckgabe!.code})` : result.message;
  await withActor(actor, (tx) =>
    tx.insert(schema.brmRequests).values({
      art,
      dateninhaberIdnr: idnr,
      test,
      ok,
      code: ok ? 0 : (rueckgabe?.code ?? result.code),
      message,
      // Der Freischaltcode gilt nur einmal und bleibt aus Datenbank und Audit-Log heraus
      requestXml: xml.replace(/<Freischaltcode>[^<]*<\/Freischaltcode>/, "<Freischaltcode>XXXX-XXXX-XXXX</Freischaltcode>"),
      responseXml: result.responseXml,
      serverResponseXml: result.serverResponseXml,
      ...(ok ? extract(result) : {}),
    }),
  );
  return { ok, message, test };
}

/** Beantragt das Recht, die Belege des Ehegatten abzurufen; ELSTER schickt ihm den Freischaltcode per Post */
export async function requestBerechtigung(actor: string, client: ElsterClient, options: BrmOptions & { gueltigBis: string }): Promise<BrmSummary> {
  const { b, datenlieferant, mail } = await ehegatte();
  const { ok, message, test } = await sendBrm(
    actor,
    client,
    options,
    "antrag",
    (input) =>
      buildSpezRechtAntragXml({ ...input, dateninhaberIdnr: b.idnr, dateninhaberGeburtsdatum: b.geburtsdatum, gueltigBis: options.gueltigBis, mail }),
    (result) => {
      const antwort = parseSpezRechtAntragAntwort(result.serverResponseXml);
      return { antragsId: antwort?.antragsId, status: antwort?.status, genehmigenBis: antwort?.genehmigenBis.slice(0, 10) || null, gueltigBis: options.gueltigBis };
    },
    b.idnr,
    datenlieferant,
  );
  const berechtigung = await berechtigungEhegatte(test);
  return {
    ok,
    message: ok ? `Beantragt. ${b.vorname} bekommt von ELSTER einen Brief mit dem Freischaltcode.` : message,
    berechtigung,
  };
}

/** Schaltet den offenen Antrag mit dem Code aus dem Brief frei */
export async function activateBerechtigung(actor: string, client: ElsterClient, options: BrmOptions & { freischaltcode: string }): Promise<BrmSummary> {
  const { b, datenlieferant } = await ehegatte();
  const test = options.kind !== "send";
  const aktuell = await berechtigungEhegatte(test);
  if (!aktuell || aktuell.status !== "offen") throw new FinanzamtError("Es gibt keinen offenen Antrag zum Freischalten.");
  const { ok, message } = await sendBrm(
    actor,
    client,
    options,
    "freischaltung",
    (input) => buildSpezRechtFreischaltungXml(aktuell.antragsId, options.freischaltcode, input),
    (result) => ({ antragsId: aktuell.antragsId, status: parseSpezRechtStatus(result.serverResponseXml) ?? "genehmigt" }),
    b.idnr,
    datenlieferant,
  );
  return { ok, message: ok ? `Freigeschaltet. Haben kann jetzt die Belege von ${b.vorname} abrufen.` : message, berechtigung: await berechtigungEhegatte(test) };
}

/** Widerruft Antrag oder Berechtigung */
export async function revokeBerechtigung(actor: string, client: ElsterClient, options: BrmOptions): Promise<BrmSummary> {
  const { b, datenlieferant } = await ehegatte();
  const test = options.kind !== "send";
  const aktuell = await berechtigungEhegatte(test);
  if (!aktuell || !["offen", "genehmigt"].includes(aktuell.status)) throw new FinanzamtError("Es gibt keinen Antrag und keine Berechtigung zum Widerrufen.");
  const { ok, message } = await sendBrm(
    actor,
    client,
    options,
    "storno",
    (input) => buildSpezRechtStornoXml(aktuell.antragsId, input),
    (result) => ({ antragsId: aktuell.antragsId, status: parseSpezRechtStatus(result.serverResponseXml) ?? "widerrufen" }),
    b.idnr,
    datenlieferant,
  );
  return { ok, message: ok ? "Widerrufen." : message, berechtigung: await berechtigungEhegatte(test) };
}

/** Fragt den Stand aller eigenen Anträge bei ELSTER ab, etwa ob ein Antrag abgelaufen ist */
export async function refreshBerechtigungen(actor: string, client: ElsterClient, options: BrmOptions): Promise<BrmSummary> {
  const { b, datenlieferant } = await ehegatte();
  const { ok, message, test } = await sendBrm(
    actor,
    client,
    options,
    "liste",
    (input) => buildSpezRechtListeXml(input),
    (result) => ({
      liste: parseSpezRechtListe(result.serverResponseXml).map(({ antragsId, status, dateninhaberIdnr, gueltigBis, jahre }) => ({
        antragsId,
        status,
        dateninhaberIdnr,
        gueltigBis,
        jahre,
      })),
    }),
    null,
    datenlieferant,
  );
  const berechtigung = await berechtigungEhegatte(test);
  return { ok, message: ok ? (berechtigung ? `Stand bei ELSTER: ${berechtigung.status}.` : `Bei ELSTER liegt kein Antrag für ${b.vorname} vor.`) : message, berechtigung };
}

/**
 * Aktueller Stand für den Ehegatten aus dem Verlauf: der jüngste Antrag samt späteren Freischaltungen,
 * Widerrufen und Listen. Test und echt getrennt, weil der Testserver eigene Anträge führt.
 */
export async function berechtigungEhegatte(test: boolean): Promise<Berechtigung | null> {
  const company = await loadCompany();
  const idnr = company.taxpayer.b?.idnr;
  if (!idnr) return null;
  // Ohne die XML-Protokolle, die braucht der Status nicht
  const { requestXml: _request, responseXml: _response, serverResponseXml: _server, ...columns } = getTableColumns(schema.brmRequests);
  const rows = await db
    .select(columns)
    .from(schema.brmRequests)
    .where(and(eq(schema.brmRequests.test, test), eq(schema.brmRequests.ok, true)))
    .orderBy(asc(schema.brmRequests.createdAt));
  return rows.reduce<Berechtigung | null>((current, row) => step(current, row, idnr), null);
}

type StatusRow = Omit<typeof schema.brmRequests.$inferSelect, "requestXml" | "responseXml" | "serverResponseXml">;

function step(current: Berechtigung | null, row: StatusRow, idnr: string): Berechtigung | null {
  if (row.art === "antrag" && row.dateninhaberIdnr === idnr && row.antragsId) {
    return {
      antragsId: row.antragsId,
      status: row.status ?? "offen",
      genehmigenBis: row.genehmigenBis,
      gueltigBis: row.gueltigBis,
      test: row.test,
      beantragtAm: row.createdAt,
      aktualisiertAm: row.createdAt,
    };
  }
  if (current && (row.art === "freischaltung" || row.art === "storno") && row.antragsId === current.antragsId && row.status) {
    return { ...current, status: row.status, aktualisiertAm: row.createdAt };
  }
  if (row.art === "liste" && row.liste) {
    if (current) {
      const eintrag = row.liste.find((e) => e.antragsId === current.antragsId);
      return eintrag ? { ...current, status: eintrag.status, gueltigBis: eintrag.gueltigBis || current.gueltigBis, aktualisiertAm: row.createdAt } : current;
    }
    // Antrag aus Mein ELSTER oder einer früheren Installation
    const eintrag = row.liste.find((e) => e.dateninhaberIdnr === idnr);
    if (eintrag) {
      return {
        antragsId: eintrag.antragsId,
        status: eintrag.status,
        genehmigenBis: null,
        gueltigBis: eintrag.gueltigBis || null,
        test: row.test,
        beantragtAm: row.createdAt,
        aktualisiertAm: row.createdAt,
      };
    }
  }
  return current;
}

/** Vorschlag für „gültig bis“: Ende des übernächsten Jahres, damit zwei Erklärungen abgedeckt sind */
export function defaultGueltigBis(today: string): string {
  return `${Number(today.slice(0, 4)) + 2}-12-31`;
}
