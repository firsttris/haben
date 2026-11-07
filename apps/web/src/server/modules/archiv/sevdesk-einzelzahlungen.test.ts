import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import logFixture from "../../../../../../packages/import/test-fixtures/sevdesk/check-account-transaction-log.json" with { type: "json" };
import unlinkedLogFixture from "../../../../../../packages/import/test-fixtures/sevdesk/check-account-transaction-log-aufgehoben.json" with { type: "json" };
import unlinkedInvoiceFixture from "../../../../../../packages/import/test-fixtures/sevdesk/invoice-teilzahlung-aufgehoben.json" with { type: "json" };
import invoiceFixture from "../../../../../../packages/import/test-fixtures/sevdesk/invoice-teilzahlungen.json" with { type: "json" };
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// #343: Einzelzahlungen aus sevDesk mit Datum, Betrag, Konto und Belegbezug statt einer Verdichtung am letzten Zahltag.
describe.skipIf(!testDatabaseUrl)("sevDesk-Einzelzahlungen (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let sevdesk: typeof import("./sevdesk.ts");
  let importPkg: typeof import("@haben/import");
  let run: string;
  let logsStatus = 200;

  const voucher = async (lexofficeId: string, number: string, payment: object, raw: object) => {
    const [v] = await sql`insert into lexoffice_vouchers
      (lexoffice_id, source, import_id, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${lexofficeId}, 'sevdesk', ${run}, 'invoice', 'einnahme', ${number}, '2026-10-01', 'paid', 'Kunde', 100000, 19000, 119000,
      '[{"rate":1900,"net":100000,"tax":19000}]', '[]', ${JSON.stringify(payment)}::jsonb, ${JSON.stringify(raw)}::jsonb) returning id`;
    return v!.id as string;
  };
  const pay = (voucherId: string, externalId: string, account: string, date: string, amount: number) =>
    sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
      values (${voucherId}, ${run}, 'sevdesk', ${externalId}, ${`tx-${externalId}`}, ${account}, ${`Konto ${account}`}, ${date}, ${amount}, '{}')`;

  // Beispiel aus #343: 1.190 € brutto, 595 € am 15.10. über Konto A, 595 € am 15.11. über Konto B.
  // Altbestand vor #348: beide Raten als eine Zahlung am 15.11. gespeichert.
  const condensed = { status: "balanced", openAmount: 0, paidDate: "2026-11-15", items: [{ type: "manualPayment", date: "2026-11-15", amount: 119000 }] };
  const raw = { taxType: "default", status: "1000", paidAmount: 1190, payDate: "2026-11-15T00:00:00+01:00" };
  let split: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    sevdesk = await import("./sevdesk.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
      'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    const [r] = await sql`insert into lexoffice_imports (source, status, progress) values ('sevdesk', 'fertig', '{}') returning id`;
    run = r!.id as string;
    split = await voucher("invoice/200", "RE-200", condensed, raw);
    await pay(split, "log-1", "501", "2026-10-15", 59500);
    await pay(split, "log-2", "502", "2026-11-15", 59500);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  describe("Auswertung belegter Einzelzahlungen", () => {
    it("zeigt zum 31.10. genau 595 € offen, ohne Sperre wegen der Zahlungshistorie", async () => {
      const item = (await legacy.openLegacyItems("2026-10-31")).find((v) => v.id === split)!;
      expect(item).toMatchObject({ open: 59500, paidAfter: 59500 });
      expect(item.blocker ?? "").not.toMatch(/Zahlungshistorie/);
    });

    it.each(["SKR03", "SKR04"])("verteilt die Ist-Steuer bei %s auf Oktober und November", async (kontenrahmen) => {
      await sql`update company set versteuerung = 'ist', kontenrahmen = ${kontenrahmen} where id = 1`;
      const year = (await archive.reconciliation()).years.find((y) => y.year === 2026)!;
      expect(year.vatIssue).toBeNull();
      expect(year.vat.find((m) => m.month === "2026-10")).toMatchObject({ kz81: 50000, tax81: 9500 });
      expect(year.vat.find((m) => m.month === "2026-11")).toMatchObject({ kz81: 50000, tax81: 9500 });
    });

    it.each(["SKR03", "SKR04"])("lässt die Soll-Steuer bei %s im Monat des Belegs", async (kontenrahmen) => {
      await sql`update company set versteuerung = 'soll', kontenrahmen = ${kontenrahmen} where id = 1`;
      try {
        const year = (await archive.reconciliation()).years.find((y) => y.year === 2026)!;
        expect(year.vat.find((m) => m.month === "2026-10")).toMatchObject({ kz81: 100000, tax81: 19000 });
      } finally {
        await sql`update company set versteuerung = 'ist', kontenrahmen = 'SKR03' where id = 1`;
      }
    });

    it("zeigt beide Zahlungen getrennt mit Konto statt der früheren Verdichtung", async () => {
      const { voucher: v } = (await archive.legacyVoucherDetail(split))!;
      expect(v.paymentHistoryIssue).toBeNull();
      expect(v.payment!.items).toMatchObject([
        { date: "2026-10-15", amount: 59500, account: "Konto 501" },
        { date: "2026-11-15", amount: 59500, account: "Konto 502" },
      ]);
    });

    it("findet den Beleg in der zahlungsbezogenen Monatsabfrage für Oktober", async () => {
      const { vouchers } = await archive.legacyVouchersForPeriod({ period: "2026-10", direction: "alle", search: "", withPayments: true, limit: 100 });
      expect(vouchers.map((v) => v.number)).toContain("RE-200");
    });

    it("bleibt gesperrt, wenn die Einzelzahlungen den Zahlungsstand nicht ergeben", async () => {
      const partial = await voucher("invoice/201", "RE-201", condensed, raw);
      await pay(partial, "log-3", "501", "2026-10-15", 59500);
      const item = (await legacy.openLegacyItems("2026-10-31")).find((v) => v.id === partial)!;
      expect(item.blocker).toMatch(/Zahlungshistorie/);
      expect((await archive.legacyVoucherDetail(partial))!.voucher.paymentHistoryIssue).toMatch(/595,00\s€ von 1\.190,00\s€/);
    });

    it("bleibt bei Zahlung und Rückbuchung (gemischte Vorzeichen) gesperrt", async () => {
      const mixed = await voucher("invoice/202", "RE-202", condensed, raw);
      await pay(mixed, "log-4", "501", "2026-10-15", 178500);
      await pay(mixed, "log-5", "501", "2026-10-20", -59500);
      expect((await archive.legacyVoucherDetail(mixed))!.voucher.paymentHistoryIssue).toMatch(/Rückbuchung/);
    });

    it("legt die Einzelzahlungen mit Konto und Quellkennung ins Jahresarchiv", async () => {
      const { exportYear } = await import("./export.ts");
      const chunks: Uint8Array[] = [];
      for await (const chunk of exportYear(2026)) chunks.push(chunk);
      const csv = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/zahlungen.csv"]!);
      const lines = csv.split(/\r?\n/).filter((l) => l.includes("RE-200"));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/2026-10-15.*595,00.*Konto 501.*log-1/);
      expect(lines[1]).toMatch(/2026-11-15.*595,00.*Konto 502.*log-2/);
    });

    it("hält die Zahlungsnachweise unveränderlich", async () => {
      await expect(sql`update legacy_voucher_payments set amount = 1 where external_id = 'log-1'`).rejects.toThrow();
      await expect(sql`delete from legacy_voucher_payments where external_id = 'log-1'`).rejects.toThrow();
    });
  });

  describe("Abruf aus sevDesk mit echten V1-Antworten", () => {
    const TOKEN = "0123456789abcdef0123456789abcdef";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const calls: string[] = [];

    beforeAll(async () => {
      sevdesk.setSevdeskClientFactory(
        (o) =>
          new importPkg.SevdeskClient({
            ...o,
            minIntervalMs: 0,
            maxRetries: 0,
            sleep: async () => {},
            fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
              const url = new URL(String(input));
              const path = url.pathname.replace(/^\/api\/v1/, "");
              calls.push(path);
              expect(init?.method ?? "GET").toBe("GET");
              const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
              switch (path) {
                case "/Tools/bookkeepingSystemVersion":
                  return json({ objects: { version: "1.0" } });
                case "/Contact":
                  return list([{ id: "1", name: "Kunde GmbH", customerNumber: "1001" }]);
                case "/Invoice":
                  return list([...invoiceFixture.objects, ...unlinkedInvoiceFixture.objects]);
                case "/ContactAddress":
                case "/CommunicationWay":
                case "/CreditNote":
                case "/Voucher":
                case "/Order":
                  return list([]);
                case "/Invoice/9003/getPositions":
                case "/Invoice/9001/getPositions":
                  return list([{ id: 1, taxRate: "19", sumNet: "4000", sumTax: "760" }]);
                case "/CheckAccount":
                  return list([
                    { id: "501", name: "Geschäftskonto A", currency: "EUR" },
                    { id: "502", name: "Geschäftskonto B", currency: "EUR" },
                  ]);
                case "/CheckAccountTransactionLog":
                  return logsStatus === 200 ? list([...logFixture.objects, ...unlinkedLogFixture.objects]) : json({ error: { message: "kaputt" } }, logsStatus);
                case "/Invoice/9003/getPdf":
                case "/Invoice/9001/getPdf":
                  return json({
                    objects: {
                      filename: "RE-0001.pdf",
                      mimeType: "application/pdf",
                      base64encoded: true,
                      content: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
                    },
                  });
              }
              return json({ error: { message: `unbekannt ${path}` } }, 404);
            }) as typeof fetch,
          }),
      );
      await sevdesk.saveSevdeskKey("test-user", TOKEN);
    });

    const rows = () => sql`select p.external_id, p.account_name, p.date::text as date, p.amount from legacy_voucher_payments p
      join lexoffice_vouchers v on v.id = p.voucher_id where v.lexoffice_id = 'invoice/9001' order by p.date`;
    const item = async (cutoff: string) => {
      const [v] = await sql`select id from lexoffice_vouchers where lexoffice_id = 'invoice/9001'`;
      return (await legacy.openLegacyItems(cutoff)).find((i) => i.id === v!.id);
    };

    it("archiviert die Rechnung trotz fehlgeschlagenem Zahlungsabruf und lässt sie gesperrt", async () => {
      logsStatus = 500;
      await sevdesk.startSevdeskImport("test-user", { wait: true });
      const latest = (await sevdesk.latestSevdeskImport())!;
      expect(latest.status).toBe("fertig");
      expect(latest.progress.failed).toMatchObject([{ message: expect.stringMatching(/Einzelzahlungen/) }]);
      expect(await rows()).toHaveLength(0);
      expect((await item("2026-08-25"))!.blocker).toMatch(/Zahlungshistorie/);
    });

    it("repariert die schon archivierte Rechnung beim nächsten Abruf: drei Zahlungen über zwei Konten", async () => {
      logsStatus = 200;
      await sevdesk.startSevdeskImport("test-user", { wait: true });
      expect((await sevdesk.latestSevdeskImport())!.progress.failed).toEqual([]);
      expect(await rows()).toEqual([
        { external_id: "8002", account_name: "Geschäftskonto A", date: "2026-08-21", amount: 200000 },
        { external_id: "8001", account_name: "Geschäftskonto B", date: "2026-08-27", amount: 200000 },
        { external_id: "8003", account_name: "Geschäftskonto A", date: "2026-09-08", amount: 76000 },
      ]);
      expect(await item("2026-08-25")).toMatchObject({ open: 276000, paidAfter: 276000 });
      expect(await item("2026-08-31")).toMatchObject({ open: 76000, paidAfter: 76000 });
      expect((await item("2026-08-31"))!.blocker ?? "").not.toMatch(/Zahlungshistorie/);
      expect(await item("2026-09-08")).toBeUndefined();
    });

    // Echte V1-Antwort nach dem Aufheben einer Zuordnung in sevDesk: Der Log-Eintrag ist gelöscht, es gibt keine
    // Gegenbuchung. Status 750, paidAmount 1.760, payDate bleibt auf dem Tag der aufgehobenen Zahlung stehen.
    it("übernimmt nach einer aufgehobenen Zuordnung nur die verbliebene Teilzahlung und ignoriert das alte payDate", async () => {
      const [v] = await sql`select id, status, payment from lexoffice_vouchers where lexoffice_id = 'invoice/9003'`;
      expect(v).toMatchObject({ status: "open", payment: { status: "partlyPaid", openAmount: 300000, paidDate: null } });
      const payments = await sql`select date::text as date, amount from legacy_voucher_payments where voucher_id = ${v!.id}`;
      expect(payments).toEqual([{ date: "2026-10-22", amount: 176000 }]);
      const item = (await legacy.openLegacyItems("2026-10-31")).find((i) => i.id === v!.id)!;
      expect(item).toMatchObject({ open: 300000, paidAfter: 0 });
      expect(item.blocker ?? "").not.toMatch(/Zahlungshistorie/);
      expect((await archive.legacyVoucherDetail(v!.id as string))!.voucher.paymentHistoryIssue).toBeNull();
    });

    it("legt bei erneutem Abruf keine Zahlung doppelt an und übernimmt den fremden Anteil des geteilten Umsatzes nicht", async () => {
      await sevdesk.startSevdeskImport("test-user", { wait: true });
      expect(await rows()).toHaveLength(3);
      expect((await sql`select count(*)::int as n from legacy_voucher_payments where external_id = '8004'`)[0]!.n).toBe(0);
      expect(calls.filter((p) => /\/(bookAmount|enshrine|sendBy|changeParameter)$/.test(p))).toEqual([]);
    });
  });
});
