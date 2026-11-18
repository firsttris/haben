import { createHash } from "node:crypto";
import { etsyLedgerBatch, parseEtsyLedger, type EtsyLedgerEntry, type ParsedStatement, type ParsedTransaction } from "@haben/import";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { BankError, recordRefusedBatch, storeBatch } from "../bank/index.ts";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";

/*
 * Übernahme des Etsy-Zahlungsverlaufs in das Konto des Zahlungsdienstleisters.
 *
 * Der Verlauf wird zum Kontoauszug (etsy-ledger.ts in @haben/import) und zugleich zur Lieferung des Importvertrags
 * (etsy-batch.ts, #306). Gespeichert wird über `storeBatch` mit der Kennung des Shops als Quelle (Konto der Art „psp“):
 * Einzelzeilen (Verkauf, Erstattung, Auszahlung, Karteneinzug, Ausgleich, Steuer, ungebündelte Gebühren) erkennt Haben
 * an ihrer `entry_id`, Sammelzeilen der Gebühren ohne eigene Kennung wie bisher am Inhalt. Umsätze aus einem Abruf vor
 * der Quellenbindung verbindet `storeBatch` über den Dubletten-Hash mit ihrer Kennung, statt sie neu anzulegen. Eine
 * Lieferung, die der Vertrag ablehnt, speichert nichts; der Abruf meldet den Grund. Der Bankabgleich findet Verkäufe
 * über die Bestellnummer im Zweck.
 *
 * Gibt es kein Konto der Art Zahlungsdienstleister mit Anbieter Etsy, sagt das Ergebnis das und legt nichts an.
 */

export interface EtsyImportResult {
  /** null: kein Konto des Dienstleisters vorhanden */
  accountName: string | null;
  added: number;
  messages: string[];
}

async function providerAccount() {
  const [account] = await db
    .select({ id: schema.bankAccounts.id, name: schema.bankAccounts.name })
    .from(schema.bankAccounts)
    .where(and(eq(schema.bankAccounts.purpose, "zahlungsdienstleister"), eq(schema.bankAccounts.provider, "etsy")))
    .orderBy(asc(schema.bankAccounts.createdAt))
    .limit(1);
  return account ?? null;
}

export interface EtsyImportOptions {
  /** Bestellnummer je Zahlungs- oder Erstattungsnummer aus dem Payments-Abruf */
  orderFor?: (referenceId: string) => string | undefined;
  /** Gebühren und Werbung je Monat bündeln (Vorgabe des Zugangs) */
  sammelzeilen: boolean;
  /** Bündeln nur bis zu diesem Tag; später entstandene Gebühren kommen mit dem nächsten Abruf */
  gebuehrenBis?: string;
  /** Kennung des Abrufs für die Belegdatei, z. B. „2026-11-14“ */
  reference: string;
}

/** Was die Lieferung nach dem Importvertrag zusätzlich braucht */
export interface EtsyAbruf {
  /** Kennung des Shops: Quelle des Abrufs */
  shopId: string;
  /** Erster abgerufener Tag (UTC), YYYY-MM-DD */
  fetchFrom: string;
  now: Date;
}

/**
 * Kennung der Verlaufszeile eines Umsatzes, aber nur, wenn die Lieferung sie als Bewegung führt. Sammelzeilen
 * („etsy-<art>-<JJJJ-MM>“) haben keine; eine Zeile, die der Vertrag nicht annimmt (etwa ein unbekannter Typ unter
 * `unsupported`), auch nicht. Beide erkennt Haben wie bisher am Inhalt, sonst übersprange `storeBatch` den Umsatz.
 */
function eventsOf(movementIds: ReadonlySet<string>) {
  return (t: ParsedTransaction): string | undefined => {
    const id = t.bankReference?.match(/^etsy-(\d+)$/)?.[1];
    return id !== undefined && movementIds.has(id) ? id : undefined;
  };
}

/** Was im Konto schon steht: Sammelzeilen und Verlaufszeilen früherer Abrufe */
interface Vorhanden {
  schonGebuendelt?: ReadonlySet<string>;
  bekannt?: ReadonlyMap<string, { order?: string; verrechnet: number }>;
}

/** Verlauf als Kontoauszug lesen, ohne ihn zu buchen (Vorschau und Tests) */
export function etsyStatement(entries: EtsyLedgerEntry[], options: EtsyImportOptions, vorhanden: Vorhanden = {}): ParsedStatement {
  return parseEtsyLedger(entries, {
    orderFor: options.orderFor,
    sammelzeilen: options.sammelzeilen,
    gebuehrenBis: options.gebuehrenBis,
    schonGebuendelt: vorhanden.schonGebuendelt,
    bekannt: vorhanden.bekannt,
  });
}

/**
 * Verlaufszeilen dieses Abrufs, die ein früherer Abruf schon übernommen hat (`import_movements` der Quelle), mit der
 * Bestellnummer aus dem Zweck ihres Umsatzes und der damals verrechneten Steuer (Umsatz minus Zeile). Die verrechnete
 * Steuerzeile selbst steht nicht in `import_movements`: Gespeichert wird je Umsatz genau eine Bewegung, die
 * des Verkaufs bzw. der Erstattung.
 */
async function bekannteZeilen(shopId: string, entries: EtsyLedgerEntry[]): Promise<Map<string, { order?: string; verrechnet: number }>> {
  const ids = [...new Set(entries.flatMap((e) => (e.entry_id === undefined ? [] : [String(e.entry_id)])))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.importMovements.sourceEventId,
      zeile: schema.importMovements.amount,
      umsatz: schema.bankTransactions.amount,
      zweck: schema.bankTransactions.purpose,
    })
    .from(schema.importMovements)
    .innerJoin(schema.importSources, eq(schema.importSources.id, schema.importMovements.sourceId))
    .innerJoin(schema.bankTransactions, eq(schema.bankTransactions.id, schema.importMovements.transactionId))
    .where(
      and(eq(schema.importSources.provider, "etsy"), eq(schema.importSources.externalAccountId, shopId), inArray(schema.importMovements.sourceEventId, ids)),
    );
  return new Map(rows.map((r) => [r.id, { order: r.zweck?.match(/Etsy Bestellung (\d+)/)?.[1], verrechnet: Number(r.umsatz) - Number(r.zeile) }]));
}

/** Sammelzeilen (Art und Monat), die schon im Konto stehen; ihre Bankreferenz ist „etsy-<art>-<JJJJ-MM>“ */
async function sammelzeilenImKonto(accountId: string): Promise<Set<string>> {
  const rows = await db
    .select({ reference: schema.bankTransactions.bankReference })
    .from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.bankAccountId, accountId), like(schema.bankTransactions.bankReference, "etsy-%")));
  const kennungen = new Set<string>();
  for (const { reference } of rows) {
    const treffer = reference?.match(/^etsy-([a-z]+-\d{4}-\d{2})$/);
    if (treffer?.[1]) kennungen.add(treffer[1]);
  }
  return kennungen;
}

/** Den Verlauf ins Konto des Dienstleisters übernehmen */
export async function importEtsyLedger(actor: string, entries: EtsyLedgerEntry[], options: EtsyImportOptions, abruf: EtsyAbruf): Promise<EtsyImportResult> {
  const account = await providerAccount();
  if (!account) {
    return {
      accountName: null,
      added: 0,
      messages: [
        "Für Etsy gibt es noch kein Konto. Lege unter Bank ein Konto der Art Zahlungsdienstleister mit Anbieter Etsy an; dann übernimmt Haben den Zahlungsverlauf.",
      ],
    };
  }
  const statement = etsyStatement(entries, options, {
    schonGebuendelt: await sammelzeilenImKonto(account.id),
    bekannt: await bekannteZeilen(abruf.shopId, entries),
  });
  const result: EtsyImportResult = { accountName: account.name, added: 0, messages: [...statement.warnings] };
  if (statement.transactions.length === 0) return result;
  const bytes = new TextEncoder().encode(JSON.stringify(statement.transactions));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `etsy-zahlungsverlauf-${options.reference}.json`;
  const batch = etsyLedgerBatch({
    shopId: abruf.shopId,
    entries,
    dateFrom: abruf.fetchFrom,
    dateTo: abruf.now.toISOString().slice(0, 10),
    fetchedAt: abruf.now.toISOString(),
    // Fenster und Zeitpunkt: zwei Abrufe zur selben Zeit mit anderem Fenster sind zwei Lieferungen, nicht eine mit anderem Inhalt
    fetchId: `etsy-${abruf.fetchFrom}-${abruf.now.toISOString()}`,
    orderFor: options.orderFor,
  });
  const input = {
    batch,
    binding: { provider: "etsy", externalAccountId: abruf.shopId, accountKind: "psp" as const },
    statement,
    eventOf: eventsOf(new Set(batch.movements.map((m) => m.sourceEventId))),
    source: { filename, sha256 },
  };
  let imported: Awaited<ReturnType<typeof storeBatch>>;
  try {
    imported = await withActor(actor, (tx) => storeBatch(tx, input, account.id));
  } catch (error) {
    // Abgelehnt (Vertrag oder Konflikt): gespeichert ist nichts, der Grund steht wie bei Enable Banking im Importprotokoll
    if (error instanceof BankError) await withActor(actor, (tx) => recordRefusedBatch(tx, account.id, input, error));
    throw error;
  }
  result.added = imported.added;
  result.messages.push(...imported.warnings);
  if (imported.quelle) result.messages.push(imported.quelle);
  if (imported.gap) result.messages.push(imported.gap);
  return result;
}
