import { type EbTransaction, enableBankingBatch, enableBankingStatement, entryReferenceOf } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Schritt 3 aus #306: Lieferungen des Importvertrags speichern. Jeder Test nimmt ein eigenes Konto (IBAN und Kennung),
 * damit sie sich nicht gegenseitig beeinflussen.
 */

let nr = 0;
/** Gültige deutsche IBAN mit Prüfziffer (ISO 13616) */
function iban(konto: number): string {
  const bban = `50010517${String(konto).padStart(10, "0")}`;
  const rest = [...`${bban}131400`].reduce((r, d) => (r * 10 + Number(d)) % 97, 0);
  return `DE${String(98 - rest).padStart(2, "0")}${bban}`;
}
const neuesKonto = () => {
  nr++;
  return { iban: iban(7_000_000 + nr), hash: `hash-${nr}-${Math.random()}` };
};

const tx = (ref: string | null, booking_date: string, amount = "49.99", over: Partial<EbTransaction> = {}): EbTransaction => ({
  entry_reference: ref,
  transaction_amount: { currency: "EUR", amount },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date,
  creditor: { name: "Telekom" },
  creditor_account: { iban: "DE89370400440532013000" },
  remittance_information: ["Rechnung 9/2026"],
  ...over,
});

describe.skipIf(!testDatabaseUrl)("storeBatch (Postgres)", () => {
  let importBatch: typeof import("./import-batch.ts");
  let bank: typeof import("./bank.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    importBatch = await import("./import-batch.ts");
    bank = await import("./bank.ts");
    db = await import("../../db/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  function abruf(konto: { iban: string; hash: string }, transactions: EbTransaction[], over: { fetchId?: string; from?: string; to?: string } = {}) {
    const window = { dateFrom: over.from ?? "2026-10-01", dateTo: over.to ?? "2026-10-31" };
    const fetchId = over.fetchId ?? `abruf-${Math.random()}`;
    const ohneReferenz = (u: { reason: string }) => u.reason.includes("ohne entry_reference");
    const batch = enableBankingBatch({
      externalAccountId: konto.hash,
      transactions,
      balances: [],
      ...window,
      fetchedAt: `${window.dateTo}T23:00:00+01:00`,
      fetchId,
    });
    return {
      batch: { ...batch, unsupported: batch.unsupported.filter((u) => !ohneReferenz(u)) },
      binding: { provider: "enablebanking", externalAccountId: konto.hash, accountKind: "bank" as const },
      statement: enableBankingStatement({
        account: { uid: "u", account_id: { iban: konto.iban }, name: "Geschäftskonto" },
        transactions,
        balances: [],
        ...window,
      }),
      eventOf: entryReferenceOf(transactions),
      source: { filename: `Abruf ${fetchId}`, sha256: fetchId },
    };
  }

  const speichere = (input: ReturnType<typeof abruf>) => db.db.transaction((t) => importBatch.storeBatch(t, input, null));

  async function umsaetze(iban: string) {
    return sql<{ amount: number; bank_reference: string | null }[]>`
      select t.amount, t.bank_reference from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
      where a.iban = ${iban} order by t.booking_date, t.bank_reference`;
  }

  it("legt beim ersten Abruf Bindung, Lieferung, Bewegungen und Umsätze an", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-06", "10.00")]));
    expect(r).toMatchObject({ added: 2, skipped: 0, checkpoint: "2026-10-31", complete: true, replay: false });
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
    const [bindung] = await sql`select count(*)::int as n from import_sources where external_account_id = ${konto.hash}`;
    expect(bindung!.n).toBe(1);
    const bewegungen = await sql`select m.source_event_id from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash} order by 1`;
    expect(bewegungen.map((b) => b.source_event_id)).toEqual(["ER-1", "ER-2"]);
  });

  it("gibt dieselbe Lieferung noch einmal ohne neue Umsätze zurück", async () => {
    const konto = neuesKonto();
    const input = abruf(konto, [tx("ER-1", "2026-10-05")], { fetchId: "gleich" });
    await speichere(input);
    const r = await speichere(input);
    expect(r).toMatchObject({ added: 0, replay: true, checkpoint: "2026-10-31" });
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("lehnt denselben Schlüssel mit anderem Inhalt ab", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { fetchId: "gleich" }));
    await expect(speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-07")], { fetchId: "gleich" }))).rejects.toThrow(
      "kam schon mit anderem Inhalt",
    );
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("erkennt bekannte Bewegungen im überlappenden Folgeabruf und legt nur neue an", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-11-03", "5.00")], { from: "2026-10-01", to: "2026-11-05" }));
    expect(r).toMatchObject({ added: 1, skipped: 1, checkpoint: "2026-11-05" });
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("behält einen gleichartigen Umsatz mit anderer entry_reference aus einem späteren Abruf", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-05")]));
    expect(r.added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("speichert bei einem Konflikt am Betrag nichts und lässt den Stand stehen", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await expect(speichere(abruf(konto, [tx("ER-1", "2026-10-05", "50.00"), tx("ER-2", "2026-10-20")]))).rejects.toThrow(
      "ER-1/main: Betrag -49,99 € → -50,00 €; nichts überschrieben.",
    );
    expect(await umsaetze(konto.iban)).toHaveLength(1);
    const [stand] = await sql`select max(b.checkpoint)::text as c from import_batches b join import_sources s on s.id = b.source_id
      where s.external_account_id = ${konto.hash}`;
    expect(stand!.c).toBe("2026-10-10");
  });

  it("verbindet einen vor der Bindung importierten Umsatz, statt ihn doppelt anzulegen", async () => {
    const konto = neuesKonto();
    const alt = [tx("ER-1", "2026-10-05")];
    const vorher = abruf(konto, alt).statement;
    await db.db.transaction((t) => bank.storeStatement(t, vorher, { filename: "alter Abruf", sha256: "alt" }, null));
    const r = await speichere(abruf(konto, [...alt, tx("ER-2", "2026-10-06", "1.00")]));
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(await umsaetze(konto.iban)).toHaveLength(2);
    // Danach zählt die Quellenidentität: derselbe Abruf noch einmal legt nichts an
    expect((await speichere(abruf(konto, [...alt, tx("ER-2", "2026-10-06", "1.00")]))).added).toBe(0);
  });

  it("gleicht nach der Bindung nicht mehr über den Inhalt ab", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    // Eine Datei nach der Bindung bringt einen Umsatz, den die Bank später mit eigener Kennung liefert
    const datei = abruf(konto, [tx(null, "2026-10-08", "7.00", { transaction_id: "T-1" })]).statement;
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "datei", sha256: "datei" }, null));
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-3", "2026-10-08", "7.00")]));
    expect(r.added).toBe(1);
    expect(await umsaetze(konto.iban)).toHaveLength(3);
  });

  it("erkennt Umsätze ohne entry_reference wie bisher am Inhalt", async () => {
    const konto = neuesKonto();
    const ohne = tx(null, "2026-10-05", "3.00", { transaction_id: "T-1" });
    await speichere(abruf(konto, [ohne]));
    const r = await speichere(abruf(konto, [{ ...ohne, transaction_id: "T-2" }]));
    expect(r).toMatchObject({ added: 0, skipped: 1, complete: true });
    expect(await umsaetze(konto.iban)).toHaveLength(1);
  });

  it("rückt bei einem vorgemerkten Umsatz nur bis zum Vortag vor", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-10-20", "1.00", { status: "PDNG" })]));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-19", complete: false });
  });

  it("behält den Stand der Quelle, auch wenn eine frühere Lieferung keinen hatte", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-P", "2026-10-01", "1.00", { status: "PDNG" })]));
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-P", "2026-10-01", "1.00")]));
    const r = await speichere(abruf(konto, [tx("ER-Q", "2026-10-26", "2.00", { status: "PDNG" })], { from: "2026-10-24", to: "2026-11-05" }));
    expect(r.checkpoint).toBe("2026-10-31");
  });

  it("speichert einen Abruf mit einem Umsatz nach dem Fenster und lässt diesen Umsatz für den Folgeabruf", async () => {
    const konto = neuesKonto();
    const r = await speichere(abruf(konto, [tx("ER-1", "2026-10-05"), tx("ER-2", "2026-11-02", "1.00")]));
    expect(r).toMatchObject({ added: 1, checkpoint: "2026-10-31", complete: true });
    expect((await speichere(abruf(konto, [tx("ER-2", "2026-11-02", "1.00")], { from: "2026-10-25", to: "2026-11-05" }))).added).toBe(1);
  });

  it("übernimmt einen gebuchten Umsatz, den die Bank erst mit einem Buchungstag vor dem Fenster liefert", async () => {
    const konto = neuesKonto();
    // Bank filtert nach Valuta: ER-2 (gebucht 20.10., Valuta 12.11.) fehlt im ersten Abruf bis 31.10.
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    const spaet = tx("ER-2", "2026-10-20", "300.00", { value_date: "2026-11-12" });
    await speichere(abruf(konto, [spaet], { from: "2026-10-24", to: "2026-11-15" }));
    await speichere(abruf(konto, [spaet], { from: "2026-11-08", to: "2026-11-20" }));
    expect((await umsaetze(konto.iban)).map((u) => u.bank_reference)).toEqual(["ER-1", "ER-2"]);
  });

  it("legt einen Umsatz vor dem Fenster nicht doppelt an, wenn eine Datei nach der Bindung seinen Tag schon abdeckt", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    // Kontoauszug als Datei bis 31.10., hier mit demselben Verwendungszweck wie in der API; danach beginnt der Abruf am 01.11. (followUpStart)
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // Die Bank filtert nach Valuta und liefert den Umsatz vom 30.10. im Fenster ab 01.11. noch einmal mit
    const r = await speichere(abruf(konto, [tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" })], { from: "2026-11-01", to: "2026-11-05" }));
    expect(r.added).toBe(0);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200]);
  });

  it("übernimmt einen Umsatz vor dem Fenster, den die Datei für seinen Tag nicht enthält", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // ER-3 hat die Bank am 30.10. nach dem Export der Datei gebucht, mit Valuta 01.11.
    const spaet = tx("ER-3", "2026-10-30", "77.00", { value_date: "2026-11-01", remittance_information: ["Miete November"] });
    const r = await speichere(abruf(konto, [spaet], { from: "2026-11-01", to: "2026-11-05" }));
    expect(r.added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -7700]);
  });

  it("rechnet jeden Umsatz der Datei vor dem Fenster nur einmal an", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
    // Zwei gleiche Beträge am 30.10., die Datei kennt einen davon
    const zwei = [tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" }), tx("ER-4", "2026-10-30", "12.00", { value_date: "2026-11-01" })];
    expect((await speichere(abruf(konto, zwei, { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -1200]);
  });

  /** Kontoauszug als Datei (camt) mit ER-2 vom 30.10. über 12,00 €, im Verwendungszweck wie in der API */
  async function dateiMitEr2(konto: { iban: string; hash: string }) {
    const datei = { ...abruf(konto, [tx("ER-2", "2026-10-30", "12.00")], { from: "2026-10-11" }).statement, format: "camt053" as const };
    await db.db.transaction((t) => bank.storeStatement(t, datei, { filename: "auszug.xml", sha256: `datei-${konto.hash}` }, null));
  }
  const er2 = tx("ER-2", "2026-10-30", "12.00", { value_date: "2026-11-01" });
  const er4 = tx("ER-4", "2026-10-30", "12.00", { value_date: "2026-11-01", remittance_information: ["Andere Zahlung"] });

  it("rechnet eine per Alias verbundene Zeile der Datei nicht noch einmal an", async () => {
    const konto = neuesKonto();
    await dateiMitEr2(konto);
    // Erster Abruf: ER-2 gehört per Alias zur Zeile der Datei, ER-4 ist ein anderer Umsatz mit gleichem Tag und Betrag
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-1200, -1200]);
  });

  it("rechnet eine Zeile der Datei, die schon einer Bewegung gehört, im nächsten Abruf nicht an", async () => {
    const konto = neuesKonto();
    await dateiMitEr2(konto);
    await speichere(abruf(konto, [er2], { from: "2026-11-01", to: "2026-11-05" }));
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-01", to: "2026-11-06" }))).added).toBe(1);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-1200, -1200]);
  });

  it("verbindet einen Umsatz vor dem Fenster dauerhaft mit der Zeile der Datei", async () => {
    const konto = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")], { to: "2026-10-10" }));
    await dateiMitEr2(konto);
    // Abruf 1: ER-2 steht schon aus der Datei und wird mit ihr verbunden
    expect((await speichere(abruf(konto, [er2], { from: "2026-11-01", to: "2026-11-05" }))).added).toBe(0);
    // Abruf 2: ein anderer Umsatz mit gleichem Tag und Betrag ist neu, die Zeile der Datei ist verbraucht
    expect((await speichere(abruf(konto, [er4], { from: "2026-11-02", to: "2026-11-06" }))).added).toBe(1);
    // Derselbe Abruf noch einmal legt nichts an
    expect((await speichere(abruf(konto, [er2, er4], { from: "2026-11-02", to: "2026-11-06" }))).added).toBe(0);
    expect((await umsaetze(konto.iban)).map((u) => u.amount)).toEqual([-4999, -1200, -1200]);
    const [verbunden] = await sql`select count(*)::int as n from import_movements m join import_sources s on s.id = m.source_id
      where s.external_account_id = ${konto.hash} and m.source_event_id = 'ER-2'`;
    expect(verbunden!.n).toBe(1);
  });

  it("lehnt eine Kennung ab, die schon mit einem anderen Konto verbunden ist", async () => {
    const konto = neuesKonto();
    const anderes = neuesKonto();
    await speichere(abruf(konto, [tx("ER-1", "2026-10-05")]));
    await expect(speichere(abruf({ iban: anderes.iban, hash: konto.hash }, [tx("ER-9", "2026-10-05")]))).rejects.toThrow(
      "schon mit einem anderen Konto verbunden",
    );
  });
});
