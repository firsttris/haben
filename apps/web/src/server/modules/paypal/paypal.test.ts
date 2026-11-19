import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PayPalClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abruf der Transaction Search von PayPal gegen Postgres: Zugang speichern, Umsätze abrufen, ins Konto des
 * Zahlungsdienstleisters übernehmen, beim zweiten Lauf nichts doppelt anlegen und mit dem CSV-Export zusammenspielen
 * (#1512, #306).
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

let jetzt = HEUTE;
let rows: Row[] = fixture.transaction_details;
let transaktionsAufrufe = 0;
let status403 = false;

const iso = (s: string) => Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
const fetchAttrappe = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "token", expires_in: 3600 });
  if (url.pathname === "/v1/reporting/balances") return Response.json({ account_id: "BEISPIELHAENDLER1" });
  transaktionsAufrufe++;
  if (status403) return Response.json({ name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." }, { status: 403 });
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
  new PayPalClient({ ...options, fetch: fetchAttrappe, now: () => jetzt.getTime(), sleep: async () => {} });

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

describe.skipIf(!testDatabaseUrl)("PayPal-Abruf (Postgres)", () => {
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

  const speichern = (extra: Record<string, unknown> = {}) =>
    paypal.savePayPalConnection(actor, { clientId: ID, clientSecret: SECRET, fetchFrom: "2026-10-01", ...extra });

  it("speichert Client-ID und Secret verschlüsselt und nennt in der Zusammenfassung nur Kontokennung und die letzten Zeichen", async () => {
    await speichern();
    const stand = await paypal.paypalSummary();
    expect(stand).toMatchObject({
      configured: true,
      accountId: "BEISPIELHAENDLER1",
      keyHint: ID.slice(-4),
      sandbox: false,
      zeitzone: "Europe/Berlin",
      fetchFrom: "2026-10-01",
      rhythmus: "taeglich",
    });
    expect(JSON.stringify(stand)).not.toContain(SECRET);
    expect(JSON.stringify(stand)).not.toContain(ID);
    const [row] = await sql`select ciphertext::text as c from paypal_connections`;
    expect(row!.c).not.toContain(SECRET);
    expect(row!.c).not.toContain(Buffer.from(SECRET).toString("hex"));
    // Das Protokoll enthält die Änderung, aber nicht den Inhalt von ciphertext
    const audit = await sql`select new_value::text as v from audit_log where table_name = 'paypal_connections'`;
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((a) => a.v.includes("ciphertext") || a.v.includes(SECRET))).toBe(false);
  });

  it("lehnt unvollständige oder unbrauchbare Eingaben ab und behält sonst die gespeicherten Zugangsdaten", async () => {
    await expect(paypal.savePayPalConnection(actor, { clientId: ID, fetchFrom: "2026-10-01" })).rejects.toThrow("gehören zusammen");
    await expect(speichern({ fetchFrom: "2999-01-01" })).rejects.toThrow("Zukunft");
    await expect(speichern({ fetchFrom: "2019-01-01" })).rejects.toThrow("drei Jahre");
    await expect(speichern({ zeitzone: "Mars/Olympus" })).rejects.toThrow("keine Zeitzone");
    await expect(speichern({ rhythmus: "minuetlich" })).rejects.toThrow();
    // Ohne neue Zugangsdaten bleiben die gespeicherten; die Umgebung zu wechseln geht so nicht
    await expect(paypal.savePayPalConnection(actor, { fetchFrom: "2026-10-01", sandbox: true })).rejects.toThrow("Sandbox");
    await paypal.savePayPalConnection(actor, { fetchFrom: "2026-10-01", rhythmus: "woechentlich" });
    expect((await paypal.paypalSummary()).rhythmus).toBe("woechentlich");
    await paypal.savePayPalConnection(actor, { fetchFrom: "2026-10-01", rhythmus: "taeglich" });
  });

  it("legt ohne Konto des Dienstleisters nichts an und lässt den Startpunkt stehen", async () => {
    const result = await paypal.syncPayPal(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.accountName).toBeNull();
    expect(result.messages.join(" ")).toContain("noch kein Konto");
    expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(0);
    expect((await sql`select fetch_from::text as f from paypal_connections`)[0]!.f).toBe("2026-10-01");
  });

  it("übernimmt die Umsätze ins Konto des Dienstleisters und meldet, was nicht ankommt", async () => {
    await sql`insert into bank_accounts (name, purpose, provider, ledger_index) values ('PayPal', 'zahlungsdienstleister', 'paypal', 3)`;
    const result = await paypal.syncPayPal(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.accountName).toBe("PayPal");
    // 4 Zahlungen/Rückbuchung/Erstattung mit Gebühr (je zwei), Abbuchung, Massenzahlung ohne Gebühr
    expect(result.added).toBe(12);
    const umsaetze = await sql`select bank_reference, amount, booking_date::text as d from bank_transactions`;
    const von = (ref: string) => umsaetze.find((u) => u.bank_reference === ref)!;
    expect(Number(von("9XY12345AB678901C")!.amount)).toBe(10_000);
    expect(Number(von("9XY12345AB678901C-gebuehr")!.amount)).toBe(-300);
    // Erstattung mit zurückgegebener Gebühr, Abbuchung als Geldtransit-Kandidat, Zahlung nach Mitternacht Berliner Zeit am Folgetag
    expect(Number(von("8WV23456BC789012D-gebuehr")!.amount)).toBe(60);
    expect(Number(von("7UT34567CD890123E")!.amount)).toBe(-7_700);
    expect(von("1LK90123JK456789L")!.d).toBe("2026-10-21");
    // V: Zahlung bleibt gebucht, die Rückbuchung hebt sie auf
    const v = umsaetze.filter((u) =>
      ["5QP56789EF012345G", "5QP56789EF012345G-gebuehr", "0KJ01234KL567890M", "0KJ01234KL567890M-gebuehr"].includes(u.bank_reference),
    );
    expect(v.reduce((s, u) => s + Number(u.amount), 0)).toBe(0);
    // Ausstehend, abgelehnt und Fremdwährung sind keine Umsätze, aber sichtbar
    expect(umsaetze.some((u) => ["6SR45678DE901234F", "4ON67890FG123456H", "3NM78901GH234567J"].includes(u.bank_reference))).toBe(false);
    const meldungen = result.messages.join("\n");
    expect(meldungen).toContain("Status P (ausstehend)");
    expect(meldungen).toContain("Status D (abgelehnt)");
    expect(meldungen).toContain("Währung USD");
    expect(meldungen).toContain("Ereignis nicht unterstützt: T0001");
    expect(meldungen).toContain("nicht als vollständig abgerufen");
  });

  it("speichert über den Importvertrag: Quelle mit der Kennung des Händlerkontos, Zahlung und Gebühr als zwei Bewegungen, Bezug der Erstattung", async () => {
    const quellen = await sql`select provider, external_account_id, account_kind from import_sources`;
    expect(quellen.map((q) => [q.provider, q.external_account_id, q.account_kind])).toEqual([["paypal", "BEISPIELHAENDLER1", "psp"]]);
    const bewegungen = await sql`select component, amount from import_movements where source_event_id = '9XY12345AB678901C' order by component`;
    expect(bewegungen.map((b) => [b.component, Number(b.amount)])).toEqual([
      ["fee", -300],
      ["main", 10_000],
    ]);
    // Zwölf Umsätze, aber elf Bewegungen: die Massenzahlung (T0001) wird nicht eingeordnet
    expect((await sql`select count(*)::int as n from import_movements`)[0]!.n).toBe(11);
    const [bezug] = await sql`select refs from import_movements where source_event_id = '8WV23456BC789012D' and component = 'main'`;
    expect(bezug!.refs).toMatchObject({ relatedEventId: "9XY12345AB678901C", eventCode: "T1107" });
  });

  it("legt beim zweiten, überlappenden Abruf nichts doppelt an; die ausstehende Zahlung hält den Start zurück", async () => {
    const result = await paypal.syncPayPal(actor, HEUTE);
    expect(result.error).toBeNull();
    expect(result.added).toBe(0);
    expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(12);
    // Drei Tage vor heute wäre der 04.11.; die ausstehende Zahlung vom 21.10. hält den Start auf dem 21.10.
    const [row] = await sql`select fetch_from::text as f, last_error from paypal_connections`;
    expect(row!.f).toBe("2026-10-21");
    expect(row!.last_error).toBeNull();
  });

  it("übernimmt die Zahlung, sobald PayPal sie abschließt, und lässt danach den Start vorrücken", async () => {
    rows = fixture.transaction_details.map((r) =>
      r.transaction_info.transaction_id === "6SR45678DE901234F" ? { ...r, transaction_info: { ...r.transaction_info, transaction_status: "S" } } : r,
    );
    try {
      jetzt = new Date("2026-11-08T10:00:00Z");
      const result = await paypal.syncPayPal(actor, jetzt);
      expect(result.error).toBeNull();
      // Zahlung mit Betrag 20,00 und Gebühr 0: ein Umsatz
      expect(result.added).toBe(1);
      expect((await sql`select fetch_from::text as f from paypal_connections`)[0]!.f).toBe("2026-11-05");
    } finally {
      rows = fixture.transaction_details;
    }
  });

  it("erzeugt mit einem späteren CSV-Import desselben Zeitraums keine Dubletten, wenn die Art im Export dieselbe ist", async () => {
    const konto = (await sql`select id from bank_accounts where provider = 'paypal'`)[0]!.id as string;
    const before = (await sql`select count(*)::int as n from bank_transactions`)[0]!.n;
    const result = await bank.importStatement(actor, { bytes: csv(), filename: "aktivitaeten.csv" }, konto);
    expect(result.added).toBe(0);
    expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(before);
  });

  it("nimmt einen Abruf mit anderem Betrag zu einer schon übernommenen Bewegung nicht an und zeigt den Konflikt", async () => {
    rows = fixture.transaction_details.map((r) =>
      r.transaction_info.transaction_id === "9XY12345AB678901C"
        ? { ...r, transaction_info: { ...r.transaction_info, transaction_amount: { currency_code: "EUR", value: "101.00" } } }
        : r,
    );
    try {
      // Der Start ist vorgerückt; ein früherer Starttag holt die Zahlung vom 06.10. wieder
      await speichern({ fetchFrom: "2026-10-02" });
      jetzt = new Date("2026-11-09T10:00:00Z");
      const result = await paypal.syncPayPal(actor, jetzt);
      expect(result.error).toContain("Konflikt");
      expect(result.added).toBe(0);
      const stand = await paypal.paypalSummary();
      expect(stand.konflikte).toHaveLength(1);
      expect(stand.lastError).toContain("Konflikt");
    } finally {
      rows = fixture.transaction_details;
    }
  });

  it("hält einen Konflikt bei der Gebühr mit der Referenz der Gebühr fest, nicht der des Hauptbetrags", async () => {
    rows = fixture.transaction_details.map((r) =>
      r.transaction_info.transaction_id === "9XY12345AB678901C"
        ? { ...r, transaction_info: { ...r.transaction_info, fee_amount: { currency_code: "EUR", value: "-4.00" } } }
        : r,
    );
    try {
      await speichern({ fetchFrom: "2026-10-03" });
      jetzt = new Date("2026-11-10T10:00:00Z");
      const result = await paypal.syncPayPal(actor, jetzt);
      expect(result.error).toContain("Konflikt");
      const konflikte =
        await sql`select transaction->>'bankReference' as ref, amount from import_conflicts where transaction->>'bankReference' like '%-gebuehr'`;
      expect(konflikte.map((k) => [k.ref, Number(k.amount)])).toEqual([["9XY12345AB678901C-gebuehr", -400]]);
    } finally {
      rows = fixture.transaction_details;
    }
  });

  it("teilt einen langen Zeitraum in Fenster von höchstens 31 Tagen und holt ihn vollständig", async () => {
    await speichern({ fetchFrom: "2026-02-01" });
    transaktionsAufrufe = 0;
    jetzt = new Date("2026-11-11T10:00:00Z");
    await paypal.syncPayPal(actor, jetzt);
    // Vom 31.01. bis 13.11.: mindestens acht Fenster zu je 30 Tagen
    expect(transaktionsAufrufe).toBeGreaterThanOrEqual(8);
  });

  it("meldet ein fehlendes Recht (403) am Zugang, ohne Zugangsdaten, und lässt die Umsätze unberührt", async () => {
    status403 = true;
    try {
      const vorher = (await sql`select count(*)::int as n from bank_transactions`)[0]!.n;
      const result = await paypal.syncPayPal(actor, new Date("2026-11-12T10:00:00Z"));
      expect(result.error).toContain("Transaction Search");
      expect(result.error).not.toContain(SECRET);
      const stand = await paypal.paypalSummary();
      expect(stand.lastError).toContain("Zugriff abgelehnt");
      expect(JSON.stringify(stand)).not.toContain(SECRET);
      expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(vorher);
    } finally {
      status403 = false;
    }
  });

  it("ruft im Zeitplan nur ab, wenn der Rhythmus es verlangt, und gibt die Meldungen weiter", async () => {
    jetzt = new Date("2026-12-01T10:00:00Z");
    const erster = await paypal.runDuePayPalSyncs(jetzt);
    expect(erster.synced).toBe(1);
    expect(Array.isArray(erster.messages)).toBe(true);
    expect((await paypal.runDuePayPalSyncs(jetzt)).synced).toBe(0);
  });

  it("meldet abgelehnte Zugangsdaten beim Speichern, ohne sie zu nennen, und behält die alten", async () => {
    paypal.setPayPalClientFactory(
      () =>
        ({
          accountId: async () => {
            throw new Error("Anmeldung abgelehnt (Client-ID oder Secret falsch)");
          },
        }) as unknown as PayPalClient,
    );
    try {
      const error = await paypal
        .savePayPalConnection(actor, { clientId: "zzzzzzzzzzzz", clientSecret: "yyyyyyyyyyyy", fetchFrom: "2026-10-01" })
        .catch((e) => e);
      expect(error.message).toContain("Anmeldung abgelehnt");
      expect(error.message).not.toContain("yyyyyyyyyyyy");
    } finally {
      paypal.setPayPalClientFactory(factory);
    }
    expect((await paypal.paypalSummary()).keyHint).toBe(ID.slice(-4));
  });

  it("beginnt bei Zugangsdaten eines anderen Kontos wieder am gewählten Tag", async () => {
    paypal.setPayPalClientFactory(() => ({ accountId: async () => "ANDERESKONTO1" }) as unknown as PayPalClient);
    try {
      await paypal.savePayPalConnection(actor, { clientId: "qrstuvwxyz12", clientSecret: "abcdefghijkl", sandbox: true, fetchFrom: "2026-10-01" });
    } finally {
      paypal.setPayPalClientFactory(factory);
    }
    expect(await paypal.paypalSummary()).toMatchObject({ accountId: "ANDERESKONTO1", sandbox: true, naechsterAbrufAb: "2026-10-01" });
  });

  it("entfernt den Zugang, übernommene Umsätze bleiben stehen", async () => {
    const vorher = (await sql`select count(*)::int as n from bank_transactions`)[0]!.n;
    await paypal.deletePayPalConnection(actor);
    expect((await paypal.paypalSummary()).configured).toBe(false);
    expect((await sql`select count(*)::int as n from bank_transactions`)[0]!.n).toBe(vorher);
  });
});
