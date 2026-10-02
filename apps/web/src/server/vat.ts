import {
  computeUstva,
  toElsterSteuernummer,
  type Cents,
  type VatPeriod,
} from "@haben/core";
import {
  buildUstvaXml,
  TEST_HERSTELLER_ID,
  type ElsterClient,
  type ElsterResult,
} from "@haben/elster";
import { and, desc, eq, inArray } from "drizzle-orm";
import { companyIssues, loadCompany } from "./company.ts";
import { decrypt } from "./crypto.ts";
import { computeVatFigures } from "./vat-figures.ts";
import { withActor } from "./db/actor.ts";
import { db, schema } from "./db/index.ts";

export const PRODUKT_VERSION = "0.1.0";

export type VatReturn = typeof schema.vatReturns.$inferSelect;

export class VatError extends Error {}

export async function loadActiveCertificate() {
  const [row] = await db
    .select()
    .from(schema.elsterCertificates)
    .where(eq(schema.elsterCertificates.active, true))
    .orderBy(desc(schema.elsterCertificates.uploadedAt))
    .limit(1);
  return row ?? null;
}

/** Alle Anmeldungen eines Zeitraums, neueste zuerst. */
export async function returnsForPeriod({ year, month }: VatPeriod): Promise<VatReturn[]> {
  return db
    .select()
    .from(schema.vatReturns)
    .where(and(eq(schema.vatReturns.year, year), eq(schema.vatReturns.month, month)))
    .orderBy(desc(schema.vatReturns.createdAt));
}

export async function submissionsFor(returnIds: string[]) {
  if (returnIds.length === 0) return [];
  return db
    .select({
      id: schema.vatReturnSubmissions.id,
      vatReturnId: schema.vatReturnSubmissions.vatReturnId,
      kind: schema.vatReturnSubmissions.kind,
      ok: schema.vatReturnSubmissions.ok,
      code: schema.vatReturnSubmissions.code,
      message: schema.vatReturnSubmissions.message,
      transferTicket: schema.vatReturnSubmissions.transferTicket,
      hasPdf: schema.vatReturnSubmissions.protocolPdf,
      createdAt: schema.vatReturnSubmissions.createdAt,
    })
    .from(schema.vatReturnSubmissions)
    .where(inArray(schema.vatReturnSubmissions.vatReturnId, returnIds))
    .orderBy(desc(schema.vatReturnSubmissions.createdAt))
    .then((rows) => rows.map(({ hasPdf, ...row }) => ({ ...row, hasPdf: hasPdf !== null })));
}

export interface FiguresInput {
  kz81: Cents;
  kz86: Cents;
  kz66: Cents;
}

/** Aus den Buchungen berechnen oder von Hand überschreiben (mit Begründung) */
export type DraftInput = { mode: "berechnet" } | ({ mode: "manuell"; reason?: string } & FiguresInput);

/** Berechnete Kennzahlen in der Form der Voranmeldung (Bemessungsgrundlagen auf volle Euro) */
export async function computedValues(period: VatPeriod) {
  const figures = await computeVatFigures(period);
  const ustva = computeUstva({ kz81: figures.kz81, kz86: figures.kz86, kz66: figures.kz66 });
  return { kz81: ustva.kz81, kz86: ustva.kz86, kz66: ustva.kz66, kz83: ustva.kz83 };
}

/** Legt den Entwurf des Zeitraums an oder aktualisiert ihn. */
export async function saveDraft(actor: string, period: VatPeriod, input: DraftInput | FiguresInput): Promise<VatReturn> {
  const draftInput: DraftInput = "mode" in input ? input : { mode: "manuell", ...input };
  const computed = await computedValues(period);
  const manual = draftInput.mode === "manuell" ? computeUstva(draftInput) : null;
  const values = {
    ...(manual ? { kz81: manual.kz81, kz86: manual.kz86, kz66: manual.kz66, kz83: manual.kz83 } : computed),
    source: draftInput.mode,
    overrideReason: draftInput.mode === "manuell" ? (draftInput.reason?.trim() || null) : null,
    computed,
  };
  return withActor(actor, async (tx) => {
    const [draft] = await tx
      .select()
      .from(schema.vatReturns)
      .where(
        and(
          eq(schema.vatReturns.year, period.year),
          eq(schema.vatReturns.month, period.month),
          eq(schema.vatReturns.status, "draft"),
        ),
      )
      .for("update");
    if (draft) {
      const [updated] = await tx
        .update(schema.vatReturns)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.vatReturns.id, draft.id))
        .returning();
      return updated!;
    }
    const [sent] = await tx
      .select({ id: schema.vatReturns.id })
      .from(schema.vatReturns)
      .where(
        and(
          eq(schema.vatReturns.year, period.year),
          eq(schema.vatReturns.month, period.month),
          eq(schema.vatReturns.status, "sent"),
        ),
      )
      .limit(1);
    if (sent) {
      throw new VatError("Für diesen Zeitraum ist schon eine Anmeldung gesendet. Lege eine berichtigte Anmeldung an.");
    }
    const [created] = await tx
      .insert(schema.vatReturns)
      .values({ year: period.year, month: period.month, ...values })
      .returning();
    return created!;
  });
}

/** Berichtigte Anmeldung (Kz 10) als neuer Entwurf mit den Werten der letzten gesendeten. */
export async function createCorrection(actor: string, period: VatPeriod): Promise<VatReturn> {
  return withActor(actor, async (tx) => {
    const [latest] = await tx
      .select()
      .from(schema.vatReturns)
      .where(
        and(
          eq(schema.vatReturns.year, period.year),
          eq(schema.vatReturns.month, period.month),
          eq(schema.vatReturns.status, "sent"),
        ),
      )
      .orderBy(desc(schema.vatReturns.sentAt))
      .limit(1);
    if (!latest) throw new VatError("Es gibt keine gesendete Anmeldung, die berichtigt werden könnte.");
    const [created] = await tx
      .insert(schema.vatReturns)
      .values({
        year: period.year,
        month: period.month,
        kz81: latest.kz81,
        kz86: latest.kz86,
        kz66: latest.kz66,
        kz83: latest.kz83,
        source: latest.source,
        overrideReason: latest.overrideReason,
        computed: latest.computed,
        berichtigt: true,
        correctsId: latest.id,
      })
      .returning();
    return created!;
  });
}

export type SubmitKind = "validate" | "test" | "send";

export interface SubmitOptions {
  kind: SubmitKind;
  /** Nur für test und send */
  pin?: string;
  herstellerId?: string;
  now?: Date;
}

/**
 * Prüft oder übermittelt den Entwurf. Jeder Versuch landet in vat_return_submissions;
 * eine erfolgreiche Echtübermittlung schreibt die Anmeldung fest.
 */
export async function submitReturn(
  actor: string,
  returnId: string,
  client: ElsterClient,
  options: SubmitOptions,
): Promise<ElsterResult> {
  let [vatReturn] = await db.select().from(schema.vatReturns).where(eq(schema.vatReturns.id, returnId));
  if (!vatReturn) throw new VatError("Anmeldung nicht gefunden.");
  if (vatReturn.status !== "draft") throw new VatError("Diese Anmeldung ist bereits gesendet.");
  // Berechnete Entwürfe vor dem Senden auf den aktuellen Stand der Buchungen bringen
  if (vatReturn.source === "berechnet") {
    vatReturn = await saveDraft(actor, { year: vatReturn.year, month: vatReturn.month }, { mode: "berechnet" });
  }

  const company = await loadCompany();
  const issues = companyIssues(company);
  if (issues.length > 0) throw new VatError(`Firmendaten unvollständig: ${issues.join(", ")}.`);

  const test = options.kind !== "send";
  const herstellerId = test ? TEST_HERSTELLER_ID : options.herstellerId;
  if (!herstellerId) {
    throw new VatError("Für die Echtübermittlung fehlt die Hersteller-ID (ELSTER_HERSTELLER_ID).");
  }

  const xml = buildUstvaXml({
    period: { year: vatReturn.year, month: vatReturn.month },
    steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
    figures: computeUstva(vatReturn),
    datenlieferant: { name: company.name, strasse: company.strasse, plz: company.plz, ort: company.ort },
    herstellerId,
    produktVersion: PRODUKT_VERSION,
    test,
    berichtigt: vatReturn.berichtigt,
    erstellungsdatum: options.now,
  });

  let result: ElsterResult;
  if (options.kind === "validate") {
    result = await client.validate(xml);
  } else {
    if (!options.pin) throw new VatError("Die Zertifikats-PIN fehlt.");
    const certificate = await loadActiveCertificate();
    if (!certificate) throw new VatError("Es ist kein ELSTER-Zertifikat hinterlegt.");
    result = await client.send(xml, decrypt(certificate.ciphertext), options.pin, { test });
  }

  await withActor(actor, async (tx) => {
    await tx.insert(schema.vatReturnSubmissions).values({
      vatReturnId: vatReturn.id,
      kind: options.kind,
      ok: result.ok,
      code: result.code,
      message: result.message,
      transferTicket: result.transferTicket ?? null,
      requestXml: xml,
      responseXml: result.responseXml,
      serverResponseXml: result.serverResponseXml,
      protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
    });
    if (result.ok && options.kind === "send") {
      const now = new Date();
      await tx
        .update(schema.vatReturns)
        .set({
          status: "sent",
          transferTicket: result.transferTicket ?? null,
          sentAt: now,
          lockedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.vatReturns.id, vatReturn.id));
    }
  });

  return result;
}

/** Letzte gesendete Anmeldungen, für den Verlauf. */
export async function recentSentReturns(limit = 6) {
  return db
    .select({
      id: schema.vatReturns.id,
      year: schema.vatReturns.year,
      month: schema.vatReturns.month,
      kz83: schema.vatReturns.kz83,
      berichtigt: schema.vatReturns.berichtigt,
      sentAt: schema.vatReturns.sentAt,
      transferTicket: schema.vatReturns.transferTicket,
    })
    .from(schema.vatReturns)
    .where(eq(schema.vatReturns.status, "sent"))
    .orderBy(desc(schema.vatReturns.sentAt))
    .limit(limit);
}
