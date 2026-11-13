import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { AdvanceReceivables } from "@haben/core";

const summary = ({ receivables, requests, unbilled, netAdvances }: AdvanceReceivables) => ({ receivables, requests, unbilled, netAdvances });

describe.skipIf(!testDatabaseUrl)("Neues Anzahlungsverfahren zum historischen Stichtag (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let reader: typeof import("./advance-receivables.ts")["advanceReceivablesAt"];
  let contactId: string;
  const actor = "advance-receivables-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    ({ advanceReceivablesAt: reader } = await import("./advance-receivables.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,bundesland,iban,kontenrahmen,versteuerung,rechtsform,journal_ab)
      values (1,'Muster GmbH','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010','BY',
        'DE89370400440532013000','SKR03','soll','gmbh',2025)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Musterkunde GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@example.org",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function advance() {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2025-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "anzahlung",
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }
  async function finalInvoice(advanceId: string, issueDate: string) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: "2026-01-20",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "schluss",
      deducts: [advanceId],
      lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  it("führt eine neue unbezahlte Anforderung auch ohne irgendeine Journalbuchung im eigenen Umfang", async () => {
    const invoice = await advance();
    expect(await sql`select id from journal_entries`).toEqual([]);
    const stand = await reader("2025-12-31");
    expect(summary(stand)).toEqual({ receivables: 0, requests: 35_700, unbilled: 0, netAdvances: 0 });
    expect(stand.invoiceIds).toContain(invoice.id);
    expect(stand.positions).toMatchObject([{ id: invoice.id, party: "Musterkunde GmbH", kind: "request", open: 35_700 }]);
    const reports = await import("../auswertungen/index.ts");
    expect(await reports.openPositions("2025-12-31")).toMatchObject({
      receivables: [], receivablesTotal: 0,
      advanceRequests: [{ id: invoice.id, open: 35_700 }], advanceRequestsTotal: 35_700,
    });
  });

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "ist"],
  ] as const)("%s/%s: Zahlungsdatum, Leistung und Papierersatz bleiben über fünf Stichtage getrennt", async (frame, mode) => {
    await sql`update company set kontenrahmen=${frame}, versteuerung=${mode}`;
    const a = await advance();
    // Heute zugeordnet, aber tatsächlicher Zufluss im alten Dezember. Nicht created_at als Zahlungsdatum lesen.
    await bank.createCashInvoiceEntry(actor, { invoiceId: a.id, date: "2025-12-12", amount: 11_900 }, "2026-04-20");
    const f = await finalInvoice(a.id, "2026-01-20");
    await bank.createCashInvoiceEntry(actor, { invoiceId: f.id, date: "2026-01-25", amount: 10_000 }, "2026-04-20");
    await invoices.cancelInvoice(actor, f.id, "2026-02-12");
    const r = await finalInvoice(a.id, "2026-03-12");
    await bank.createCashInvoiceEntry(actor, { invoiceId: r.id, date: "2026-04-20", amount: 73_300 }, "2026-04-20");
    const unchanged = await sql`select * from cash_entries order by number`;
    const stands = await Promise.all(["2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map((day) => reader(day)));
    expect(stands.map(summary)).toEqual([
      { receivables: 0, requests: 23_800, unbilled: 0, netAdvances: 10_000 },
      { receivables: 97_100, requests: 0, unbilled: 0, netAdvances: 0 },
      { receivables: 97_100, requests: 0, unbilled: 73_300, netAdvances: 0 },
      { receivables: 97_100, requests: 0, unbilled: 0, netAdvances: 0 },
      { receivables: 23_800, requests: 0, unbilled: 0, netAdvances: 0 },
    ]);
    expect(stands[2]!.positions.find((p) => p.originId === f.id)).toMatchObject({ id: f.id, kind: "unbilled", dueDate: "2026-02-03", open: 73_300 });
    expect(stands[3]!.positions.find((p) => p.originId === f.id)).toMatchObject({ id: r.id, kind: "receivable", dueDate: "2026-03-26", open: 73_300 });
    const reports = await import("../auswertungen/index.ts");
    expect(await reports.openPositions("2026-02-28")).toMatchObject({
      receivables: [{ id: a.id, open: 23_800 }], receivablesTotal: 97_100,
      unbilledReceivables: [{ id: f.id, open: 73_300 }], unbilledReceivablesTotal: 73_300,
      advanceRequests: [], advanceRequestsTotal: 0,
    });
    expect(await sql`select * from cash_entries order by number`).toEqual(unchanged);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("Einzelunternehmen und deren bestehender Erlösweg werden nicht zum neuen Bilanzverfahren erklärt", async () => {
    await sql`update company set rechtsform='einzelunternehmen'`;
    const invoice = await advance();
    expect(invoice.advanceAccounting).toBeNull();
    expect(await reader("2025-12-31")).toEqual({ positions: [], invoiceIds: [], receivables: 0, requests: 0, unbilled: 0, netAdvances: 0 });
  });
});
