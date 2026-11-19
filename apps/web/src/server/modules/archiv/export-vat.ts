import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { loadFile } from "../../storage.ts";
import { today } from "../../today.ts";
import { csv, type CsvValue, iso, money } from "./csv.ts";
import type { ArchiveFile } from "./export-zip.ts";
import { groupBy } from "./group-by.ts";

// Umsatzsteuer-Voranmeldungen des Jahresarchivs mit Übermittlungen und Abgabevermerken

const encoder = new TextEncoder();

const SUBMISSION_LABELS: Record<string, string> = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung" };

/** Je Monat die Anmeldungen, ERiC-Protokolle und XML sowie vermerkte Abgaben außerhalb von Haben */
export async function* vatFiles(year: number, problems: string[]): AsyncGenerator<ArchiveFile> {
  const vatReturns = await db
    .select()
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.year, year))
    .orderBy(asc(schema.vatReturns.month), asc(schema.vatReturns.createdAt));
  const submissions = vatReturns.length
    ? await db
        .select({
          id: schema.vatReturnSubmissions.id,
          vatReturnId: schema.vatReturnSubmissions.vatReturnId,
          kind: schema.vatReturnSubmissions.kind,
          ok: schema.vatReturnSubmissions.ok,
          code: schema.vatReturnSubmissions.code,
          message: schema.vatReturnSubmissions.message,
          transferTicket: schema.vatReturnSubmissions.transferTicket,
          createdAt: schema.vatReturnSubmissions.createdAt,
          hasPdf: sql<boolean>`${schema.vatReturnSubmissions.protocolPdf} is not null`,
        })
        .from(schema.vatReturnSubmissions)
        .where(
          inArray(
            schema.vatReturnSubmissions.vatReturnId,
            vatReturns.map((r) => r.id),
          ),
        )
        .orderBy(asc(schema.vatReturnSubmissions.createdAt))
    : [];
  // Abgaben außerhalb von Haben: das Übermittlungsprotokoll aus Mein ELSTER liegt im Dokumentenspeicher
  const filings = vatReturns.length
    ? await db
        .select()
        .from(schema.vatReturnFilings)
        .where(
          inArray(
            schema.vatReturnFilings.vatReturnId,
            vatReturns.map((r) => r.id),
          ),
        )
    : [];
  for (const [month, returns] of groupBy(vatReturns, (r) => r.month)) {
    const dir = `umsatzsteuer/${year}-${String(month).padStart(2, "0")}`;
    const submissionRows: CsvValue[][] = [];
    for (const [index, vatReturn] of returns.entries()) {
      const suffix = returns.length > 1 ? `-${index + 1}` : "";
      yield { path: `${dir}/anmeldung${suffix}.json`, content: encoder.encode(`${JSON.stringify(vatReturn, null, 2)}\n`), compress: true };
      for (const submission of submissions.filter((s) => s.vatReturnId === vatReturn.id)) {
        yield* submissionFiles(dir, submission, suffix, submissionRows);
      }
      for (const filing of filings.filter((f) => f.vatReturnId === vatReturn.id)) {
        yield* filingFiles(dir, filing, suffix, submissionRows, problems);
      }
    }
    yield {
      path: `${dir}/übermittlungen.csv`,
      content: csv(
        ["Zeitpunkt", "Art", "Erfolgreich", "Code", "Meldung", "Transfer-Ticket", "Protokoll", "Anfrage", "Antwort", "Server-Antwort", "Anmeldung", "ID"],
        submissionRows,
      ),
      compress: true,
    };
  }
}

/** Protokoll und XML einer Übermittlung; hängt ihre Zeile an rows an */
async function* submissionFiles(
  dir: string,
  submission: Pick<typeof schema.vatReturnSubmissions.$inferSelect, "id" | "kind" | "ok" | "code" | "message" | "transferTicket" | "createdAt">,
  suffix: string,
  rows: CsvValue[][],
): AsyncGenerator<ArchiveFile> {
  const stem = `${today(submission.createdAt)}_${submission.kind}_${submission.id.slice(0, 8)}`;
  const [files] = await db
    .select({
      protocolPdf: schema.vatReturnSubmissions.protocolPdf,
      requestXml: schema.vatReturnSubmissions.requestXml,
      responseXml: schema.vatReturnSubmissions.responseXml,
      serverResponseXml: schema.vatReturnSubmissions.serverResponseXml,
    })
    .from(schema.vatReturnSubmissions)
    .where(eq(schema.vatReturnSubmissions.id, submission.id));
  const names: string[] = [];
  if (files?.protocolPdf) {
    names.push(`${stem}_protokoll.pdf`);
    yield { path: `${dir}/${stem}_protokoll.pdf`, content: new Uint8Array(files.protocolPdf), compress: false };
  } else names.push("");
  for (const [key, label] of [
    ["requestXml", "anfrage"],
    ["responseXml", "antwort"],
    ["serverResponseXml", "server-antwort"],
  ] as const) {
    const text = files?.[key] ?? "";
    if (text) {
      names.push(`${stem}_${label}.xml`);
      yield { path: `${dir}/${stem}_${label}.xml`, content: encoder.encode(text), compress: true };
    } else names.push("");
  }
  rows.push([
    iso(submission.createdAt),
    SUBMISSION_LABELS[submission.kind] ?? submission.kind,
    submission.ok,
    submission.code,
    submission.message,
    submission.transferTicket,
    ...names,
    `anmeldung${suffix}.json`,
    submission.id,
  ]);
}

/** Protokoll einer Abgabe außerhalb von Haben; hängt ihre Zeile an rows an */
async function* filingFiles(
  dir: string,
  filing: typeof schema.vatReturnFilings.$inferSelect,
  suffix: string,
  rows: CsvValue[][],
  problems: string[],
): AsyncGenerator<ArchiveFile> {
  const name = `${filing.filedOn}_vermerk_${filing.id.slice(0, 8)}_protokoll.pdf`;
  let bytes: Buffer | null = null;
  try {
    bytes = await loadFile(filing.sha256);
  } catch (error) {
    problems.push(
      `Protokoll der Voranmeldung ${dir.slice("umsatzsteuer/".length)} (${filing.filename}): Datei nicht lesbar – ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes) yield { path: `${dir}/${name}`, content: new Uint8Array(bytes), compress: false };
  rows.push([
    iso(filing.createdAt),
    `Abgabe vermerkt (außerhalb von Haben, abgegeben ${filing.filedOn})`,
    true,
    0,
    `Kz 83 ${money(filing.kz83)}; Protokoll ${filing.filename}, SHA-256 ${filing.sha256}`,
    filing.transferTicket,
    bytes ? name : "",
    "",
    "",
    "",
    `anmeldung${suffix}.json`,
    filing.id,
  ]);
}
