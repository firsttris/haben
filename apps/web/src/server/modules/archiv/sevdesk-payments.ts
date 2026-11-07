import { mapSevPaymentLogs, SevdeskApiError, type SevCheckAccountTransactionLog, type SevdeskClient } from "@haben/import";
import { eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import type { LexofficeImportProgress } from "../../db/schema.ts";
import { progressMessage } from "./lexoffice.ts";
import { effectivePayment, paymentHistoryIssue } from "./payment-history.ts";

/*
 * Einzelzahlungen aus sevDesk (#343): CheckAccountTransactionLog ordnet einen Bankumsatz mit Betrag einem Beleg zu,
 * bei geteilten Umsätzen je Beleg einzeln. Nur lesend; die Archivkopie bleibt unverändert. Neue Zuordnungen kommen als
 * eigene Zeilen hinzu, so werden auch früher übernommene, verdichtete Belege repariert. Ob die Zahlungen den
 * Zahlungsstand ergeben, prüft paymentHistoryIssue; sonst bleibt die Sperre.
 */
export async function importSevdeskPayments(
  actor: string,
  importId: string,
  client: SevdeskClient,
  progress: LexofficeImportProgress,
  signal: AbortSignal,
): Promise<void> {
  const vouchers = await db
    .select({
      id: schema.lexofficeVouchers.id,
      lexofficeId: schema.lexofficeVouchers.lexofficeId,
      source: schema.lexofficeVouchers.source,
      gross: schema.lexofficeVouchers.gross,
      status: schema.lexofficeVouchers.status,
      payment: effectivePayment("lexoffice_vouchers"),
    })
    .from(schema.lexofficeVouchers)
    .where(eq(schema.lexofficeVouchers.source, "sevdesk"));
  // Alle Logs kosten viele Seiten; nur abrufen, wenn noch eine Zahlungshistorie offen ist
  const pending = new Map(vouchers.filter((v) => paymentHistoryIssue(v)).map((v) => [v.lexofficeId, v.id]));
  if (pending.size === 0) return;
  try {
    const logs: SevCheckAccountTransactionLog[] = [];
    for await (const log of client.checkAccountTransactionLogs()) logs.push(log);
    const accounts = new Map<string, string | null>();
    for await (const account of client.checkAccounts()) accounts.set(String(account.id), account.name ?? null);
    const raw = new Map(logs.map((l) => [String(l.id), l]));
    const rows = [...mapSevPaymentLogs(logs)].flatMap(([key, items]) => {
      const voucherId = pending.get(key);
      if (!voucherId) return [];
      return items.map((i) => ({
        voucherId,
        importId,
        source: "sevdesk" as const,
        externalId: i.sourceId,
        transactionId: i.transactionId,
        accountId: i.accountId,
        accountName: i.accountId ? (accounts.get(i.accountId) ?? null) : null,
        date: i.date,
        amount: i.amount,
        raw: raw.get(i.sourceId) as Record<string, unknown>,
      }));
    });
    if (rows.length === 0) return;
    await withActor(actor, (tx) =>
      tx
        .insert(schema.legacyVoucherPayments)
        .values(rows)
        .onConflictDoNothing({ target: [schema.legacyVoucherPayments.source, schema.legacyVoucherPayments.externalId] }),
    );
  } catch (error) {
    if (signal.aborted || (error instanceof SevdeskApiError && (error.status === 401 || error.status === 403))) throw error;
    // Ohne den Endpunkt bleibt die Sperre wie bisher bestehen; das ist kein Fehler des Abrufs
    if (error instanceof SevdeskApiError && error.status === 404) return;
    progress.failed.push({ lexofficeId: "payments", number: "Einzelzahlungen", message: `Einzelzahlungen nicht abgerufen: ${progressMessage(error)}` });
  }
}
