import {
  ACCOUNT_PURPOSES,
  aufKontoAngeboten,
  direktBuchungenFuerKonto,
  direktKategorienFuerKonto,
  PAYMENT_PROVIDERS,
  directBookingLabel,
  paymentProviderAccount,
  STEUER_POSTEN,
  STEUER_POSTEN_KEYS,
  DARLEHEN_TEILE,
  DARLEHEN_TEIL_KEYS,
  formatEuro,
  STEUERARTEN,
  steuerartenFor,
  suggestDirectBooking,
} from "@haben/core";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { storePayoutView } from "../modules/stores/index.ts";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { suggestMatches } from "@haben/core";
import {
  accountSchema,
  accountSettingsSchema,
  allocate,
  allocateTransfer,
  allocateDirectDebitBatch,
  allocateDirectDebitReturn,
  allocateSplit,
  allocationSchema,
  BankError,
  gemeldeteVoranmeldungen,
  createAccount,
  createProviderAccount,
  providerAccountSchema,
  importStatement,
  listAccounts,
  excludeAccount,
  excludeBlocker,
  includeAccount,
  listExcludedAccounts,
  listLoans,
  learnedDirectSuggestions,
  listTransactions,
  nachStatusSortieren,
  SORTIERRICHTUNGEN,
  UMSATZ_SORTIERFELDER,
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
  neutralizationView,
  neutralizeSchema,
  neutralizeTransactions,
  reverseNeutralization,
} from "../modules/bank/index.ts";
import { deleteEnableBankingSettings, enableBankingSettingsSchema, enableBankingSettingsSummary, saveEnableBankingSettings } from "../modules/bank/index.ts";
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
      sort: z.enum(UMSATZ_SORTIERFELDER).default("datum"),
      dir: z.enum(SORTIERRICHTUNGEN).default("ab"),
    }),
  )
  .handler(async ({ data }) => {
    const accounts = await listAccounts();
    const account = accounts.find((a) => a.id === data.konto) ?? accounts[0] ?? null;
    const rows = account ? await listTransactions(account.id, data.filter, data.suche, { feld: data.sort, richtung: data.dir }) : [];
    // Hinweis je Zeile: gibt es einen Vorschlag, fehlt ein Beleg?
    const items = rows.some((r) => r.open !== 0) ? await openItems() : [];
    const own = await ownAccounts();
    const current = own.find((a) => a.id === account?.id);
    // Ob sich das Konto als „gehört nicht zu dieser Firma“ ausschließen lässt (#462); sonst steht hier der Grund
    const excludeBlockedBy = account ? await excludeBlocker(account.id) : null;
    // Aus früheren Buchungen derselben Gegenpartei, für alle ganz offenen Umsätze in einer Abfrage
    const learned = await learnedDirectSuggestions(rows.filter((r) => r.open !== 0 && r.open === r.amount));
    const mitHinweis = rows.map((row) => {
      if (row.neutralized) return { ...row, suggestion: null, hint: "verrechnet" as const };
      if (row.open === 0) return { ...row, suggestion: null, hint: "zugeordnet" as const };
      const [match] = suggestMatches({ ...row, amount: row.open }, items, 1);
      const hasSuggestion =
        match !== undefined ||
        (row.open === row.amount && current !== undefined && isCertainDirect(suggestDirectBooking(row, current, own))) ||
        // Gelernt, aber auf diesem Konto nicht buchbar (Gebühren auf dem Privatkonto, #873): kein Vorschlag
        (learned.has(row.id) && aufKontoAngeboten(learned.get(row.id)!.kind, account?.purpose ?? null));
      return {
        ...row,
        // Wohin der Vorschlag passt, für die Auskunft unter dem Status; direkte und gelernte Vorschläge haben kein Ziel
        suggestion: match ? { type: match.item.type, number: match.item.number, partyName: match.item.partyName } : null,
        hint: hasSuggestion
          ? ("vorschlag" as const)
          : row.open !== row.amount
            ? ("teilweise" as const)
            : row.amount < 0
              ? ("belegFehlt" as const)
              : ("offen" as const),
      };
    });
    // Datum, Gegenpartei und Betrag sortiert schon die Datenbank, den Status gibt es erst hier (#681)
    const transactions = data.sort === "status" ? nachStatusSortieren(mitHinweis, data.dir) : mitHinweis;
    const selectedId = data.umsatz ?? transactions.find((t) => t.open !== 0)?.id ?? transactions[0]?.id;
    const detail = selectedId ? await transactionDetail(selectedId) : null;
    return {
      accounts,
      /** Monate mit abgegebener Voranmeldung: danach ist der Tag der Aufhebung vorbelegt (#782) */
      gemeldeteMonate: await gemeldeteVoranmeldungen(),
      accountId: account?.id ?? null,
      excludeBlockedBy,
      excludedAccounts: (await listExcludedAccounts()).map((a) => ({ ...a, excludedAt: a.excludedAt?.toISOString() ?? null })),
      transactions,
      detail:
        detail && detail.transaction.bankAccountId === account?.id
          ? { ...detail, neutralization: await neutralizationView(detail.transaction.id), storePayout: await storePayoutView(detail.transaction.id) }
          : null,
      directKinds: await (async () => {
        const { rechtsform } = await loadCompany();
        // Auf einem privaten Konto entfallen vier Angebote (#873)
        return direktBuchungenFuerKonto(rechtsform, account?.purpose ?? "geschaeft").map((value) => ({
          value,
          label: directBookingLabel(value, rechtsform),
        }));
      })(),
      /** Steuerzahlung: Steuerarten der Rechtsform und Teile (Steuer, Zinsen, Zuschläge) */
      steuerarten: steuerartenFor((await loadCompany()).rechtsform).map((value) => ({ value, label: STEUERARTEN[value] })),
      steuerPosten: STEUER_POSTEN_KEYS.map((value) => ({ value, label: STEUER_POSTEN[value] })),
      /** Direkt buchen auf eine Kategorie: Einnahmen und die Ausgabekategorien, die ohne Beleg gehen (#324) */
      kategorien: direktKategorienFuerKonto(account?.purpose ?? "geschaeft"),
      kleinunternehmer: (await loadCompany()).kleinunternehmer,
      /** Darlehen mit Bestand und die Teile einer Rate */
      loans: (await listLoans()).map((l) => ({ value: l.id, label: `${l.name} · Bestand ${formatEuro(l.balance)}` })),
      loanParts: DARLEHEN_TEIL_KEYS.map((value) => ({ value, label: DARLEHEN_TEILE[value] })),
      purposes: Object.entries(ACCOUNT_PURPOSES).map(([value, label]) => ({ value, label })),
      providers: Object.entries(PAYMENT_PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
      /** Sachkonto je Zahlungsdienstleister, zur Anzeige */
      ledgers: Object.fromEntries(
        await Promise.all(
          accounts
            .filter((a) => a.ledgerIndex !== null)
            .map(async (a) => [a.id, paymentProviderAccount((await loadCompany()).kontenrahmen, a.ledgerIndex!)] as const),
        ),
      ),
      sync: { configured: await enableBankingConfigured(), callbackUrl: callbackUrl(), connections: await listConnections() },
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
    const accountId = z
      .uuid()
      .nullable()
      .parse(data.get("accountId") || null);
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

export const excludeBankAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await excludeAccount(context.user.id, data.id);
    return { ok: true };
  });

export const includeBankAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data, context }) => {
    await includeAccount(context.user.id, data.id);
    return { ok: true };
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

/** Aufhebung einer Zuordnung: Pflicht ist der Tag, an dem sie erklärt wird (#782); er ist nicht rückdatiert */
export const reverseAllocationSchema = z.object({
  id: z.uuid(),
  // In der Zukunft aufheben kann niemand; den Rückfall auf das Buchungsdatum verhindert der Tag selbst
  date: z.iso.date().refine((d) => d <= today(), "Das Datum der Aufhebung liegt in der Zukunft."),
});

export const reverseTransactionAllocation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(reverseAllocationSchema)
  .handler(async ({ data, context }) => {
    await reverseAllocation(context.user.id, data.id, data.date);
    return { ok: true };
  });

/** Zwei gegenläufige Umsätze, die sich aufheben, miteinander verrechnen (#457); keine Buchung */
export const neutralizeBankTransactions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(neutralizeSchema)
  .handler(async ({ data, context }) => {
    await neutralizeTransactions(context.user.id, data);
    return { ok: true };
  });

export const reverseBankNeutralization = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await reverseNeutralization(context.user.id, data);
    return { ok: true };
  });

export const getEnableBanks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => listBanks("DE"));

export const connectBank = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      aspspName: z.string().min(1).max(200),
      psuType: z.enum(["personal", "business"]),
      /** Erster Abruf neuer Konten ab diesem Tag; fehlt = ab Jahresbeginn */
      fetchFrom: z.iso.date().nullish(),
    }),
  )
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

/** Zugang zu Enable Banking (Einstellungen › Bank) */
export const getEnableBankingSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => enableBankingSettingsSummary());

export const saveEnableBanking = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(enableBankingSettingsSchema)
  .handler(async ({ data, context }) => {
    await saveEnableBankingSettings(context.user.id, data);
    return { ok: true };
  });

export const removeEnableBanking = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deleteEnableBankingSettings(context.user.id);
    return { ok: true };
  });

/** Sammelgutschrift einer Lastschriftdatei auf ihre Rechnungen aufteilen (#445) */
export const allocateDirectDebitBatchFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ transactionId: z.uuid() }))
  .handler(async ({ data, context }) => {
    await allocateDirectDebitBatch(context.user.id, data.transactionId);
    return { ok: true };
  });

/** Rücklastschrift ihrer Lastschrift zuordnen, Entgelt als Bankgebühr (#445) */
export const allocateDirectDebitReturnFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ transactionId: z.uuid() }))
  .handler(async ({ data, context }) => {
    await allocateDirectDebitReturn(context.user.id, data.transactionId);
    return { ok: true };
  });
