import { and, asc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { archiveTargetSummary, headerOf, loadArchiveTarget, type ArchiveTarget } from "./einstellungen.ts";
import { fillPlaceholders, sendFile } from "./senden.ts";

/*
 * Ablage festgeschriebener Rechnungen: Haben schickt jede ab `since` festgeschriebene Rechnung, Stornorechnung und
 * Korrektur einmal an die eingestellte Adresse. Was zu schicken ist, ergibt sich aus den Daten (festgeschrieben, noch
 * nicht übertragen), nicht aus einem Aufruf beim Festschreiben: So kommt jeder Weg dorthin an, auch Storno und
 * wiederkehrende Rechnungen, und ein Fehlschlag wird beim nächsten Lauf wiederholt.
 */

export const ABLAGE_ACTOR = "system:ablage";

/** Je Lauf höchstens so viele Rechnungen; der Rest folgt beim nächsten */
const MAX_JE_LAUF = 50;

/** Nach so vielen Fehlversuchen wiederholt der stündliche Lauf nicht mehr; „Jetzt übertragen“ und Speichern schon */
export const MAX_VERSUCHE = 24;

const TITEL = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" } as const;
const VARIANTE = { abschlag: "Abschlagsrechnung", schluss: "Schlussrechnung" } as const;

type Kandidat = {
  id: string;
  number: string;
  kind: keyof typeof TITEL;
  variant: keyof typeof VARIANTE | null;
  issueDate: string;
  buyer: { name: string } | null;
  format: string;
  pdf: Buffer | null;
  pdfSha256: string | null;
  xml: string | null;
  xmlSha256: string | null;
};

/** Datei, die an das Archiv geht: die E-Rechnung wie festgeschrieben oder auf Wunsch immer das PDF */
export function fileFor(invoice: Kandidat, choice: ArchiveTarget["file"]) {
  // Schrägstriche und Zeichen, die Dateisysteme nicht mögen, aus der Nummer
  const name = `Rechnung-${invoice.number.replace(/[\\/:*?"<>|\s]+/g, "-")}`;
  const xmlOriginal = invoice.format !== "zugferd" && choice === "original";
  if (xmlOriginal && invoice.xml && invoice.xmlSha256) {
    const suffix = invoice.format === "xrechnung-ubl" ? "ubl" : "cii";
    return { bytes: new TextEncoder().encode(invoice.xml), filename: `${name}-${suffix}.xml`, mimeType: "application/xml", sha256: invoice.xmlSha256 };
  }
  if (invoice.pdf && invoice.pdfSha256)
    return { bytes: new Uint8Array(invoice.pdf), filename: `${name}.pdf`, mimeType: "application/pdf", sha256: invoice.pdfSha256 };
  return null;
}

const artVon = (invoice: Kandidat) => (invoice.kind === "rechnung" && invoice.variant ? VARIANTE[invoice.variant] : TITEL[invoice.kind]);

/** Festgeschriebene Rechnungen seit `since`, die an diese Adresse noch nicht übertragen sind */
async function kandidaten(target: ArchiveTarget, alle: boolean): Promise<Kandidat[]> {
  const i = schema.invoices;
  const d = schema.archiveDeliveries;
  const rows = await db
    .select({
      id: i.id,
      number: i.number,
      kind: i.kind,
      variant: i.variant,
      issueDate: i.issueDate,
      buyer: i.buyer,
      format: i.format,
      pdf: i.pdf,
      pdfSha256: i.pdfSha256,
      xml: i.xml,
      xmlSha256: i.xmlSha256,
    })
    .from(i)
    .leftJoin(d, and(eq(d.invoiceId, i.id), eq(d.url, target.url)))
    .where(
      and(
        eq(i.status, "final"),
        isNotNull(i.number),
        gte(i.lockedAt, target.since),
        // Aus einem Umzug übernommene Rechnungen (lexofficeVoucherId gilt für jede Quelle) liegen schon im alten Programm
        isNull(i.lexofficeVoucherId),
        or(isNull(d.id), and(eq(d.status, "fehler"), alle ? sql`true` : lt(d.attempts, MAX_VERSUCHE))),
      ),
    )
    .orderBy(asc(i.lockedAt))
    .limit(MAX_JE_LAUF);
  return rows.flatMap(({ number, buyer, ...row }) => (number ? [{ ...row, number, buyer: buyer && { name: buyer.name } }] : []));
}

async function speichern(
  actor: string,
  target: ArchiveTarget,
  invoice: Kandidat,
  file: { filename: string; sha256: string },
  ergebnis: Awaited<ReturnType<typeof sendFile>>,
) {
  const now = new Date();
  const link = ergebnis.ok && ergebnis.archiveId && target.linkTemplate ? target.linkTemplate.replaceAll("{id}", encodeURIComponent(ergebnis.archiveId)) : null;
  const werte = ergebnis.ok
    ? { status: "uebertragen" as const, httpStatus: ergebnis.httpStatus, archiveId: ergebnis.archiveId, link, error: null, deliveredAt: now }
    : { status: "fehler" as const, httpStatus: ergebnis.httpStatus, error: ergebnis.error.slice(0, 1000) };
  await withActor(actor, (tx) =>
    tx
      .insert(schema.archiveDeliveries)
      .values({ invoiceId: invoice.id, url: target.url, filename: file.filename, sha256: file.sha256, attempts: 1, lastAttemptAt: now, ...werte })
      .onConflictDoUpdate({
        target: [schema.archiveDeliveries.invoiceId, schema.archiveDeliveries.url],
        set: { ...werte, filename: file.filename, sha256: file.sha256, attempts: sql`${schema.archiveDeliveries.attempts} + 1`, lastAttemptAt: now },
      }),
  );
}

export interface AblageErgebnis {
  uebertragen: number;
  fehler: number;
}

/** Ein Lauf auf einmal, ob stündlich, nach dem Festschreiben oder von Hand; ein zweiter wartet auf ihn */
let laufend: Promise<AblageErgebnis> | null = null;

async function lauf(actor: string, alle: boolean): Promise<AblageErgebnis> {
  const target = await loadArchiveTarget();
  const ergebnis: AblageErgebnis = { uebertragen: 0, fehler: 0 };
  if (!target?.enabled) return ergebnis;
  const header = headerOf(target);
  for (const invoice of await kandidaten(target, alle)) {
    const file = fileFor(invoice, target.file);
    if (!file) continue;
    const werte = { nummer: invoice.number, art: artVon(invoice), datum: invoice.issueDate, kunde: invoice.buyer?.name ?? "", dateiname: file.filename };
    const gesendet = await sendFile({
      url: target.url,
      fileField: target.fileField,
      header,
      fields: target.fields.map((field) => ({ name: field.name, value: fillPlaceholders(field.value, werte) })),
      file,
    });
    await speichern(actor, target, invoice, file, gesendet);
    if (gesendet.ok) ergebnis.uebertragen++;
    else ergebnis.fehler++;
  }
  await db.update(schema.archiveTarget).set({ lastRunAt: new Date() }).where(eq(schema.archiveTarget.id, 1));
  return ergebnis;
}

/**
 * Überträgt, was ansteht. `alle` wiederholt auch Rechnungen nach MAX_VERSUCHE Fehlversuchen (Knopf „Jetzt übertragen“).
 * Läuft schon ein Lauf, wartet der Aufruf auf ihn und startet danach einen eigenen, damit nichts doppelt geht.
 */
export async function deliverInvoices(actor: string, alle = false): Promise<AblageErgebnis> {
  while (laufend) await laufend.catch(() => {});
  laufend = lauf(actor, alle);
  try {
    return await laufend;
  } finally {
    laufend = null;
  }
}

/** Für den stündlichen Hintergrundjob */
export async function runDueArchiveDeliveries(): Promise<AblageErgebnis | null> {
  const target = await loadArchiveTarget();
  if (!target?.enabled) return null;
  return deliverInvoices(ABLAGE_ACTOR);
}

/** Nach dem Festschreiben gleich übertragen, ohne auf den stündlichen Lauf zu warten; Fehler stehen an der Rechnung */
export function deliverSoon(): void {
  void runDueArchiveDeliveries().catch((error: unknown) => console.error("Ablage im Archiv", error));
}

export type DeliveryStatus =
  | { status: "uebertragen"; deliveredAt: Date; httpStatus: number | null; link: string | null }
  | { status: "fehler"; lastAttemptAt: Date; httpStatus: number | null; error: string | null; attempts: number }
  | { status: "wartet" };

/** Stand an der Rechnung: übertragen, fehlgeschlagen oder wartet auf den nächsten Lauf; null, wenn sie nicht ins Archiv geht */
export async function deliveryForInvoice(invoice: {
  id: string;
  status: string;
  lockedAt: Date | null;
  lexofficeVoucherId: string | null;
}): Promise<DeliveryStatus | null> {
  const d = schema.archiveDeliveries;
  const target = await loadArchiveTarget();
  // Die Weitergabe an die eingestellte Adresse; sonst die letzte erfolgreiche an eine frühere, denn dort liegt die Kopie.
  // Fehlschläge an eine frühere Adresse wiederholt niemand mehr, sie zählen nicht.
  // Ohne Ziel kein konstantes `false` im ORDER BY: Postgres lehnt eine Konstante dort ab
  const current = target ? sql`${d.url} = ${target.url}` : null;
  const [row] = await db
    .select()
    .from(d)
    .where(and(eq(d.invoiceId, invoice.id), current ? or(current, eq(d.status, "uebertragen")) : eq(d.status, "uebertragen")))
    .orderBy(...(current ? [sql`${current} desc`] : []), sql`${d.lastAttemptAt} desc`)
    .limit(1);
  if (row?.status === "uebertragen") return { status: "uebertragen", deliveredAt: row.deliveredAt!, httpStatus: row.httpStatus, link: row.link };
  if (row) return { status: "fehler", lastAttemptAt: row.lastAttemptAt, httpStatus: row.httpStatus, error: row.error, attempts: row.attempts };
  const geht = target?.enabled && invoice.status === "final" && invoice.lockedAt && invoice.lockedAt >= target.since && !invoice.lexofficeVoucherId;
  return geht ? { status: "wartet" } : null;
}

/** Für die Einstellungen: das Ziel ohne Geheimnis und die letzten Fehlschläge */
export async function archiveTargetOverview() {
  return { ...(await archiveTargetSummary()), failed: await failedDeliveries() };
}

/** Letzte Fehlschläge an die eingestellte Adresse */
async function failedDeliveries(limit = 5) {
  const target = await loadArchiveTarget();
  if (!target) return [];
  const d = schema.archiveDeliveries;
  return db
    .select({ invoiceId: d.invoiceId, number: schema.invoices.number, error: d.error, attempts: d.attempts, lastAttemptAt: d.lastAttemptAt })
    .from(d)
    .innerJoin(schema.invoices, eq(schema.invoices.id, d.invoiceId))
    .where(and(eq(d.url, target.url), eq(d.status, "fehler")))
    .orderBy(sql`${d.lastAttemptAt} desc`)
    .limit(limit);
}
