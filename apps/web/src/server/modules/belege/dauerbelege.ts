/**
 * Dauerbelege (Roadmap Platz 8): Vorlagen für wiederkehrende Ausgaben wie Miete, Versicherung, Leasing oder Abos. Vorbild
 * ist der Dauerbeleg in Lexware Office (help.lexware.de, „Regelmäßige Buchungen: So legst du Dauerbelege an“): einmal mit
 * Vertragsdokument, Vertragspartner, Kategorie, Intervall und Start erfassen, Änderungen gelten für künftige Belege,
 * deaktivieren hält ihn an. Anders als dort bucht Haben nichts selbst: Jeder Termin wird ein Beleg „Zu prüfen“
 * (dauerbelege-lauf.ts).
 */
import { mapSevRecurringVoucher, type SevDauerbeleg, type SevVoucher, type SevVoucherPos } from "@haben/import";
import { dauerbelegProbleme, EXPENSE_CATEGORY_KEYS, terminAbStichtag, vorschauTermine, type DauerbelegStatus, type RecurringInterval } from "@haben/core";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { fileInUse, lockFileUse } from "../../db/file-in-use.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { removeFile, sha256Of, sniff, storeFile } from "../../storage.ts";
import { contactRoleProblem } from "../stammdaten/index.ts";
import { documentFileProblem } from "./documents.ts";

export type Dauerbeleg = typeof schema.recurringDocuments.$inferSelect;

export class DauerbelegError extends UserError {}

const isoDate = z.iso.date();
const cents = z.number().int().min(0).max(100_000_000_00);

export const dauerbelegInputSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(200),
  supplierName: z.string().trim().min(1, "Lieferant fehlt").max(200),
  supplierUstId: z.string().trim().max(20).default(""),
  supplierContactId: z.uuid().nullable().default(null),
  reference: z.string().trim().max(100).default(""),
  category: z.enum(EXPENSE_CATEGORY_KEYS),
  payment: z.enum(["bank", "privat", "kasse"]),
  privateShare: z.number().int().min(0).max(100).default(0),
  amounts: z
    .array(z.object({ taxRate: z.union([z.literal(1900), z.literal(700), z.literal(0)]), net: cents, tax: cents }))
    .min(1, "Beträge fehlen")
    .max(3),
  taxShown: z.boolean(),
  note: z.string().max(2000).default(""),
  intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  nextDate: isoDate,
  endDate: isoDate.nullable(),
  dueDays: z.number().int().min(0).max(120).default(0),
});

export type DauerbelegInput = z.input<typeof dauerbelegInputSchema>;

/** Vertrag oder Dauerrechnung: dieselben Dateitypen wie ein Beleg */
export interface DauerbelegFile {
  bytes: Uint8Array;
  filename: string;
}

/** Felder aus der Eingabe; Ankertag aus dem nächsten Termin wie bei wiederkehrenden Rechnungen */
function values(raw: DauerbelegInput) {
  const input = dauerbelegInputSchema.parse(raw);
  const problems = dauerbelegProbleme(input);
  if (problems.length > 0) throw new DauerbelegError(problems.join(" "));
  return {
    ...input,
    supplierUstId: input.supplierUstId.replace(/\s/g, "").toUpperCase(),
    anchorDay: Number(input.nextDate.slice(8, 10)),
    updatedAt: new Date(),
  };
}

/** Nur eine neue Zuordnung wird geprüft: ein Kontakt, der inzwischen kein Lieferant mehr ist, bleibt an der Vorlage */
async function checkSupplier(tx: Tx, contactId: string | null, previous: string | null = null): Promise<void> {
  if (!contactId || contactId === previous) return;
  const problem = await contactRoleProblem(tx, contactId, "lieferant", "Lieferant nicht gefunden.");
  if (problem) throw new DauerbelegError(problem);
}

/** Prüft die Datei und legt sie im Dokumentenspeicher ab; die Sperre hält, bis die Zeile sie nutzt */
async function storeContract(tx: Tx, file: DauerbelegFile) {
  const problem = documentFileProblem(file);
  if (problem) throw new DauerbelegError(problem.message);
  const sha256 = sha256Of(file.bytes);
  await lockFileUse(tx, sha256);
  await storeFile(file.bytes);
  return { sha256, filename: file.filename.slice(0, 200), mimeType: sniff(file.bytes)!.mimeType, size: file.bytes.byteLength };
}

/** Löscht die Datei, wenn nach dem Ersetzen oder Löschen niemand sie mehr nutzt; in derselben Transaktion fragen */
async function unusedFile(tx: Tx, sha256: string): Promise<string | null> {
  await lockFileUse(tx, sha256);
  return (await fileInUse(tx, sha256)) ? null : sha256;
}

export async function listDauerbelege() {
  const rows = await db
    .select({
      vorlage: schema.recurringDocuments,
      belege: count(schema.documents.id),
      zuPruefen: sql<number>`count(*) filter (where ${schema.documents.status} = 'neu')::int`,
    })
    .from(schema.recurringDocuments)
    .leftJoin(schema.documents, eq(schema.documents.recurringDocumentId, schema.recurringDocuments.id))
    .groupBy(schema.recurringDocuments.id)
    .orderBy(sql`${schema.recurringDocuments.status} = 'beendet'`, asc(schema.recurringDocuments.nextDate));
  return rows.map(({ vorlage: { sevdeskRaw: _raw, ...vorlage }, ...rest }) => ({ vorlage, ...rest }));
}

export async function getDauerbeleg(id: string) {
  const [row] = await db.select().from(schema.recurringDocuments).where(eq(schema.recurringDocuments.id, id));
  if (!row) return null;
  const { sevdeskRaw: _raw, ...vorlage } = row;
  /** Übernommen aus sevDesk: was der Nutzer prüfen muss; null bei eigenen Dauerbelegen */
  const sevdesk = row.sevdeskId ? { id: row.sevdeskId, hinweise: sevdeskHinweise(row) } : null;
  const belege = await db
    .select({
      id: schema.documents.id,
      documentDate: schema.documents.documentDate,
      recurringPeriod: schema.documents.recurringPeriod,
      status: schema.documents.status,
      gross: schema.documents.gross,
      cancelledOn: schema.documentCancellations.date,
    })
    .from(schema.documents)
    .leftJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(eq(schema.documents.recurringDocumentId, id))
    .orderBy(desc(schema.documents.recurringPeriod));
  const termine = vorlage.status === "beendet" ? [] : vorschauTermine({ ...vorlage, intervalMonths: vorlage.intervalMonths as RecurringInterval }, 3);
  return { vorlage, belege, termine, sevdesk };
}

/** Name des Dauerbelegs, aus dem ein Beleg stammt; für die Belegseite */
export async function dauerbelegName(id: string): Promise<string | null> {
  const [row] = await db.select({ name: schema.recurringDocuments.name }).from(schema.recurringDocuments).where(eq(schema.recurringDocuments.id, id));
  return row?.name ?? null;
}

export async function createDauerbeleg(actor: string, input: DauerbelegInput, file: DauerbelegFile): Promise<Dauerbeleg> {
  const row = values(input);
  return withActor(actor, async (tx) => {
    await checkSupplier(tx, row.supplierContactId);
    const contract = await storeContract(tx, file);
    const [created] = await tx
      .insert(schema.recurringDocuments)
      .values({ ...row, ...contract, startDate: row.nextDate })
      .returning();
    return created!;
  });
}

async function lockVorlage(tx: Tx, id: string): Promise<Dauerbeleg> {
  const [vorlage] = await tx.select().from(schema.recurringDocuments).where(eq(schema.recurringDocuments.id, id)).for("update");
  if (!vorlage) throw new DauerbelegError("Dauerbeleg nicht gefunden.");
  return vorlage;
}

/**
 * Ändert die Vorlage, auf Wunsch mit neuem Vertrag. Das gilt nur für künftige Belege: Angelegte Belege tragen ihre
 * eigenen Felder und Beträge und behalten die Datei, die beim Anlegen hinterlegt war.
 */
export async function updateDauerbeleg(actor: string, id: string, input: DauerbelegInput, file: DauerbelegFile | null): Promise<Dauerbeleg> {
  const row = values(input);
  const { updated, unused } = await withActor(actor, async (tx) => {
    const previous = await lockVorlage(tx, id);
    if (previous.status === "beendet") throw new DauerbelegError("Ein beendeter Dauerbeleg lässt sich nicht mehr ändern. Lege bei Bedarf einen neuen an.");
    await checkSupplier(tx, row.supplierContactId, previous.supplierContactId);
    const contract = file ? await storeContract(tx, file) : {};
    // Unveränderter Termin: Ankertag behalten, sonst würde aus dem Monatsletzten nach einer Änderung am 28.02. der 28.
    const anchorDay = row.nextDate === previous.nextDate ? previous.anchorDay : row.anchorDay;
    const [saved] = await tx
      .update(schema.recurringDocuments)
      .set({ ...row, anchorDay, ...contract, lastError: null })
      .where(eq(schema.recurringDocuments.id, id))
      .returning();
    const replaced = file && previous.sha256 && previous.sha256 !== saved!.sha256 ? await unusedFile(tx, previous.sha256) : null;
    return { updated: saved!, unused: replaced };
  });
  if (unused) await removeFile(unused);
  return updated;
}

export const DAUERBELEG_AKTIONEN = ["pausieren", "fortsetzen", "beenden"] as const;
export type DauerbelegAktion = (typeof DAUERBELEG_AKTIONEN)[number];

/**
 * Pausieren hält die Vorlage an, Fortsetzen macht beim ersten Termin ab heute weiter: Termine, die in die Pause fielen,
 * legt Haben nicht an (etwa mietfreie Monate). Beenden ist endgültig; angelegte Belege bleiben.
 */
export async function setDauerbelegStatus(actor: string, id: string, aktion: DauerbelegAktion, heute: string): Promise<Dauerbeleg> {
  return withActor(actor, async (tx) => {
    const vorlage = await lockVorlage(tx, id);
    const next = nextStatus(vorlage, aktion, heute);
    const [updated] = await tx
      .update(schema.recurringDocuments)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(schema.recurringDocuments.id, id))
      .returning();
    return updated!;
  });
}

function nextStatus(vorlage: Dauerbeleg, aktion: DauerbelegAktion, heute: string): { status: DauerbelegStatus; nextDate?: string } {
  if (vorlage.status === "beendet") throw new DauerbelegError("Der Dauerbeleg ist beendet.");
  if (aktion === "beenden") return { status: "beendet" };
  if (aktion === "pausieren") {
    if (vorlage.status !== "aktiv") throw new DauerbelegError("Der Dauerbeleg ist schon pausiert.");
    return { status: "pausiert" };
  }
  if (vorlage.status !== "pausiert") throw new DauerbelegError("Der Dauerbeleg läuft schon.");
  if (!vorlage.sha256) throw new DauerbelegError("Lade zuerst den Vertrag oder die Dauerrechnung hoch.");
  // Eine aus sevDesk übernommene Vorlage hat die Prüfung des Formulars nicht durchlaufen; das Ende prüft der Status unten
  const problems = dauerbelegProbleme({ ...vorlage, endDate: null });
  if (problems.length > 0) throw new DauerbelegError(problems.join(" "));
  const nextDate = terminAbStichtag({ ...vorlage, intervalMonths: vorlage.intervalMonths as RecurringInterval }, heute);
  return { status: vorlage.endDate !== null && nextDate > vorlage.endDate ? "beendet" : "aktiv", nextDate };
}

/** Löschen nur, solange kein Beleg daraus entstanden ist; sonst beenden */
export async function deleteDauerbeleg(actor: string, id: string): Promise<void> {
  const unused = await withActor(actor, async (tx) => {
    const vorlage = await lockVorlage(tx, id);
    const [used] = await tx.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.recurringDocumentId, id)).limit(1);
    if (used) throw new DauerbelegError("Aus dem Dauerbeleg sind schon Belege entstanden. Beende ihn stattdessen.");
    await tx.delete(schema.recurringDocuments).where(eq(schema.recurringDocuments.id, id));
    return vorlage.sha256 ? unusedFile(tx, vorlage.sha256) : null;
  });
  if (unused) await removeFile(unused);
}

/** Datei der Vorlage zum Herunterladen */
export async function dauerbelegFile(id: string) {
  const [row] = await db
    .select({
      sha256: schema.recurringDocuments.sha256,
      filename: schema.recurringDocuments.filename,
      mimeType: schema.recurringDocuments.mimeType,
    })
    .from(schema.recurringDocuments)
    .where(and(eq(schema.recurringDocuments.id, id)));
  return row?.sha256 && row.filename && row.mimeType ? { sha256: row.sha256, filename: row.filename, mimeType: row.mimeType } : null;
}

/**
 * Vorlage aus sevDesk (#472), angehalten oder beendet übernommen; ohne Datei, wenn sevDesk keine hat oder ihre Art nicht
 * passt. false, wenn die Vorlage schon übernommen ist: Änderungen des Nutzers bleiben, ein neuer Abruf überschreibt nichts.
 */
export async function importSevdeskDauerbeleg(
  actor: string,
  vorlage: SevDauerbeleg,
  raw: Record<string, unknown>,
  file: DauerbelegFile | null,
): Promise<boolean> {
  const contract = file && !documentFileProblem(file) ? file : null;
  return withActor(actor, async (tx) => {
    const [known] = await tx
      .select({ id: schema.recurringDocuments.id })
      .from(schema.recurringDocuments)
      .where(eq(schema.recurringDocuments.sevdeskId, vorlage.sevdeskId));
    if (known) return false;
    const [contact] = vorlage.supplierSevdeskId
      ? await tx
          .select({ id: schema.contacts.id, name: schema.contacts.name })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.sevdeskId, vorlage.supplierSevdeskId), eq(schema.contacts.isSupplier, true)))
      : [];
    const stored = contract ? await storeContract(tx, contract) : {};
    const { supplierSevdeskId: _supplier, documentId: _document, ...felder } = vorlage;
    const [created] = await tx
      .insert(schema.recurringDocuments)
      .values({
        ...felder,
        supplierContactId: contact?.id ?? null,
        ...stored,
        sevdeskRaw: raw,
        note: "Aus sevDesk übernommen.",
      })
      .onConflictDoNothing({ target: schema.recurringDocuments.sevdeskId })
      .returning({ id: schema.recurringDocuments.id });
    return Boolean(created);
  });
}

/** Hinweise zu einer aus sevDesk übernommenen Vorlage, aus der gespeicherten Antwort; leer bei eigenen Dauerbelegen */
export function sevdeskHinweise(vorlage: Pick<Dauerbeleg, "sevdeskRaw" | "sha256" | "createdAt">): string[] {
  const raw = vorlage.sevdeskRaw as { voucher?: SevVoucher; positions?: SevVoucherPos[] } | null;
  if (!raw?.voucher) return [];
  const heute = vorlage.createdAt.toISOString().slice(0, 10);
  const mapped = mapSevRecurringVoucher(raw.voucher, raw.positions ?? [], heute);
  if (!mapped.ok) return [mapped.grund];
  const hinweise = mapped.hinweise.filter((h) => !h.startsWith("In sevDesk ohne Datei"));
  if (!vorlage.sha256)
    hinweise.push(
      mapped.dauerbeleg.documentId
        ? "Die Datei aus sevDesk ließ sich nicht übernehmen (Art oder Größe); bitte hochladen."
        : "In sevDesk ohne Datei: Vor dem Fortsetzen den Vertrag oder die Dauerrechnung hochladen.",
    );
  return hinweise;
}
