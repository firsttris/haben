import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findHeaderRow } from "../table.ts";
import { isPayPalHeader, parsePayPal } from "../psp.ts";
import { validateBatch } from "../importvertrag/index.ts";
import { withDedupHashes } from "../dedup.ts";
import { centsOf, PayPalClient, type PayPalTransaction } from "./client.ts";
import { paypalBatch } from "./batch.ts";
import { classify, localDay, type PayPalEntry, type PayPalWindow } from "./eintraege.ts";
import { paypalEventOf, paypalStatement } from "./statement.ts";

/*
 * Einordnung, Lieferung und Auszug der Transaction Search (#1512) an den nachgebauten Antworten in
 * test-fixtures/paypal (erfundene Werte im Aufbau der API-Referenz) und an einer echten, anonymisierten Antwort der
 * PayPal-Sandbox (sandbox-transaktionen.json, letzte Gruppe unten).
 */

const raw = readFileSync(new URL("../../test-fixtures/paypal/transaktionen.json", import.meta.url), "utf8");

/** Die Fixture so, wie der Client sie liefert */
async function load(): Promise<PayPalTransaction[]> {
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).includes("oauth2")
      ? Response.json({ access_token: "t", expires_in: 3600 })
      : new Response(raw, { headers: { "content-type": "application/json" } })) as typeof fetch;
  return new PayPalClient({
    clientId: "id-fuer-test",
    clientSecret: "secret-fuer-test",
    fetch: fetchFn,
    now: () => Date.parse("2026-11-07T10:00:00Z"),
  }).transactions("2026-10-01", "2026-10-31");
}

const window: PayPalWindow = { zone: "Europe/Berlin", dateFrom: "2026-10-01", dateTo: "2026-10-31" };
const tx = (over: Partial<PayPalTransaction>): PayPalTransaction => ({
  id: "1AB23456CD789012E",
  eventCode: "T0006",
  initiated: "2026-10-06T09:14:00+0000",
  status: "S",
  amount: 10_000,
  currency: "EUR",
  fee: -300,
  feeCurrency: "EUR",
  ...over,
});

describe("Tag in der Zeitzone des Kontos", () => {
  it("rechnet den Zeitstempel der API (beide Schreibweisen des Offsets) in den Tag der Zone", () => {
    expect(localDay("2026-10-20T22:30:00+0000", "Europe/Berlin")).toBe("2026-10-21");
    expect(localDay("2026-10-20T22:30:00+00:00", "Europe/Berlin")).toBe("2026-10-21");
    expect(localDay("2026-10-20T22:30:00Z", "UTC")).toBe("2026-10-20");
    // Winterzeit: 23:30 UTC ist 00:30 am nächsten Tag; im Sommer genügen 22:00 UTC
    expect(localDay("2026-12-31T23:30:00Z", "Europe/Berlin")).toBe("2027-01-01");
    expect(localDay("2026-10-20T21:59:00Z", "Europe/Berlin")).toBe("2026-10-20");
    expect(localDay("2026-10-20T22:00:00Z", "Europe/Berlin")).toBe("2026-10-21");
    // Mit Offset der Zone: derselbe Zeitpunkt, derselbe Tag
    expect(localDay("2026-10-21T00:30:00+02:00", "Europe/Berlin")).toBe("2026-10-21");
    expect(localDay("2026-10-20T15:30:00-07:00", "Europe/Berlin")).toBe("2026-10-21");
  });

  it("lehnt einen Zeitstempel ohne Offset ab, statt einen Tag zu raten", () => {
    expect(() => localDay("2026-10-20T22:30:00", "Europe/Berlin")).toThrow("Zeitstempel");
  });
});

describe("Einordnung der Zeilen", () => {
  it("übernimmt abgeschlossene und nachträglich zurückgebuchte Zeilen und meldet den Rest unter unsupported", async () => {
    const { entries, unsupported } = classify(await load(), window);
    expect(entries.map((e) => [e.tx.id, e.kind, e.bookingDate])).toEqual([
      ["0KJ01234KL567890M", "chargeback", "2026-10-27"],
      ["1LK90123JK456789L", "payment", "2026-10-21"],
      ["2ML89012HJ345678K", null, "2026-10-25"],
      ["5QP56789EF012345G", "payment", "2026-10-22"],
      ["7UT34567CD890123E", "payout", "2026-10-20"],
      ["8WV23456BC789012D", "refund", "2026-10-12"],
      ["9XY12345AB678901C", "payment", "2026-10-06"],
    ]);
    expect(unsupported).toEqual([
      { sourceEventId: "2ML89012HJ345678K", bookingDate: "2026-10-25", reason: "Ereignis nicht unterstützt: T0001." },
      { sourceEventId: "3NM78901GH234567J", bookingDate: "2026-10-24", reason: "Währung USD, Haben übernimmt nur Euro.", final: true },
      { sourceEventId: "4ON67890FG123456H", bookingDate: "2026-10-23", reason: "Status D (abgelehnt).", final: true },
      { sourceEventId: "6SR45678DE901234F", bookingDate: "2026-10-21", reason: "Status P (ausstehend); folgt, sobald PayPal ihn abschließt." },
    ]);
  });

  it("lässt Zeilen außerhalb des Fensters aus, das der Client mit Spielraum geholt hat", async () => {
    const { entries, unsupported } = classify(await load(), { ...window, dateFrom: "2026-10-21", dateTo: "2026-10-22" });
    expect(entries.map((e) => e.tx.id)).toEqual(["1LK90123JK456789L", "5QP56789EF012345G"]);
    expect(unsupported.map((u) => u.sourceEventId)).toEqual(["6SR45678DE901234F"]);
  });

  it("richtet sich nach der Zeitzone: dieselbe Zeile liegt in UTC am 20., in Berlin am 21.", async () => {
    const berlin = classify(await load(), window).entries.find((e) => e.tx.id === "1LK90123JK456789L");
    const utc = classify(await load(), { ...window, zone: "UTC" }).entries.find((e) => e.tx.id === "1LK90123JK456789L");
    expect([berlin?.bookingDate, utc?.bookingDate]).toEqual(["2026-10-21", "2026-10-20"]);
  });

  it("nimmt eine Zahlung mit positiver Gebühr nicht an, statt eine Gebühr mit falschem Vorzeichen zu buchen", () => {
    const { entries, unsupported } = classify([tx({ fee: 300 })], window);
    expect(entries).toEqual([]);
    expect(unsupported).toEqual([
      {
        sourceEventId: "1AB23456CD789012E",
        bookingDate: "2026-10-06",
        reason: "Gebühr mit unerwartetem Vorzeichen (+3.00) bei einer Zahlung, nicht übernommen.",
      },
    ]);
  });

  it("gibt bei einer Kennung mit zwei Ereigniscodes dem ersten die Kennung und dem zweiten <Kennung>/<Code>, damit kein Betrag fehlt", () => {
    const zwei = [tx({ eventCode: "T0006" }), tx({ eventCode: "T1109", amount: 0, fee: 25 })];
    const { entries } = classify(zwei, window);
    expect(entries.map((e) => [e.eventId, e.tx.eventCode])).toEqual([
      ["1AB23456CD789012E", "T0006"],
      ["1AB23456CD789012E/T1109", "T1109"],
    ]);
    // Die Reihenfolge der Lieferung ändert nichts
    expect(classify([...zwei].reverse(), window).entries.map((e) => e.eventId)).toEqual(["1AB23456CD789012E", "1AB23456CD789012E/T1109"]);
    const batch = paypalBatch({
      externalAccountId: "A1",
      classified: classify(zwei, window),
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      fetchedAt: "2026-11-01T06:00:00Z",
      fetchId: "x",
    });
    expect(batch.movements.map((m) => [m.sourceEventId, m.component, m.amount])).toEqual([
      ["1AB23456CD789012E", "main", 10_000],
      ["1AB23456CD789012E", "fee", -300],
      ["1AB23456CD789012E/T1109", "fee", 25],
    ]);
    expect(paypalStatement(entries).transactions.map((t2) => t2.bankReference)).toContain("1AB23456CD789012E/T1109-gebuehr");
  });

  it("meldet einen unbekannten Status, statt ihn zu buchen", () => {
    expect(classify([tx({ status: "X" })], window).unsupported[0]!.reason).toBe("Status X nicht bekannt.");
    expect(classify([tx({ status: "" })], window).unsupported[0]!.reason).toBe("Status ohne Angabe nicht bekannt.");
  });

  it("lehnt eine Gebühr in Fremdwährung ab, auch wenn der Betrag in Euro ist", () => {
    expect(classify([tx({ feeCurrency: "USD" })], window).unsupported[0]).toMatchObject({ reason: "Währung USD, Haben übernimmt nur Euro.", final: true });
  });
});

describe("Lieferung des Importvertrags", () => {
  const input = async () => ({
    externalAccountId: "BEISPIELHAENDLER1",
    classified: classify(await load(), window),
    dateFrom: "2026-10-01",
    dateTo: "2026-10-31",
    fetchedAt: "2026-11-01T06:00:00Z",
    fetchId: "abruf-1",
  });
  const accepted = async () => {
    const result = validateBatch(paypalBatch(await input()), { provider: "paypal", externalAccountId: "BEISPIELHAENDLER1", accountKind: "psp" });
    if (!result.ok) throw new Error(result.problems.join(" "));
    return result;
  };

  it("ist für den Vertrag gültig und hat Zahlung und Gebühr als zwei Komponenten", async () => {
    const { accepted: list } = await accepted();
    const zahlung = list.filter((m) => m.sourceEventId === "9XY12345AB678901C");
    expect(zahlung.map((m) => [m.component, m.kind, m.amount, m.bookingDate, m.counterpartyName])).toEqual([
      ["main", "payment", 10_000, "2026-10-06", "Erika Beispiel"],
      ["fee", "payment", -300, "2026-10-06", "PayPal"],
    ]);
    expect(zahlung[0]!.purpose).toBe("Express Checkout payment · RE-2026-117 · Bestellung 2026-117 · 9XY12345AB678901C");
    expect(zahlung[1]!.purpose).toBe("Gebühr · 9XY12345AB678901C");
    expect(zahlung[0]!.references).toEqual({ providerReference: "9XY12345AB678901C", eventCode: "T0006" });
  });

  it("gibt der Erstattung den Bezug auf die Zahlung und die zurückgegebene Gebühr als Gutschrift", async () => {
    const { accepted: list } = await accepted();
    const erstattung = list.filter((m) => m.sourceEventId === "8WV23456BC789012D");
    expect(erstattung.map((m) => [m.component, m.kind, m.amount])).toEqual([
      ["main", "refund", -2_000],
      ["fee", "refund", 60],
    ]);
    expect(erstattung[0]!.references).toMatchObject({ relatedEventId: "9XY12345AB678901C", eventCode: "T1107" });
  });

  it("lässt die zurückgebuchte Zahlung (V) gebucht und führt die Rückbuchung als eigenes Ereignis mit Bezug", async () => {
    const { accepted: list } = await accepted();
    expect(list.filter((m) => m.sourceEventId === "5QP56789EF012345G").map((m) => [m.component, m.kind, m.amount])).toEqual([
      ["main", "payment", 5_000],
      ["fee", "payment", -175],
    ]);
    const rueck = list.filter((m) => m.sourceEventId === "0KJ01234KL567890M");
    expect(rueck.map((m) => [m.component, m.kind, m.amount])).toEqual([
      ["main", "chargeback", -5_000],
      ["fee", "chargeback", 175],
    ]);
    expect(rueck[0]!.references.relatedEventId).toBe("5QP56789EF012345G");
    // Zusammen null: nichts bleibt hängen, nichts wird doppelt zurückgebucht
    const summe = list.filter((m) => ["5QP56789EF012345G", "0KJ01234KL567890M"].includes(m.sourceEventId)).reduce((s, m) => s + m.amount, 0);
    expect(summe).toBe(0);
  });

  it("nennt die Abbuchung auf das Bankkonto Auszahlung mit PayPal als Gegenseite", async () => {
    const { accepted: list } = await accepted();
    const abbuchung = list.filter((m) => m.sourceEventId === "7UT34567CD890123E");
    expect(abbuchung).toHaveLength(1);
    expect(abbuchung[0]).toMatchObject({ kind: "payout", amount: -7_700, counterpartyName: "PayPal", references: { eventCode: "T0400" } });
  });

  it("ordnet die Abbuchung per Hand (T0403) wie T0400 als Auszahlung ein, statt sie als nicht unterstützt zu melden", () => {
    const classified = classify([tx({ id: "7UT34567CD890124E", eventCode: "T0403", amount: -5_000, fee: 0, feeCurrency: null })], window);
    expect(classified.unsupported).toEqual([]);
    const batch = paypalBatch({
      externalAccountId: "A1",
      classified,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      fetchedAt: "2026-11-01T06:00:00Z",
      fetchId: "x",
    });
    expect(batch.movements).toHaveLength(1);
    expect(batch.movements[0]).toMatchObject({ kind: "payout", amount: -5_000, counterpartyName: "PayPal", references: { eventCode: "T0403" } });
    expect(batch.movements[0]!.purpose).toBe("Manual withdrawal · 7UT34567CD890124E");
  });

  it("liefert ausstehende, abgelehnte, fremde und nicht eingeordnete Zeilen nicht als Bewegung", async () => {
    const batch = paypalBatch(await input());
    const ids = new Set(batch.movements.map((m) => m.sourceEventId));
    for (const id of ["6SR45678DE901234F", "4ON67890FG123456H", "3NM78901GH234567J", "2ML89012HJ345678K"]) expect(ids.has(id)).toBe(false);
    expect(batch.unsupported).toHaveLength(4);
    expect(batch.balances).toEqual([]);
    expect(batch.provider).toBe("paypal");
  });

  it("lehnt die Lieferung für ein anderes Konto ab", async () => {
    const result = validateBatch(paypalBatch(await input()), { provider: "paypal", externalAccountId: "ANDERES", accountKind: "psp" });
    expect(result.ok).toBe(false);
  });

  it("macht aus einer Zeile ohne Betrag, aber mit Gebühr nur die Gebührenkomponente", () => {
    const batch = paypalBatch({
      externalAccountId: "A1",
      classified: classify([tx({ eventCode: "T1108", amount: 0, fee: 25 })], window),
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      fetchedAt: "2026-11-01T06:00:00Z",
      fetchId: "x",
    });
    expect(batch.movements.map((m) => [m.component, m.kind, m.amount])).toEqual([["fee", "fee", 25]]);
  });
});

describe("Auszug und Aktivitätenexport", () => {
  /**
   * Ein Export mit den Spalten des englischen Aktivitätenexports (Namen nach der Doku von PayPal), gebaut aus denselben
   * Zeilen. Das belegt, dass beide Wege durch denselben Parser laufen und ihre Zeilen gleich bilden; es ist keine echte
   * Exportdatei, und die Art (Spalte „Type“) hängt von der Sprache des Kontos ab.
   */
  const csvRows = (entries: PayPalEntry[], art: (e: PayPalEntry) => string): string[][] => [
    ["Date", "Time", "TimeZone", "Name", "Type", "Status", "Currency", "Gross", "Fee", "Net", "Transaction ID", "Invoice Number", "Subject"],
    ...entries.map((e) => {
      const euro = (c: number) => (c / 100).toFixed(2);
      return [
        e.bookingDate,
        "10:00:00",
        "CEST",
        e.tx.payerName ?? "",
        art(e),
        "Completed",
        "EUR",
        euro(e.tx.amount),
        euro(e.tx.fee),
        euro(e.tx.amount + e.tx.fee),
        e.tx.id,
        e.tx.invoiceId ?? "",
        e.tx.subject ?? e.tx.itemTitle ?? "",
      ];
    }),
  ];
  const key = (t: { bookingDate: string; amount: number; purpose: string; bankReference?: string }) => [
    t.bookingDate,
    t.amount,
    t.purpose.toLowerCase(),
    t.bankReference,
  ];

  it("liest den Abruf mit demselben Parser wie den Export: Tag, Betrag, Zweck und Referenz stimmen überein, wenn die Art dieselbe ist", async () => {
    const { entries } = classify(await load(), window);
    const api = paypalStatement(entries);
    const rows = csvRows(entries, (e) => e.typeText);
    const csv = parsePayPal(rows, findHeaderRow(rows, isPayPalHeader));
    expect(api.format).toBe("paypal-api");
    expect(api.transactions.map(key)).toEqual(csv.transactions.map(key));
    expect(withDedupHashes(api.transactions).map((t) => t.dedupHash)).toEqual(withDedupHashes(csv.transactions).map((t) => t.dedupHash));
  });

  it("ergibt als Summe aller Umsätze Betrag plus Gebühr der übernommenen Zeilen", async () => {
    const { entries } = classify(await load(), window);
    const summe = paypalStatement(entries).transactions.reduce((s, t) => s + t.amount, 0);
    expect(summe).toBe(entries.reduce((s, e) => s + e.tx.amount + e.tx.fee, 0));
  });

  it("Grenze: Die Art ist im Export die Beschreibung in der Sprache des Kontos; bei einem deutschen Export hat die Gebührenzeile denselben Hash, die Zahlung nicht", async () => {
    const { entries } = classify(await load(), window);
    const api = withDedupHashes(paypalStatement(entries).transactions);
    const rows = csvRows(entries, (e) => (e.tx.eventCode === "T0006" ? "Express-Checkout-Zahlung" : e.typeText));
    const csv = withDedupHashes(parsePayPal(rows, findHeaderRow(rows, isPayPalHeader)).transactions);
    const hash = (list: typeof api, ref: string) => list.find((t) => t.bankReference === ref)!.dedupHash;
    expect(hash(api, "9XY12345AB678901C-gebuehr")).toBe(hash(csv, "9XY12345AB678901C-gebuehr"));
    expect(hash(api, "9XY12345AB678901C")).not.toBe(hash(csv, "9XY12345AB678901C"));
  });

  it("ordnet Umsätze ihren Bewegungen zu: Zahlung unter der Kennung, Gebühr mit #fee", async () => {
    const classified = classify(await load(), window);
    const statement = paypalStatement(classified.entries);
    const batch = paypalBatch({
      externalAccountId: "A",
      classified,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      fetchedAt: "2026-11-01T06:00:00Z",
      fetchId: "x",
    });
    const keys = new Set(batch.movements.map((m) => (m.component === "main" ? m.sourceEventId : `${m.sourceEventId}#${m.component}`)));
    const eventOf = paypalEventOf(keys);
    const zugeordnet = statement.transactions.map((t) => eventOf(t));
    expect(zugeordnet).toContain("9XY12345AB678901C#fee");
    expect(zugeordnet).toContain("9XY12345AB678901C");
    // Die Massenzahlung ohne Bewegung bleibt ein Umsatz ohne Kennung
    const massen = statement.transactions.findIndex((t) => t.bankReference === "2ML89012HJ345678K");
    expect(zugeordnet[massen]).toBeUndefined();
  });
});

describe("Echte Antwort der PayPal-Sandbox (anonymisiert)", () => {
  const sandbox = readFileSync(new URL("../../test-fixtures/paypal/sandbox-transaktionen.json", import.meta.url), "utf8");
  type Echt = {
    transaction_details: {
      transaction_info: {
        transaction_event_code: string;
        transaction_amount: { value: string };
        fee_amount: { value: string };
        ending_balance: { value: string };
      };
    }[];
  };
  const echt = JSON.parse(sandbox) as Echt;

  const laden = async () => {
    const fetchFn = (async (input: string | URL | Request) =>
      String(input).includes("oauth2")
        ? Response.json({ access_token: "t", expires_in: 3600 })
        : new Response(sandbox, { headers: { "content-type": "application/json" } })) as typeof fetch;
    return new PayPalClient({
      clientId: "id-fuer-test",
      clientSecret: "secret-fuer-test",
      fetch: fetchFn,
      now: () => Date.parse("2026-11-20T10:00:00Z"),
    }).transactions("2026-11-19", "2026-11-19");
  };

  it("liest Zahlung und Erstattung: Gebühr bei der Zahlung negativ, bei der Erstattung positiv, Name aus alternate_full_name", async () => {
    const list = await laden();
    expect(list.map((t) => [t.eventCode, t.status, t.amount, t.fee, t.currency, t.payerName])).toEqual([
      ["T0000", "S", 10_000, -225, "EUR", "Erika Beispiel"],
      ["T1107", "S", -2_000, 38, "EUR", "Erika Beispiel"],
    ]);
  });

  it("stimmt mit dem Saldo der Antwort überein: Betrag plus Gebühr jeder Zeile ergibt den ending_balance", () => {
    const cents = (v: string) => centsOf(v, "sandbox");
    let saldo = 0;
    for (const z of echt.transaction_details) {
      saldo += cents(z.transaction_info.transaction_amount.value) + cents(z.transaction_info.fee_amount.value);
      expect(saldo).toBe(cents(z.transaction_info.ending_balance.value));
    }
  });

  it("ordnet die Zeilen ein und liefert Zahlung und Erstattung mit Gebühr und Bezug; der Tag ist der in Berlin", async () => {
    const classified = classify(await laden(), { zone: "Europe/Berlin", dateFrom: "2026-11-19", dateTo: "2026-11-20" });
    expect(classified.unsupported).toEqual([]);
    expect(classified.entries.map((e) => [e.kind, e.typeText, e.bookingDate])).toEqual([
      ["payment", "General payment", "2026-11-19"],
      ["refund", "Payment refund", "2026-11-19"],
    ]);
    const batch = paypalBatch({
      externalAccountId: "ACC05XXXXXXXX",
      classified,
      dateFrom: "2026-11-19",
      dateTo: "2026-11-20",
      fetchedAt: "2026-11-20T10:00:00Z",
      fetchId: "sandbox",
    });
    const gueltig = validateBatch(batch, { provider: "paypal", externalAccountId: "ACC05XXXXXXXX", accountKind: "psp" });
    expect(gueltig.ok).toBe(true);
    expect(batch.movements.map((m) => [m.component, m.kind, m.amount, m.references.relatedEventId ?? null])).toEqual([
      ["main", "payment", 10_000, null],
      ["fee", "payment", -225, null],
      ["main", "refund", -2_000, "SBX02XXXXXXXXXXXX"],
      ["fee", "refund", 38, "SBX02XXXXXXXXXXXX"],
    ]);
    // Zusammen das, was das Konto bewegt hat: 97,75 € − 19,62 €
    expect(batch.movements.reduce((s, m) => s + m.amount, 0)).toBe(7_813);
  });
});
