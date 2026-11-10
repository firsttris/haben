import { describe, expect, it } from "vitest";
import logs from "../../test-fixtures/sevdesk/buchhaltung-1.0/check-account-transaction-log.json" with { type: "json" };
import { SevdeskClient } from "./client.ts";
import { mapSevPaymentLogs } from "./map.ts";
import { sevCheckAccountTransactionLogSchema } from "./types.ts";

// Echte V1-Antworten (anonymisiert, #343): Rechnung 1.190 € mit drei Teilzahlungen über zwei Konten.
// Die letzte Zahlung (440 €) ist ein geteilter Umsatz: 190 € für diese Rechnung, 250 € für eine andere.
const parsed = logs.objects.map((l) => sevCheckAccountTransactionLogSchema.parse(l));

describe("sevDesk-Einzelzahlungen aus CheckAccountTransactionLog", () => {
  it("ordnet jede Zahlung mit Datum, Betrag, Konto und Umsatz ihrem Beleg zu", () => {
    const byVoucher = mapSevPaymentLogs(parsed);
    expect(byVoucher.get("invoice/9001")).toEqual([
      { sourceId: "8002", transactionId: "7001", accountId: "501", date: "2025-03-16", amount: 50000 },
      { sourceId: "8001", transactionId: "7002", accountId: "502", date: "2025-03-22", amount: 50000 },
      { sourceId: "8003", transactionId: "7003", accountId: "501", date: "2025-04-03", amount: 19000 },
    ]);
  });

  it("teilt einen Umsatz nach den zugeordneten Beträgen, nicht nach dem Umsatzbetrag", () => {
    const byVoucher = mapSevPaymentLogs(parsed);
    expect(byVoucher.get("invoice/9002")).toEqual([{ sourceId: "8004", transactionId: "7003", accountId: "501", date: "2025-04-03", amount: 25000 }]);
  });

  it("übernimmt keine Zahlung eines gelöschten Umsatzes und keine ohne Datum", () => {
    const [first, second] = parsed;
    const deleted = { ...first!, checkAccountTransaction: { ...first!.checkAccountTransaction!, deletedAt: "2026-10-01T00:00:00+02:00" } };
    const undated = { ...second!, bookingDate: null, checkAccountTransaction: { ...second!.checkAccountTransaction!, valueDate: null } };
    expect(mapSevPaymentLogs([deleted, undated]).size).toBe(0);
  });

  it("behält das Vorzeichen: Zahlungen auf Ausgaben sind negativ", () => {
    const outgoing = { ...parsed[0]!, amountPaid: -19.99, object: { id: "42", objectName: "Voucher" } };
    expect(mapSevPaymentLogs([outgoing]).get("voucher/42")).toMatchObject([{ amount: -1999 }]);
  });

  it("lädt alle Logs seitenweise mit eingebettetem Umsatz, nur lesend", async () => {
    const calls: URL[] = [];
    const client = new SevdeskClient({
      apiKey: "0123456789abcdef0123456789abcdef",
      minIntervalMs: 0,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push(url);
        expect(init?.method ?? "GET").toBe("GET");
        return new Response(JSON.stringify(url.searchParams.get("offset") === "0" ? logs : { objects: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    const all = [];
    for await (const l of client.checkAccountTransactionLogs()) all.push(l);
    expect(all).toHaveLength(4);
    expect(calls[0]!.pathname).toMatch(/\/CheckAccountTransactionLog$/);
    expect(calls[0]!.searchParams.get("embed")).toBe("checkAccountTransaction");
  });
});
