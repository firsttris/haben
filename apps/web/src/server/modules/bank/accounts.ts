// Bankkonten und Konten der Zahlungsdienstleister: anlegen, ändern, auflisten

import { BankError } from "./bank-error.ts";
import type { OwnAccount } from "@haben/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Tx } from "../../db/index.ts";
import { bankOpenAmountSql as openAmountSql } from "../../db/bank-open.ts";
import { today } from "../../today.ts";
import { nichtPrivat, zaehlePrivat } from "./privat-kennzeichnung.ts";

export const normalizeIban = (iban: string) => iban.replace(/\s/g, "").toUpperCase();

const purposeSchema = z.enum(["geschaeft", "steuer", "ruecklage", "privat"]);

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  purpose: purposeSchema.default("geschaeft"),
  iban: z
    .string()
    .transform(normalizeIban)
    .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "IBAN ungültig")),
});

/**
 * Ein Import mit Inhalt: Der Eintrag eines abgelehnten Abrufs (`recordRefusedBatch`) hat weder Zeitraum noch Umsätze und
 * zählt nicht als letzter Import (Kontostand, Saldenfolge). Ohne diese Bedingung käme er bei `desc(periodTo)` zuerst. Ebenso
 * der Eintrag zu einem Umsatz, den Haben nach einem Konflikt übernommen hat (`resolveConflict`): ohne Zeitraum und Salden.
 */
export const echterImport = sql`not (${schema.bankImports.periodTo} is null and ${schema.bankImports.added} = 0 and ${schema.bankImports.skipped} = 0)
  and not exists (select 1 from import_resolutions r join bank_transactions t on t.id = r.transaction_id where t.import_id = ${schema.bankImports.id})`;

export async function listAccounts() {
  const accounts = await db.select().from(schema.bankAccounts).where(isNull(schema.bankAccounts.excludedAt)).orderBy(asc(schema.bankAccounts.name));
  return Promise.all(
    accounts.map(async (account) => {
      const [last] = await db
        .select({
          periodTo: schema.bankImports.periodTo,
          closingBalance: schema.bankImports.closingBalance,
          createdAt: schema.bankImports.createdAt,
          format: schema.bankImports.format,
        })
        .from(schema.bankImports)
        .where(and(eq(schema.bankImports.bankAccountId, account.id), echterImport))
        .orderBy(desc(schema.bankImports.periodTo), desc(schema.bankImports.createdAt))
        .limit(1);
      const [open] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bankTransactions)
        .where(and(eq(schema.bankTransactions.bankAccountId, account.id), sql`${openAmountSql} <> 0`, nichtPrivat()));
      // Umsätze, die auf einem privaten Konto nicht buchbar sind, zählen nicht als offen, sondern stehen daneben (#1088)
      const privateCount = await zaehlePrivat(account.id);
      // Zahlungsdienstleister nennen keinen Kontostand: Guthaben als Summe der importierten Umsätze
      const [sum] =
        account.purpose === "zahlungsdienstleister"
          ? await db
              .select({ total: sql<string>`coalesce(sum(${schema.bankTransactions.amount}), 0)` })
              .from(schema.bankTransactions)
              .where(eq(schema.bankTransactions.bankAccountId, account.id))
          : [];
      // Beim Dienstleister bleibt nach zwei Wochen nichts offen, was zugeordnet werden kann; sonst fehlt eine Zuordnung
      const [stale] =
        account.purpose === "zahlungsdienstleister"
          ? await db
              .select({ n: sql<number>`count(*)::int` })
              .from(schema.bankTransactions)
              .where(
                and(
                  eq(schema.bankTransactions.bankAccountId, account.id),
                  sql`${openAmountSql} <> 0`,
                  sql`${schema.bankTransactions.bookingDate} < ${today()}::date - 14`,
                ),
              )
          : [];
      return {
        ...account,
        lastImport: last ?? null,
        openCount: open?.n ?? 0,
        privateCount,
        providerBalance: sum ? Number(sum.total) : null,
        staleOpenCount: stale?.n ?? 0,
      };
    }),
  );
}

export async function createAccount(actor: string, input: z.input<typeof accountSchema>) {
  const data = accountSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [existing] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, data.iban));
    if (existing?.excludedAt)
      throw new BankError(`Das Konto ${existing.name} mit dieser IBAN ist ausgeschlossen. Bitte erst unter „Ausgeschlossene Konten“ wieder aufnehmen.`);
    if (existing) throw new BankError("Ein Konto mit dieser IBAN gibt es schon.");
    const [created] = await tx.insert(schema.bankAccounts).values(data).returning();
    return created!;
  });
}

/** Zweck nur bei Bankkonten; ein Zahlungsdienstleister bleibt einer */
export const accountSettingsSchema = z.object({ id: z.uuid(), name: accountSchema.shape.name, purpose: purposeSchema.optional() });

/**
 * Name und Zweck eines Kontos ändern. Beides ist nur Anzeige bzw. Vorschlag: Umsätze hängen an der ID,
 * der Import findet das Konto über die IBAN, Buchungen gehen weiter auf das eine Bankkonto.
 */
export async function updateAccount(actor: string, input: z.infer<typeof accountSettingsSchema>) {
  await withActor(actor, async (tx) => {
    const [account] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, input.id)).for("update");
    if (!account) throw new BankError("Konto nicht gefunden.");
    // Ein Zahlungsdienstleister bleibt einer (eigenes Verrechnungskonto, keine IBAN); dort ändert sich nur der Name
    const purpose = account.purpose === "zahlungsdienstleister" ? account.purpose : (input.purpose ?? account.purpose);
    await tx.update(schema.bankAccounts).set({ name: input.name, purpose }).where(eq(schema.bankAccounts.id, input.id));
  });
}

export const providerAccountSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(100),
  provider: z.enum(["paypal", "stripe", "shopify", "etsy", "ebay", "sumup", "googleplay", "appstore", "sonstige"]),
});

/**
 * Konto für einen Zahlungsdienstleister (PayPal-Guthaben, Stripe, Shopify Payments): ohne IBAN, mit eigenem
 * Verrechnungskonto (1361 … bzw. 1461 …). Importiert wird dessen CSV-Export in dieses Konto.
 */
export async function createProviderAccount(actor: string, input: z.input<typeof providerAccountSchema>) {
  const data = providerAccountSchema.parse(input);
  return withActor(actor, async (tx) => {
    // Sperre gegen zwei gleichzeitige Anlagen mit derselben Nummer; die Spalte ist zusätzlich eindeutig
    await tx.execute(sql`lock table bank_accounts in share row exclusive mode`);
    const used = new Set((await tx.select({ i: schema.bankAccounts.ledgerIndex }).from(schema.bankAccounts)).map((r) => r.i));
    const ledgerIndex = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((i) => !used.has(i));
    if (!ledgerIndex) throw new BankError("Es gibt schon neun Zahlungsdienstleister; mehr Verrechnungskonten sieht Haben nicht vor.");
    const [created] = await tx
      .insert(schema.bankAccounts)
      .values({ name: data.name, iban: null, purpose: "zahlungsdienstleister", provider: data.provider, ledgerIndex })
      .returning();
    return created!;
  });
}

/** Konto zur IBAN; fehlt es, wird es angelegt */
export async function accountForIban(tx: Tx, iban: string, name?: string) {
  const normalized = normalizeIban(iban);
  const [existing] = await tx.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.iban, normalized));
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.bankAccounts)
    .values({ iban: normalized, name: name || `Konto …${normalized.slice(-4)}` })
    .returning();
  return created!;
}

/** Alle eigenen Konten mit Zweck, für Vorschläge ohne Rechnung */
export async function ownAccounts(): Promise<OwnAccount[]> {
  return db
    .select({
      id: schema.bankAccounts.id,
      name: schema.bankAccounts.name,
      iban: schema.bankAccounts.iban,
      purpose: schema.bankAccounts.purpose,
      provider: schema.bankAccounts.provider,
    })
    .from(schema.bankAccounts)
    .where(isNull(schema.bankAccounts.excludedAt));
}
