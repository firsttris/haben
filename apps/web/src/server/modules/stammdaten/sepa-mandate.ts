import { compactIban, isEwrIban, isValidBic, isValidIban, mandatStatus, mandatsreferenzProblem, type MandatStatus } from "@haben/core";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { isUniqueViolation, UserError } from "../../errors.ts";
import { attachmentFileProblem, storeAttachmentFile, type AttachmentFile } from "../rechnungen/index.ts";

/**
 * SEPA-Lastschriftmandate am Kontakt (#445). Mandat, PDF und Widerruf stehen in nur anhängbaren Tabellen
 * (drizzle/0177): Ändert sich etwas am Mandat, legt man ein neues mit eigener Referenz an, das alte bleibt in der
 * Historie. Ob ein Mandat am Stichtag gilt, rechnet mandatStatus in @haben/core (Verfall nach 36 Monaten ohne Einzug).
 */

export class MandateError extends UserError {}

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum fehlt");

export const mandateInputSchema = z.object({
  reference: z.string().trim(),
  signedOn: datum,
  scheme: z.enum(["CORE", "B2B"]),
  firstSequence: z.enum(["FRST", "RCUR"]),
  /** Letzter Einzug vor Haben, nur bei übernommenen Mandaten */
  lastCollectionBefore: datum.nullable().default(null),
  debtorName: z.string().trim().min(1, "Kontoinhaber fehlt").max(70),
  debtorIban: z.string().trim().max(42),
  debtorBic: z.string().trim().max(11).default(""),
});

export type MandateInput = z.input<typeof mandateInputSchema>;

export const revocationInputSchema = z.object({
  revokedOn: datum,
  reason: z.string().trim().max(500).default(""),
});

export type RevocationInput = z.input<typeof revocationInputSchema>;

export interface MandateFile {
  filename: string;
  sha256: string;
  size: number;
  createdAt: Date;
}

export interface Mandate {
  id: string;
  contactId: string;
  reference: string;
  signedOn: string;
  scheme: "CORE" | "B2B";
  firstSequence: "FRST" | "RCUR";
  lastCollectionBefore: string | null;
  debtorName: string;
  debtorIban: string;
  debtorBic: string;
  createdAt: Date;
  file: MandateFile | null;
  revocation: { revokedOn: string; reason: string; createdAt: Date } | null;
  status: MandatStatus;
}

/** Fehler in den Angaben als Satz, oder null */
function mandateProblem(input: z.infer<typeof mandateInputSchema>, today: string): string | null {
  const iban = compactIban(input.debtorIban);
  const bic = input.debtorBic.replace(/\s+/g, "").toUpperCase();
  return (
    mandatsreferenzProblem(input.reference) ??
    (iban === "" ? "Die IBAN fehlt." : null) ??
    (!isValidIban(iban) ? `Die IBAN ${iban} ist ungültig.` : null) ??
    // Rulebook SDD Core und B2B v1.2, Kap. 2.2: Konto bei einem PSP in SEPA. Außerhalb des EWR verlangt das Mandat die
    // Anschrift des Zahlungspflichtigen (DS-01), die es hier nicht führt; daher wie bei Überweisungen nur der EWR
    (!isEwrIban(iban) ? `Die IBAN ${iban} liegt außerhalb des EWR; dafür nimmt Haben kein Lastschriftmandat an.` : null) ??
    (bic && !isValidBic(bic) ? `Die BIC ${bic} ist ungültig.` : null) ??
    (input.signedOn > today ? "Das Datum der Unterschrift liegt in der Zukunft." : null) ??
    (input.lastCollectionBefore && input.lastCollectionBefore < input.signedOn ? "Der letzte Einzug liegt vor der Unterschrift." : null) ??
    (input.lastCollectionBefore && input.lastCollectionBefore > today ? "Der letzte Einzug liegt in der Zukunft." : null) ??
    (input.lastCollectionBefore && input.firstSequence === "FRST" ? "Nach einem Einzug vor Haben ist der nächste eine Folgelastschrift." : null)
  );
}

/** Legt ein Mandat für einen Kunden an; liefert die ID */
export async function createMandate(actor: string, contactId: string, raw: MandateInput, today: string): Promise<string> {
  const input = mandateInputSchema.parse(raw);
  const problem = mandateProblem(input, today);
  if (problem) throw new MandateError(problem);
  return withActor(actor, async (tx) => {
    const [contact] = await tx.select({ isCustomer: schema.contacts.isCustomer }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
    if (!contact) throw new MandateError("Kontakt nicht gefunden.");
    if (!contact.isCustomer) throw new MandateError("Ein Lastschriftmandat gibt es nur von Kunden.");
    try {
      // Savepoint: Nach der Verletzung des eindeutigen Index bleibt die Transaktion für die Abfrage des Besitzers benutzbar
      const [created] = await tx.transaction((sp) =>
        sp
          .insert(schema.sepaMandates)
          .values({
            ...input,
            contactId,
            debtorIban: compactIban(input.debtorIban),
            debtorBic: input.debtorBic.replace(/\s+/g, "").toUpperCase(),
            createdBy: actor,
          })
          .returning({ id: schema.sepaMandates.id }),
      );
      return created!.id;
    } catch (error) {
      if (!isUniqueViolation(error, "sepa_mandates_reference")) throw error;
      const [owner] = await tx
        .select({ name: schema.contacts.name })
        .from(schema.sepaMandates)
        .innerJoin(schema.contacts, eq(schema.contacts.id, schema.sepaMandates.contactId))
        .where(sql`lower(${schema.sepaMandates.reference}) = lower(${input.reference})`);
      throw new MandateError(`Die Mandatsreferenz ${input.reference} gibt es schon (${owner?.name ?? "anderer Kontakt"}).`);
    }
  });
}

/** Mandate eines Kontakts, das jüngste zuerst, mit PDF, Widerruf und Status am Stichtag */
export async function listMandates(contactId: string, today: string, q: Db | Tx = db): Promise<Mandate[]> {
  const rows = await q
    .select()
    .from(schema.sepaMandates)
    .where(eq(schema.sepaMandates.contactId, contactId))
    .orderBy(desc(schema.sepaMandates.signedOn), desc(schema.sepaMandates.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [files, revocations] = await Promise.all([
    q
      .select()
      .from(schema.sepaMandateFiles)
      .where(inArray(schema.sepaMandateFiles.mandateId, ids))
      .orderBy(asc(schema.sepaMandateFiles.createdAt), asc(schema.sepaMandateFiles.id)),
    q.select().from(schema.sepaMandateRevocations).where(inArray(schema.sepaMandateRevocations.mandateId, ids)),
  ]);
  // Das jüngste PDF gilt; die Reihenfolge oben lässt das letzte gewinnen
  const fileOf = new Map(files.map((f) => [f.mandateId, { filename: f.filename, sha256: f.sha256, size: f.size, createdAt: f.createdAt }]));
  const revocationOf = new Map(revocations.map((r) => [r.mandateId, { revokedOn: r.revokedOn, reason: r.reason, createdAt: r.createdAt }]));
  return rows.map(({ createdBy: _createdBy, ...row }) => {
    const revocation = revocationOf.get(row.id) ?? null;
    return {
      ...row,
      file: fileOf.get(row.id) ?? null,
      revocation,
      status: mandatStatus({ signedOn: row.signedOn, lastCollectionOn: row.lastCollectionBefore, revokedOn: revocation?.revokedOn ?? null }, today),
    };
  });
}

/** Widerruf eines Mandats; je Mandat einer */
export async function revokeMandate(actor: string, mandateId: string, raw: RevocationInput): Promise<void> {
  const input = revocationInputSchema.parse(raw);
  await withActor(actor, async (tx) => {
    const [mandate] = await tx
      .select({ signedOn: schema.sepaMandates.signedOn })
      .from(schema.sepaMandates)
      .where(eq(schema.sepaMandates.id, mandateId))
      .for("share");
    if (!mandate) throw new MandateError("Mandat nicht gefunden.");
    if (input.revokedOn < mandate.signedOn) throw new MandateError("Der Widerruf liegt vor der Unterschrift.");
    const inserted = await tx
      .insert(schema.sepaMandateRevocations)
      .values({ mandateId, revokedOn: input.revokedOn, reason: input.reason, createdBy: actor })
      .onConflictDoNothing()
      .returning({ id: schema.sepaMandateRevocations.id });
    if (inserted.length === 0) throw new MandateError("Das Mandat ist schon widerrufen.");
  });
}

/** Hängt das unterschriebene Mandat als PDF an; ein neues ersetzt das alte in der Anzeige, das alte bleibt gespeichert */
export async function addMandateFile(actor: string, mandateId: string, file: AttachmentFile): Promise<void> {
  const problem = attachmentFileProblem(file);
  if (problem) throw new MandateError(problem);
  await withActor(actor, async (tx) => {
    const [mandate] = await tx.select({ id: schema.sepaMandates.id }).from(schema.sepaMandates).where(eq(schema.sepaMandates.id, mandateId));
    if (!mandate) throw new MandateError("Mandat nicht gefunden.");
    const stored = await storeAttachmentFile(tx, file);
    await tx.insert(schema.sepaMandateFiles).values({ mandateId, ...stored });
  });
}

/** Das geltende PDF eines Mandats, oder null */
export async function mandateFile(mandateId: string): Promise<MandateFile | null> {
  const [file] = await db
    .select({
      filename: schema.sepaMandateFiles.filename,
      sha256: schema.sepaMandateFiles.sha256,
      size: schema.sepaMandateFiles.size,
      createdAt: schema.sepaMandateFiles.createdAt,
    })
    .from(schema.sepaMandateFiles)
    .where(eq(schema.sepaMandateFiles.mandateId, mandateId))
    .orderBy(desc(schema.sepaMandateFiles.createdAt), desc(schema.sepaMandateFiles.id))
    .limit(1);
  return file ?? null;
}
