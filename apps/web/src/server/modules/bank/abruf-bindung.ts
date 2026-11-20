import { INTERNAL_PROVIDERS } from "@haben/import";
import { and, eq, inArray, notInArray, type SQL, sql } from "drizzle-orm";
import { type Db, schema, type Tx } from "../../db/index.ts";
import { BankError } from "./bank-error.ts";

/*
 * Ein Konto bekommt Umsätze nur aus einer Quelle (#306, Schritt 4). Konten, die an einen Abruf in Haben gebunden sind,
 * bekommen keine externe Quelle, auch vor dem ersten Abruf, solange noch keine Quellenbindung in import_sources steht; ein
 * Konto mit externer Quelle bekommt umgekehrt keinen Abruf: nicht beim Verbinden (kontenUebernehmen, Zugang zu PayPal,
 * Stripe und Etsy) und nicht beim ersten Abruf (sourceFor in import-batch.ts).
 */

/** Je Anbindung die Konten, in die ihr Abruf schreibt; tsc verlangt einen Eintrag für jeden Anbieter aus INTERNAL_PROVIDERS */
const ANBINDUNGEN = {
  // Zugeordnete Konten jeder Zustimmung, auch ohne identification_hash und vor dem ersten Abruf (bank-sync.ts)
  enablebanking: sql`select (a->>'bankAccountId')::uuid from ${schema.bankConnections} c, jsonb_array_elements(c.accounts) a`,
  // Der Abruf schreibt in das älteste Konto des Dienstleisters (providerAccount in etsy/, paypal/, stripe/import.ts)
  etsy: pspKonto("etsy", sql`exists (select 1 from ${schema.etsyConnections} where ${schema.etsyConnections.shopId} <> '')`),
  paypal: pspKonto("paypal", sql`exists (select 1 from ${schema.paypalConnections})`),
  stripe: pspKonto("stripe", sql`exists (select 1 from ${schema.stripeConnections})`),
} satisfies Record<(typeof INTERNAL_PROVIDERS)[number], SQL>;

/** FinTS hat keinen Anbieter in import_sources, bindet seine Konten aber genauso (fints.ts) */
const FINTS = sql`select (a->>'bankAccountId')::uuid from ${schema.fintsConnections} c, jsonb_array_elements(c.accounts) a`;

function pspKonto(provider: string, verbunden: SQL = sql`true`): SQL {
  return sql`(select ${schema.bankAccounts.id} from ${schema.bankAccounts}
    where ${schema.bankAccounts.purpose} = 'zahlungsdienstleister' and ${schema.bankAccounts.provider} = ${provider} and ${verbunden}
    order by ${schema.bankAccounts.createdAt} limit 1)`;
}

/** Konten mit irgendeiner Quelle: Quellenbindung (auch extern und ohne Stichtag), Bankabruf, FinTS, Etsy, PayPal, Stripe */
export async function gebundeneKonten(tx: Tx | Db): Promise<string[]> {
  const teile = [sql`select ${schema.importSources.bankAccountId} from ${schema.importSources}`, FINTS, ...Object.values(ANBINDUNGEN)];
  const rows = await tx.execute<{ id: string }>(sql`select distinct id from (${sql.join(teile, sql` union all `)}) k(id) where id is not null`);
  return rows.map((r) => r.id);
}

/** Fehler, wenn eines der Konten schon eine externe Quelle hat */
export async function keineExterneQuelle(tx: Tx | Db, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const [quelle] = await tx
    .select({ provider: schema.importSources.provider, name: schema.bankAccounts.name })
    .from(schema.importSources)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.importSources.bankAccountId))
    .where(and(inArray(schema.importSources.bankAccountId, accountIds), notInArray(schema.importSources.provider, [...INTERNAL_PROVIDERS])))
    .limit(1);
  if (quelle) {
    throw new BankError(
      `Das Konto ${quelle.name} bekommt seine Umsätze schon über die Schnittstelle (${quelle.provider}); ein Konto bekommt Umsätze nur aus einer Quelle.`,
    );
  }
}

/** Dasselbe für das Konto, in das der Abruf eines Zahlungsdienstleisters schreiben würde, beim Speichern des Zugangs */
export async function keineExterneQuelleFuerAbruf(tx: Tx | Db, provider: "etsy" | "paypal" | "stripe"): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`select id from ${pspKonto(provider)} k(id)`);
  await keineExterneQuelle(
    tx,
    rows.map((r) => r.id),
  );
}
