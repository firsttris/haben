import { DIRECT_BOOKINGS } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { suggestMatches } from "@haben/core";
import {
  accountSchema,
  allocate,
  allocationSchema,
  BankError,
  createAccount,
  importStatement,
  listAccounts,
  listTransactions,
  openItems,
  reverseAllocation,
  transactionDetail,
} from "../bank.ts";
import { callbackUrl, enableBankingConfigured, listBanks, listConnections, removeConnection, startConnection, syncConnection } from "../bank-sync.ts";
import { authMiddleware } from "../middleware.ts";

function asUserError(error: unknown): never {
  if (error instanceof BankError) throw new Error(error.message);
  throw error;
}

export const getBankOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      konto: z.uuid().optional(),
      filter: z.enum(["offen", "zugeordnet", "alle"]).default("offen"),
      suche: z.string().max(100).default(""),
      umsatz: z.uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const accounts = await listAccounts();
    const account = accounts.find((a) => a.id === data.konto) ?? accounts[0] ?? null;
    const rows = account ? await listTransactions(account.id, data.filter, data.suche) : [];
    // Hinweis je Zeile: gibt es einen Vorschlag, fehlt ein Beleg?
    const items = rows.some((r) => r.open !== 0) ? await openItems() : [];
    const transactions = rows.map((row) => {
      if (row.open === 0) return { ...row, hint: "zugeordnet" as const };
      const hasSuggestion = suggestMatches({ ...row, amount: row.open }, items, 1).length > 0;
      return {
        ...row,
        hint: hasSuggestion ? ("vorschlag" as const) : row.open !== row.amount ? ("teilweise" as const) : row.amount < 0 ? ("belegFehlt" as const) : ("offen" as const),
      };
    });
    const selectedId = data.umsatz ?? transactions.find((t) => t.open !== 0)?.id ?? transactions[0]?.id;
    const detail = selectedId ? await transactionDetail(selectedId) : null;
    return {
      accounts,
      accountId: account?.id ?? null,
      transactions,
      detail: detail && detail.transaction.bankAccountId === account?.id ? detail : null,
      directKinds: Object.entries(DIRECT_BOOKINGS).map(([value, label]) => ({ value, label })),
      sync: { configured: enableBankingConfigured(), callbackUrl: callbackUrl(), connections: await listConnections() },
    };
  });

export const importStatements = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new Error("Keine Datei ausgewählt.");
    if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new Error("Eine Datei ist größer als 20 MB.");
    const accountId = z.uuid().nullable().parse(data.get("accountId") || null);
    return { files, accountId };
  })
  .handler(async ({ data, context }) => {
    const results = [];
    for (const file of data.files) {
      try {
        const result = await importStatement(context.user.id, { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name }, data.accountId);
        results.push({ filename: file.name, ...result });
      } catch (error) {
        if (!(error instanceof BankError)) throw error;
        results.push({ filename: file.name, error: error.message });
      }
    }
    return results;
  });

export const addBankAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(accountSchema)
  .handler(async ({ data, context }) => {
    const account = await createAccount(context.user.id, data).catch(asUserError);
    return { id: account.id };
  });

export const allocateTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(allocationSchema)
  .handler(async ({ data, context }) => {
    await allocate(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const reverseTransactionAllocation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reverseAllocation(context.user.id, data).catch(asUserError);
    return { ok: true };
  });

export const getEnableBanks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => listBanks("DE").catch(asUserError));

export const connectBank = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ aspspName: z.string().min(1).max(200), psuType: z.enum(["personal", "business"]) }))
  .handler(async ({ data, context }) => startConnection(context.user.id, { ...data, country: "DE" }).catch(asUserError));

export const syncBankConnection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const result = await syncConnection(context.user.id, data).catch(asUserError);
    return { added: result.added, error: result.error, gaps: result.accounts.flatMap((a) => (a.gap ? [a.gap] : [])) };
  });

export const disconnectBank = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await removeConnection(context.user.id, data).catch(asUserError);
    return { ok: true };
  });
