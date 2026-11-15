import { mapSevRecurringInvoice, SevdeskApiError, type SevdeskClient, type SevInvoice } from "@haben/import";
import { eq, sql } from "drizzle-orm";
import { UserError } from "../../errors.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { importRecurringPaused } from "../rechnungen/index.ts";
import { progressMessage } from "./lexoffice.ts";

/*
 * Vorlagen wiederkehrender Rechnungen aus sevDesk (invoiceType WKR, #472). Jede kommt pausiert als wiederkehrende
 * Rechnung in Haben an; die Antwort der API, die abgeleitete Abrechnung und die Platzhalter stehen daneben in
 * sevdesk_recurring_templates. Schon übernommene Vorlagen überspringt ein neuer Abruf, auch wenn sie in Haben gelöscht wurden.
 */

const fatal = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error && error.name === "AbortError") ||
  (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403));

/**
 * invoices sind alle Rechnungen aus GET /Invoice dieses Laufs; an ihnen liest Haben ab, ob eine Vorlage nachfällig abrechnet.
 * Fehler einzelner Vorlagen landen in progress.failed, Token- und Abbruchfehler beenden den Lauf.
 */
export async function importSevdeskRecurringInvoices(
  actor: string,
  importId: string,
  client: SevdeskClient,
  invoices: SevInvoice[],
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const known = new Set((await db.select({ id: schema.sevdeskRecurringTemplates.sevdeskId }).from(schema.sevdeskRecurringTemplates)).map((r) => r.id));
  const result = { imported: 0, known: 0, placeholders: [] as string[] };
  progress.sevdeskRecurring = result;
  try {
    for await (const raw of client.recurringInvoices()) {
      // Der Filter ist nicht beschrieben; was keine Vorlage ist, bleibt hier draußen
      if ((raw.invoiceType ?? "").toUpperCase() !== "WKR") continue;
      const id = String(raw.id);
      if (known.has(id)) {
        result.known += 1;
        continue;
      }
      const label = raw.header?.trim() || `Vorlage ${id}`;
      try {
        if (await importOne(actor, importId, client, raw, invoices)) result.imported += 1;
        else result.known += 1;
      } catch (error) {
        if (fatal(error, signal)) throw error;
        progress.failed.push({
          lexofficeId: `wkr/${id}`,
          number: label,
          message: `Vorlage nicht übernommen: ${progressMessage(error)}`,
        });
      }
    }
  } catch (error) {
    if (fatal(error, signal)) throw error;
    progress.failed.push({
      lexofficeId: "wkr",
      number: "Wiederkehrende Rechnungen",
      message: progressMessage(error),
    });
  }
  result.placeholders = await sevdeskPlaceholders();
}

class TemplateError extends UserError {}

async function importOne(actor: string, importId: string, client: SevdeskClient, raw: SevInvoice, invoices: SevInvoice[]): Promise<boolean> {
  const positions = await client.invoicePositions(String(raw.id));
  const mapped = mapSevRecurringInvoice(raw, positions, invoices);
  if (!mapped.ok) throw new TemplateError(mapped.reason);
  return withActor(actor, async (tx) => {
    const [contact] = mapped.contactSevdeskId
      ? await tx.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sevdeskId, mapped.contactSevdeskId))
      : [];
    if (!contact) throw new TemplateError("Der Kunde der Vorlage ist nicht übernommen.");
    // Zuerst den Nachweis: ein gleichzeitiger Lauf mit derselben Vorlage scheitert an der eindeutigen sevdesk_id
    const [link] = await tx
      .insert(schema.sevdeskRecurringTemplates)
      .values({
        sevdeskId: String(raw.id),
        importId,
        status: mapped.sevStatus,
        billing: mapped.billing,
        billingEvidence: mapped.billingEvidence,
        placeholders: mapped.placeholders,
        hints: mapped.hints,
        raw: { ...(raw as Record<string, unknown>), positions },
      })
      .onConflictDoNothing({
        target: schema.sevdeskRecurringTemplates.sevdeskId,
      })
      .returning({ id: schema.sevdeskRecurringTemplates.id });
    if (!link) return false;
    const { anchorDay, intervalMonths, ...template } = mapped.template;
    const recurringId = await importRecurringPaused(tx, {
      ...template,
      contactId: contact.id,
      intervalMonths,
      anchorDay,
    });
    await tx.update(schema.sevdeskRecurringTemplates).set({ recurringId }).where(eq(schema.sevdeskRecurringTemplates.id, link.id));
    return true;
  });
}

/** Alle Platzhalter der übernommenen Vorlagen, je einmal, damit sie sich später zuordnen lassen */
export async function sevdeskPlaceholders(): Promise<string[]> {
  const rows = await db.execute<{ placeholder: string }>(
    sql`select distinct jsonb_array_elements_text(${schema.sevdeskRecurringTemplates.placeholders}) as placeholder from ${schema.sevdeskRecurringTemplates} order by 1`,
  );
  return rows.map((r) => r.placeholder);
}

/** Herkunft einer wiederkehrenden Rechnung aus sevDesk für ihre Seite; null, wenn sie nicht aus sevDesk kommt */
export async function sevdeskRecurringOrigin(recurringId: string) {
  const [row] = await db
    .select({
      sevdeskId: schema.sevdeskRecurringTemplates.sevdeskId,
      status: schema.sevdeskRecurringTemplates.status,
      billing: schema.sevdeskRecurringTemplates.billing,
      billingEvidence: schema.sevdeskRecurringTemplates.billingEvidence,
      placeholders: schema.sevdeskRecurringTemplates.placeholders,
      hints: schema.sevdeskRecurringTemplates.hints,
      createdAt: schema.sevdeskRecurringTemplates.createdAt,
    })
    .from(schema.sevdeskRecurringTemplates)
    .where(eq(schema.sevdeskRecurringTemplates.recurringId, recurringId));
  return row ?? null;
}
