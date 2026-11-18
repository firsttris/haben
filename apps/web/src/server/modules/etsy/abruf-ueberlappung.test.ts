import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EtsyLedgerEntry } from "@haben/import";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Überlappende Abrufe des Etsy-Zahlungsverlaufs gegen Postgres: Jeder Abruf liest ein Fenster, das mit dem vorigen
 * überlappt. Was ein früherer Abruf schon übernommen hat, darf weder fehlen noch ein zweites Mal ins Konto kommen,
 * auch wenn der neue Abruf Steuer und Gebühren anders zusammenfasst als der frühere (Review zu #1053).
 */

const BESTELLUNG = "1000000077";
const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const verkauf: EtsyLedgerEntry = {
  entry_id: 100,
  amount: 2495,
  currency: "EUR",
  ledger_type: "PAYMENT_GROSS",
  reference_type: "shop_payment",
  reference_id: "5000000077",
  created_timestamp: ts("2023-06-13T10:00:00Z"),
};
const steuer: EtsyLedgerEntry = {
  entry_id: 101,
  amount: -145,
  currency: "EUR",
  ledger_type: "sales_tax",
  reference_type: "receipt",
  reference_id: BESTELLUNG,
  created_timestamp: ts("2023-06-13T10:20:00Z"),
};

describe.skipIf(!testDatabaseUrl)("Etsy-Abruf mit überlappenden Fenstern (Postgres)", () => {
  let etsy: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const abruf = (now: string) => ({ shopId: "35160089", fetchFrom: "2023-06-01", now: new Date(now) });
  const zahlungen: Record<string, string> = { "5000000077": BESTELLUNG, "6000000001": BESTELLUNG, "6000000002": BESTELLUNG };
  const optionen = { orderFor: (r: string) => zahlungen[r], sammelzeilen: true, gebuehrenBis: "2023-05-31", reference: "x" };
  const summe = async () => (await sql`select coalesce(sum(amount), 0)::int as s from bank_transactions`)[0]!.s as number;

  beforeAll(async () => {
    sql = await setupTestDb();
    etsy = await import("./index.ts");
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('Etsy Payments', 'zahlungsdienstleister', 'etsy', 3)`;
  }, 60_000);

  beforeEach(async () => {
    await leeren(sql)`truncate bank_transactions, import_movements, import_batches, import_sources, bank_imports cascade`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  describe("Sales Tax", () => {
    it("verliert die Steuer nicht, wenn sie erst mit dem nächsten Abruf kommt", async () => {
      // Erster Abruf um 10:10: nur der Verkauf
      await etsy.importEtsyLedger(actor, [verkauf], { ...optionen, reference: "1" }, abruf("2023-06-13T10:10:00Z"));
      // Zweiter Abruf um 11:00, überlappend: Verkauf und die inzwischen gebuchte Steuerzeile
      await etsy.importEtsyLedger(actor, [verkauf, steuer], { ...optionen, reference: "2" }, abruf("2023-06-13T11:00:00Z"));

      // Stand im Etsy-Verlauf: 24,95 € − 1,45 € = 23,50 €
      expect(await summe()).toBe(2495 - 145);
    });

    it("zählt die Steuer nicht doppelt, wenn der Bestellbezug beim Folgeabruf fehlt", async () => {
      // Erster Abruf: Verkauf und Steuer, verrechnet zu 23,50 €
      await etsy.importEtsyLedger(actor, [verkauf, steuer], { ...optionen, reference: "3" }, abruf("2023-06-13T11:00:00Z"));
      // Überlappender Folgeabruf, Etsy nennt die Bestellung zur Zahlung diesmal nicht (Payments-Abruf ohne Treffer)
      await etsy.importEtsyLedger(actor, [verkauf, steuer], { ...optionen, orderFor: () => undefined, reference: "4" }, abruf("2023-06-14T11:00:00Z"));

      expect(await summe()).toBe(2495 - 145);
    });

    it("zählt die Steuer zweier Teilerstattungen am selben Tag über zwei Abrufe genau einmal", async () => {
      const erstattung1: EtsyLedgerEntry = {
        entry_id: 110,
        amount: -1000,
        currency: "EUR",
        ledger_type: "REFUND_GROSS",
        reference_type: "shop_payment_refund",
        reference_id: "6000000001",
        created_timestamp: ts("2023-06-20T12:00:00Z"),
      };
      const steuer1: EtsyLedgerEntry = { ...steuer, entry_id: 111, amount: 60, ledger_type: "sales_tax_refund", created_timestamp: ts("2023-06-20T12:00:00Z") };
      const erstattung2: EtsyLedgerEntry = {
        ...erstattung1,
        entry_id: 112,
        amount: -500,
        reference_id: "6000000002",
        created_timestamp: ts("2023-06-20T15:00:00Z"),
      };
      const steuer2: EtsyLedgerEntry = { ...steuer1, entry_id: 113, amount: 30, created_timestamp: ts("2023-06-20T15:00:00Z") };

      await etsy.importEtsyLedger(actor, [verkauf, steuer, erstattung1, steuer1], { ...optionen, reference: "5" }, abruf("2023-06-20T13:00:00Z"));
      await etsy.importEtsyLedger(
        actor,
        [verkauf, steuer, erstattung1, steuer1, erstattung2, steuer2],
        { ...optionen, reference: "6" },
        abruf("2023-06-20T18:00:00Z"),
      );

      expect(await summe()).toBe(2495 - 145 - 1000 + 60 - 500 + 30);
      // Die zweite Erstattung kommt wie die erste mit dem Betrag nach Abzug ihrer Steuer
      const [zweite] = await sql`select amount from bank_transactions where bank_reference = 'etsy-112'`;
      expect(zweite?.amount).toBe(-470);
    });

    it("verrechnet die später gekommene Steuer einer schon übernommenen Erstattung nicht mit einer anderen", async () => {
      const erstattung1: EtsyLedgerEntry = {
        entry_id: 120,
        amount: -1000,
        currency: "EUR",
        ledger_type: "REFUND_GROSS",
        reference_type: "shop_payment_refund",
        reference_id: "6000000001",
        created_timestamp: ts("2023-06-20T12:00:00Z"),
      };
      // Die Steuer der ersten Erstattung bucht Etsy erst 20 Minuten später
      const steuer1: EtsyLedgerEntry = { ...steuer, entry_id: 121, amount: 60, ledger_type: "sales_tax_refund", created_timestamp: ts("2023-06-20T12:20:00Z") };
      const erstattung2: EtsyLedgerEntry = {
        ...erstattung1,
        entry_id: 122,
        amount: -500,
        reference_id: "6000000002",
        created_timestamp: ts("2023-06-20T15:00:00Z"),
      };
      const steuer2: EtsyLedgerEntry = { ...steuer1, entry_id: 123, amount: 30, created_timestamp: ts("2023-06-20T15:00:00Z") };

      await etsy.importEtsyLedger(actor, [erstattung1], { ...optionen, reference: "11" }, abruf("2023-06-20T12:10:00Z"));
      await etsy.importEtsyLedger(actor, [erstattung1, steuer1, erstattung2, steuer2], { ...optionen, reference: "12" }, abruf("2023-06-20T18:00:00Z"));

      expect(await summe()).toBe(-1000 + 60 - 500 + 30);
      // Zwei Erstattungen derselben Bestellung am selben Tag: Welche Steuer zu welcher gehört, rät Haben nicht
      const [zweite] = await sql`select amount from bank_transactions where bank_reference = 'etsy-122'`;
      expect(zweite?.amount).toBe(-500);
    });
  });

  describe("Wechsel der Einstellung „Gebühren bündeln“", () => {
    const gebuehren: EtsyLedgerEntry[] = [
      {
        entry_id: 200,
        amount: -19,
        currency: "EUR",
        ledger_type: "listing",
        reference_type: "listing",
        reference_id: "1",
        created_timestamp: ts("2023-06-07T10:00:00Z"),
      },
      {
        entry_id: 201,
        amount: -143,
        currency: "EUR",
        ledger_type: "transaction",
        reference_type: "transaction",
        reference_id: "2",
        created_timestamp: ts("2023-06-08T10:00:00Z"),
      },
    ];
    const spaetere: EtsyLedgerEntry = {
      entry_id: 202,
      amount: -20,
      currency: "EUR",
      ledger_type: "listing",
      reference_type: "listing",
      reference_id: "3",
      created_timestamp: ts("2023-06-20T10:00:00Z"),
    };

    it("aus → an: Gebühren eines schon einzeln übernommenen Monats kommen nicht ein zweites Mal als Sammelzeile", async () => {
      await etsy.importEtsyLedger(
        actor,
        gebuehren,
        { ...optionen, sammelzeilen: false, gebuehrenBis: "2023-06-30", reference: "7" },
        abruf("2023-06-10T10:00:00Z"),
      );
      // Nach dem Umstellen holt der Abruf den Monat noch einmal, dazu eine neue Gebühr desselben Monats
      await etsy.importEtsyLedger(
        actor,
        [...gebuehren, spaetere],
        { ...optionen, sammelzeilen: true, gebuehrenBis: "2023-06-30", reference: "8" },
        abruf("2023-07-07T10:00:00Z"),
      );

      expect(await summe()).toBe(-19 - 143 - 20);
    });

    it("an → aus: Gebühren eines schon gebündelten Monats kommen nicht ein zweites Mal einzeln", async () => {
      await etsy.importEtsyLedger(
        actor,
        gebuehren,
        { ...optionen, sammelzeilen: true, gebuehrenBis: "2023-06-30", reference: "9" },
        abruf("2023-07-06T10:00:00Z"),
      );
      await etsy.importEtsyLedger(
        actor,
        gebuehren,
        { ...optionen, sammelzeilen: false, gebuehrenBis: "2023-06-30", reference: "10" },
        abruf("2023-07-07T10:00:00Z"),
      );

      expect(await summe()).toBe(-19 - 143);
    });
  });
});
