import { createHash } from "node:crypto";
import { UserError } from "../../errors.ts";
import { externalImportSchema, type ExternalImport, type ExternalInvoice, type ExternalQuote } from "./external-schema.ts";

export class ExternalImportError extends UserError {}

function checkAmounts(entry: ExternalInvoice | ExternalQuote) {
  if (entry.net + entry.tax !== entry.gross) throw new ExternalImportError(`Beleg ${entry.number}: Netto, Steuer und Gesamtbetrag passen nicht zusammen.`);
  if (entry.kind === "quote") return;
  if (entry.taxes.reduce((n, t) => n + t.net, 0) !== entry.net || entry.taxes.reduce((n, t) => n + t.tax, 0) !== entry.tax)
    throw new ExternalImportError(`Beleg ${entry.number}: Steuersatzsummen stimmen nicht mit dem Originalbetrag überein.`);
  if ((entry.type.startsWith("purchase") ? "ausgabe" : "einnahme") !== entry.direction)
    throw new ExternalImportError("Belegart und Zahlungsrichtung passen nicht zusammen.");
  const credit = entry.type.endsWith("creditnote");
  if (credit ? entry.gross > 0 : entry.gross < 0) throw new ExternalImportError("Gutschriften haben negative Beträge; Rechnungen positive.");
  const payment = entry.payment;
  if (!payment) return;
  if (Math.abs(payment.openAmount) > Math.abs(entry.gross) || (payment.openAmount !== 0 && Math.sign(payment.openAmount) !== Math.sign(entry.gross)))
    throw new ExternalImportError("Ungültiger übernommener Zahlungsstand.");
  if (entry.status === "paid" && payment.openAmount !== 0) throw new ExternalImportError("Bezahlt-Status und offener Betrag widersprechen sich.");
  if (
    payment.paidDate &&
    (payment.openAmount !== 0 ||
      payment.items.reduce((n, p) => n + Math.abs(p.amount), 0) !== Math.abs(entry.gross) ||
      payment.items
        .map((p) => p.date)
        .sort()
        .at(-1) !== payment.paidDate)
  )
    throw new ExternalImportError("Ein Ausgleichsdatum braucht passende belegte Einzelzahlungen; ungeklärte Datumsangaben gehören in den Herkunftsnachweis.");
}

/** Derselbe schreibfreie Prüflauf für Vorschau und Anwenden; keine zweite Fassung der Geldregeln. */
export async function validateExternalImport(input: ExternalImport, fileForHash: (hash: string) => Promise<Uint8Array>) {
  const parsed = externalImportSchema.parse(input);
  const keys = parsed.entries.map((e) => `${e.kind}:${e.externalId}`);
  if (new Set(keys).size !== keys.length) throw new ExternalImportError("Eine Quellidentität kommt mehrfach im Paket vor.");
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of parsed.entries) {
    if (entry.kind === "journal") {
      const sum = (side: "debit" | "credit") => entry.lines.reduce((n, l) => n + l[side], 0);
      if (sum("debit") !== sum("credit") || sum("debit") === 0) throw new ExternalImportError("Die Buchung ist nicht ausgeglichen.");
      continue;
    }
    checkAmounts(entry);
    const known = files.has(entry.pdfSha256);
    const bytes = files.get(entry.pdfSha256) ?? (await fileForHash(entry.pdfSha256));
    if (bytes.length > 20 * 1024 * 1024 || !Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from("%PDF-")))
      throw new ExternalImportError("Ungültiges Original-PDF.");
    if (createHash("sha256").update(bytes).digest("hex") !== entry.pdfSha256)
      throw new ExternalImportError("Original-PDF und Herkunfts-Hash stimmen nicht überein.");
    if (!known) total += bytes.length;
    if (total > 128 * 1024 * 1024) throw new ExternalImportError("Das Paket enthält mehr als 128 MiB Originale. Bitte in kleinere Pakete teilen.");
    files.set(entry.pdfSha256, bytes);
  }
  return { parsed, files };
}
