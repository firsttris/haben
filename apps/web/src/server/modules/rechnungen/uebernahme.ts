import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "../../db/index.ts";
import { geprueft } from "../../errors.ts";
import { MAX_INVOICE_ATTACHMENTS } from "./attachment-limit.ts";
import { attachmentFileProblem, storeAttachmentFile, type AttachmentFile } from "./attachment-store.ts";
import { putNumberFormats } from "./number-formats.ts";
import { QuoteError } from "./quotes.ts";

/*
 * Nummernformate und Standardanhänge aus der Einstellungsdatei einer anderen Instanz (#488) in der Transaktion des
 * Aufrufers. Zählerstände der Rechnungs- und Angebotsnummern kommen nicht mit: Die neue Instanz beginnt bei 1, wer anders
 * beginnen will, stellt die nächste Nummer ein. Die Anhänge kommen als Bytes, deren SHA-256 modules/instanzwechsel schon
 * geprüft hat.
 */

const formateSchema = z.object({
  invoiceNumberFormat: z.string().max(100),
  quoteNumberFormat: z.string().max(100),
  invoiceCounterRunning: z.boolean(),
  quoteCounterRunning: z.boolean(),
});

export async function nummernformateUebernehmen(tx: Tx, company: unknown): Promise<void> {
  const formate = geprueft(formateSchema, company, "Nummernformate");
  const [current] = await tx
    .select({
      invoiceNumberFormat: schema.company.invoiceNumberFormat,
      quoteNumberFormat: schema.company.quoteNumberFormat,
      invoiceCounterRunning: schema.company.invoiceCounterRunning,
      quoteCounterRunning: schema.company.quoteCounterRunning,
      invoiceCounterPerCustomer: schema.company.invoiceCounterPerCustomer,
      quoteCounterPerCustomer: schema.company.quoteCounterPerCustomer,
    })
    .from(schema.company)
    .where(eq(schema.company.id, 1));
  // Fremdprogramme kennen keine Kundenkreise: die Einstellung bleibt, wie sie ist (#1426)
  await putNumberFormats(
    tx,
    {
      invoice: formate.invoiceNumberFormat,
      quote: formate.quoteNumberFormat,
      invoiceRunning: formate.invoiceCounterRunning,
      quoteRunning: formate.quoteCounterRunning,
    },
    current ?? {
      invoiceNumberFormat: "",
      quoteNumberFormat: "",
      invoiceCounterRunning: false,
      quoteCounterRunning: false,
      invoiceCounterPerCustomer: false,
      quoteCounterPerCustomer: false,
    },
  );
}

export async function standardanhaengeUebernehmen(tx: Tx, files: readonly AttachmentFile[]): Promise<void> {
  if (files.length > MAX_INVOICE_ATTACHMENTS) throw new QuoteError(`Höchstens ${MAX_INVOICE_ATTACHMENTS} Standardanhänge.`);
  for (const file of files) {
    const problem = attachmentFileProblem(file);
    if (problem) throw new QuoteError(`Standardanhang ${problem}`);
    const stored = await storeAttachmentFile(tx, file);
    // Dieselbe Datei zweimal in der Datei ergibt einen Anhang, wie beim Hinzufügen in den Einstellungen
    await tx
      .insert(schema.quoteDefaultAttachments)
      .values({ ...stored, mimeType: "application/pdf" })
      .onConflictDoNothing({ target: schema.quoteDefaultAttachments.sha256 });
  }
}
