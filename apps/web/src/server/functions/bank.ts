import { ACCOUNT_PURPOSES, DIRECT_BOOKINGS, PAYMENT_PROVIDERS, paymentProviderAccount, suggestDirectBooking } from "@haben/core";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { suggestMatches } from "@haben/core";
import {
  accountSchema,
  accountSettingsSchema,
  allocate,
  allocateTransfer,
  allocateSplit,
  allocationSchema,
  BankError,
  createAccount,
  createProviderAccount,
  providerAccountSchema,
  importStatement,
  listAccounts,
  listTransactions,
  openItems,
  ownAccounts,
  updateAccount,
  reverseAllocation,
  splitSchema,
  transactionDetail,
  transferSchema,
  allocateWithRest,
  allocateFeesToDocument,
  feesSchema,
  restSchema,
  reverseWriteOff,
  writeOff,
  writeOffSchema,
} from "../modules/bank/index.ts";
import { callbackUrl, enableBankingConfigured, listBanks, listConnections, removeConnection, startConnection, syncConnection } from "../modules/bank/index.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";
import { UserError } from "../errors.ts";

/** In der Liste nur sichere Vorschläge; „PayPal“ als Gegenpartei braucht die Gegenbuchung, die erst die Detailansicht sucht */
const isCertainDirect = (s: ReturnType<typeof suggestDirectBooking>) => s !== null && !s.requiresCounterpart;

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
    const own = await ownAccounts();
    const current = own.find((a) => a.id === account?.id);
    const transactions = rows.map((row) => {
      if (row.open === 0) return { ...row, hint: "zugeordnet" as const };
      const hasSuggestion =
        suggestMatches({ ...row, amount: row.open }, items, 1).length > 0 ||
        (row.open === row.amount && current !== undefined && isCertainDirect(suggestDirectBooking(row, current, own)));
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
      purposes: Object.entries(ACCOUNT_PURPOSES).map(([value, label]) => ({ value, label })),
      providers: Object.entries(PAYMENT_PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
      /** Sachkonto je Zahlungsdienstleister, zur Anzeige */
      ledgers: Object.fromEntries(
        await Promise.all(
          accounts.filter((a) => a.ledgerIndex !== null).map(async (a) => [a.id, paymentProviderAccount((await loadCompany()).kontenrahmen, a.ledgerIndex!)] as const),
        ),
      ),
      sync: { configured: enableBankingConfigured(), callbackUrl: callbackUrl(), connections: await listConnections() },
    };
  });

export const importStatements = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const files = data.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) throw new UserError("Keine Datei ausgewählt.");
    if (files.length > 50) throw new UserError("Höchstens 50 Dateien auf einmal.");
    if (files.some((f) => f.size > 20 * 1024 * 1024)) throw new UserError("Eine Datei ist größer als 20 MB.");
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
    const account = await createAccount(context.user.id, data);
    return { id: account.id };
  });

export const addProviderAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(providerAccountSchema)
  .handler(async ({ data, context }) => {
    const account = await createProviderAccount(context.user.id, data);
    return { id: account.id };
  });

export const updateBankAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(accountSettingsSchema)
  .handler(async ({ data, context }) => {
    await updateAccount(context.user.id, data);
    return { ok: true };
  });

export const transferBetweenAccounts = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(transferSchema)
  .handler(async ({ data, context }) => {
    await allocateTransfer(context.user.id, data);
    return { ok: true };
  });

export const allocateTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(allocationSchema)
  .handler(async ({ data, context }) => {
    await allocate(context.user.id, data);
    return { ok: true };
  });

export const splitTransaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(splitSchema)
  .handler(async ({ data, context }) => {
    await allocateSplit(context.user.id, data);
    return { ok: true };
  });

export const allocateTransactionWithRest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(restSchema)
  .handler(async ({ data, context }) => {
    await allocateWithRest(context.user.id, data);
    return { ok: true };
  });

export const allocateProviderFees = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(feesSchema)
  .handler(async ({ data, context }) => ({ count: await allocateFeesToDocument(context.user.id, data) }));

export const writeOffRest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(writeOffSchema)
  .handler(async ({ data, context }) => {
    await writeOff(context.user.id, data);
    return { ok: true };
  });

export const reverseWriteOffFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reverseWriteOff(context.user.id, data, today());
    return { ok: true };
  });

export const reverseTransactionAllocation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reverseAllocation(context.user.id, data);
    return { ok: true };
  });

export const getEnableBanks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => listBanks("DE"));

export const connectBank = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ aspspName: z.string().min(1).max(200), psuType: z.enum(["personal", "business"]) }))
  .handler(async ({ data, context }) => startConnection(context.user.id, { ...data, country: "DE" }));

export const syncBankConnection = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    const result = await syncConnection(context.user.id, data);
    return { added: result.added, error: result.error, gaps: result.accounts.flatMap((a) => (a.gap ? [a.gap] : [])) };
  });

export const disconnectBank = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await removeConnection(context.user.id, data);
    return { ok: true };
  });
