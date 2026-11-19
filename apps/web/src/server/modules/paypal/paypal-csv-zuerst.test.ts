import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PayPalClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Der Aktivitätenexport (CSV) kam vor dem Abruf (#1512, #306): Der Abruf verbindet die Umsätze aus der Datei mit der
 * Kennung der Transaktion, statt sie ein zweites Mal anzulegen, wenn die Art (Spalte „Type“) dieselbe ist. Eigene Testdatei,
 * weil sie eine leere Datenbank braucht; Aufbau und Daten wie paypal.test.ts.
 *
 * Die PayPal-API ist nachgebaut: Der echte `PayPalClient` läuft gegen eine `fetch`-Attrappe, die Anmeldung, Saldo und
 * Transaktionen (nach Zeitraum und Seite geschnitten) aus packages/import/test-fixtures/paypal liefert. Kennungen, Namen und
 * Beträge sind erfunden; es sind keine echten Antworten von PayPal.
 */

type Money = { currency_code: string; value: string };
type Row = {
  transaction_info: {
    transaction_id: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_amount: Money;
    fee_amount?: Money;
    transaction_status: string;
    transaction_subject?: string;
    invoice_id?: string;
  };
  payer_info?: { payer_name?: { full_name?: string } };
};
const fixture = JSON.parse(readFileSync(new URL("../../../../../../packages/import/test-fixtures/paypal/transaktionen.json", import.meta.url), "utf8")) as {
  transaction_details: Row[];
};
const ID = "AaBbCcDdEeFf1234clientid";
const SECRET = "EsEcRetSecretWertGeheim5678";
const HEUTE = new Date("2026-11-07T10:00:00Z");

const rows: Row[] = fixture.transaction_details;

const iso = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
const fetchAttrappe = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "token", expires_in: 3600 });
  if (url.pathname === "/v1/reporting/balances") return Response.json({ account_id: "BEISPIELHAENDLER1" });
  const from = Date.parse(url.searchParams.get("start_date")!);
  const to = Date.parse(url.searchParams.get("end_date")!);
  const size = Number(url.searchParams.get("page_size"));
  const page = Number(url.searchParams.get("page"));
  const inWindow = rows.filter((r) => iso(r.transaction_info.transaction_initiation_date) >= from && iso(r.transaction_info.transaction_initiation_date) <= to);
  return Response.json({
    transaction_details: inWindow.slice((page - 1) * size, page * size),
    page,
    total_pages: Math.max(1, Math.ceil(inWindow.length / size)),
  });
}) as typeof fetch;

const factory = (options: ConstructorParameters<typeof PayPalClient>[0]) =>
  new PayPalClient({ ...options, fetch: fetchAttrappe, now: () => HEUTE.getTime(), sleep: async () => {} });

/** Der Aktivitätenexport (englisch) zu denselben Zeilen, mit der Art als Beschreibung des T-Codes */
function csv(): Uint8Array {
  const art: Record<string, string> = {
    T0006: "Express Checkout payment",
    T1107: "Payment refund",
    T0400: "General withdrawal - bank account",
    T1106: "Payment reversal",
    T0001: "T0001",
  };
  const euro = (v: string) => Number(v).toFixed(2);
  const lines = fixture.transaction_details
    .filter((r) => {
      const i = r.transaction_info;
      return i.transaction_status !== "P" && i.transaction_status !== "D" && i.transaction_amount.currency_code === "EUR";
    })
    .map((r) => {
      const i = r.transaction_info;
      const when = new Date(iso(i.transaction_initiation_date));
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(when);
      const fee = i.fee_amount?.value ?? "0";
      const net = (Number(i.transaction_amount.value) + Number(fee)).toFixed(2);
      return [
        day,
        "10:00:00",
        "CEST",
        r.payer_info?.payer_name?.full_name ?? "",
        art[i.transaction_event_code],
        "Completed",
        "EUR",
        euro(i.transaction_amount.value),
        euro(fee),
        net,
        i.transaction_id,
        i.invoice_id ?? "",
        i.transaction_subject ?? "",
      ]
        .map((x) => `"${x}"`)
        .join(",");
    });
  return new TextEncoder().encode(
    ['"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","Transaction ID","Invoice Number","Subject"', ...lines].join("\n"),
  );
}

describe.skipIf(!testDatabaseUrl)("PayPal-Abruf nach dem CSV-Export (Postgres)", () => {
  let paypal: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    paypal = await import("./index.ts");
    bank = await import("../bank/index.ts");
    paypal.setPayPalClientFactory(factory);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("verbindet einen früheren CSV-Import mit der Kennung, statt die Umsätze neu anzulegen", async () => {
    await paypal.savePayPalConnection(actor, { clientId: ID, clientSecret: SECRET, fetchFrom: "2026-10-01" });
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('PayPal', 'zahlungsdienstleister', 'paypal', 3)`;
    const konto = (await sql`select id from bank_accounts where provider = 'paypal'`)[0]!.id as string;
    const csvImport = await bank.importStatement(actor, { bytes: csv(), filename: "aktivitaeten.csv" }, konto);
    expect(csvImport.added).toBe(12);
    const result = await paypal.syncPayPal(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.added).toBe(0);
    expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(12);
    // Die Kennungen sind nun mit den Umsätzen aus der Datei verbunden: ein weiterer Abruf erkennt sie daran
    expect((await sql`select count(*)::int as n from import_movements`)[0]!.n).toBe(11);
  });
});
