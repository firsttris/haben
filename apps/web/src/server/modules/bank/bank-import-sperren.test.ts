import { type EbTransaction, enableBankingStatement, transactionHash } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { abrufNachVertrag } from "./vertrag-abruf.ts";

const fenster = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };
const umsatz = (purpose: string, booking_date: string, credit_debit_indicator: "DBIT" | "CRDT" = "DBIT"): EbTransaction => ({
  transaction_amount: { currency: "EUR", amount: "49.99" },
  credit_debit_indicator,
  status: "BOOK",
  booking_date,
  remittance_information: [purpose],
});

describe.skipIf(!testDatabaseUrl)("Sperrreihenfolge beim Bankimport (Postgres)", () => {
  let sql: postgres.Sql;
  let datenbank: typeof import("../../db/index.ts");
  let bank: typeof import("./index.ts");
  let vertrag: typeof import("./import-batch.ts");
  let neutralisierung: typeof import("./neutralisierung.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    datenbank = await import("../../db/index.ts");
    bank = await import("./index.ts");
    vertrag = await import("./import-batch.ts");
    neutralisierung = await import("./neutralisierung.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await datenbank?.closeDatabase();
  });

  async function warteAufSperre(sperrenderPid: number) {
    for (let versuch = 0; versuch < 100; versuch++) {
      const [wartend] = await sql<{ pid: number }[]>`select pid from pg_stat_activity where ${sperrenderPid} = any(pg_blocking_pids(pid))`;
      if (wartend) return wartend.pid;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Die erwartete Sperrwartezeit auf Prozess ${sperrenderPid} ist ausgeblieben.`);
  }

  function abruf(iban: string, art: "mit Quellenbindung" | "ohne Quellenbindung", transactions: EbTransaction[]) {
    const fetchId = crypto.randomUUID();
    const statement = enableBankingStatement({ account: { uid: art, account_id: { iban } }, transactions, balances: [], ...fenster });
    const source = { filename: fetchId, sha256: fetchId };
    const { input } = abrufNachVertrag({
      identificationHash: art,
      transactions,
      balances: [],
      ...fenster,
      now: new Date("2026-10-31T12:00:00Z"),
      fetchId,
      statement,
      source,
    });
    const speichern = () =>
      datenbank.db.transaction((tx) => (art === "mit Quellenbindung" ? vertrag.storeBatch(tx, input, null) : bank.storeStatement(tx, statement, source, null)));
    return { statement, source, speichern };
  }

  it.each(["mit Quellenbindung", "ohne Quellenbindung"] as const)(
    "verrechnet zwei Tage ohne Deadlock parallel zu einem Abruf %s",
    async (art) => {
      const mitQuelle = art === "mit Quellenbindung";
      const iban = mitQuelle ? "DE89370400440532013000" : "DE44500105175407324931";
      const { accountId } = await abruf(iban, art, []).speichern();
      const [importiert] = await sql<{ id: string }[]>`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
        values (${accountId}, 'Bestand', 'bestand', 'enablebanking', 3, 0) returning id`;
      const belastung = umsatz("Kartenverifizierung ABC", "2026-10-05");
      const gutschrift = umsatz("Gegenbuchung ABC", "2026-10-06", "CRDT");
      const andereGutschrift = umsatz("Andere Gutschrift", "2026-10-06", "CRDT");
      const ids = [1, 2, 3].map((i) => `00000000-0000-4000-8000-0000000000${mitQuelle ? 1 : 2}${i}`);
      const bestand = abruf(iban, art, [belastung, gutschrift, andereGutschrift]).statement.transactions;
      for (const [index, zeile] of bestand.entries()) {
        await sql`insert into bank_transactions (id, bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
          values (${ids[index]!}, ${accountId}, ${importiert!.id}, ${zeile.bookingDate}, ${zeile.amount}, ${zeile.purpose}, ${transactionHash(zeile, 0)})`;
      }

      const folgeabruf = abruf(iban, art, [belastung, umsatz("Supermarkt", "2026-10-06")]);
      const pausierer = (await import("postgres")).default(testDatabaseUrl!, { max: 1 });
      const parallel: Promise<unknown>[] = [];
      try {
        await pausierer.begin(async (sitzung) => {
          const [session] = await sitzung<{ pid: number }[]>`select pg_backend_pid() as pid`;
          // Der Abruf sperrt die Gutschrift vor dieser dritten Zeile und wartet dann. Die Verrechnung wartet wiederum auf den Abruf.
          await sitzung`select id from bank_transactions where id = ${ids[2]!} for update`;
          const abrufErgebnis = folgeabruf.speichern();
          parallel.push(abrufErgebnis);
          void abrufErgebnis.catch(() => {});
          const abrufPid = await warteAufSperre(session!.pid);
          const verrechnung = neutralisierung.neutralizeTransactions("test", {
            transactionId: ids[0]!,
            counterTransactionId: ids[1]!,
            note: "Kartenverifizierung aufgehoben",
          });
          parallel.push(verrechnung);
          void verrechnung.catch(() => {});
          await warteAufSperre(abrufPid);
        });
      } finally {
        await pausierer.end();
      }
      const ergebnisse = await Promise.allSettled(parallel);
      const fehler = ergebnisse.flatMap((ergebnis) => {
        if (ergebnis.status === "fulfilled") return [];
        const cause = ergebnis.reason?.cause ?? ergebnis.reason;
        return [cause?.code ?? cause?.message];
      });
      expect(fehler).toEqual([]);
      const beobachtet = await sql`select t.transaction_id as id from bank_import_transactions t join bank_imports i on i.id = t.bank_import_id
        where i.bank_account_id = ${accountId} and i.filename = ${folgeabruf.source.filename}`;
      expect(beobachtet.map(({ id }) => id)).toEqual([ids[0]]);
    },
    30_000,
  );
});
