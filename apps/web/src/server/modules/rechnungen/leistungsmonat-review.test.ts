import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Leistungstag bei Soll: Randfälle (#694, Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contactId: string;
  const actor = "leistungsmonat-review";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, cash_entries, vat_returns cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,ust_id,bundesland,iban,versteuerung,journal_ab)
      values (1,'Testfirma','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010',
      'DE123456789','BY','DE89370400440532013000','soll',2025)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  const input = () => ({
    contactId,
    issueDate: "2026-07-20",
    serviceFrom: "2026-05-01" as string | null,
    serviceTo: "2026-05-31" as string | null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
  });
  const abweichungen = async (year: number, month: number) =>
    (await reports.vatAbgleich({ year, month })).zeilen.filter((r) => r.journal !== r.quelle);
  const buchungstage = async (id: string) =>
    (await sql`select date::text as date from journal_entries where source_type = 'invoice' and source_id = ${id} order by id`).map((r) => r.date);

  it("der eingefrorene Leistungstag ist nach dem Festschreiben unveränderlich", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input())).id);
    expect(final.serviceDate).toBe("2026-05-31");
    await expect(sql`update invoices set service_date = '2026-07-20' where id = ${final.id}`).rejects.toThrow();
  }, 30_000);

  it.each(["SKR03", "SKR04"] as const)("Jahreswechsel %s: Leistung im Dezember, Rechnung im Januar → Dezember, Journal = Nebenbuch", async (kr) => {
    await sql`update company set kontenrahmen = ${kr}`;
    const final = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, { ...input(), issueDate: "2026-01-08", serviceFrom: "2025-12-01", serviceTo: "2025-12-31" })).id,
    );
    expect(await buchungstage(final.id)).toEqual(["2025-12-31"]);
    expect(await vat.computeVatFigures({ year: 2025, month: 12 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 1 })).toMatchObject({ kz81: 0, tax81: 0 });
    expect(await abweichungen(2025, 12)).toEqual([]);
    expect(await abweichungen(2026, 1)).toEqual([]);
  }, 30_000);

  it("Anzahlungsrechnung bei Soll (Einzelunternehmen) bleibt am Rechnungsdatum, auch wenn die Leistung später endet", async () => {
    const advance = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...input(),
          issueDate: "2026-03-10",
          serviceFrom: "2026-03-01",
          serviceTo: "2026-12-31",
          variant: "abschlag",
          advanceType: "anzahlung",
        })
      ).id,
    );
    expect(await buchungstage(advance.id)).toEqual(["2026-03-10"]);
    await bank.createCashInvoiceEntry(actor, { invoiceId: advance.id, date: "2026-04-02", amount: 119_000 }, "2026-04-02");
    expect(await vat.computeVatFigures({ year: 2026, month: 4 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
    for (const month of [3, 4, 12]) expect(await abweichungen(2026, month)).toEqual([]);
  }, 30_000);

  it("Wechsel Ist → Soll zum Jahreswechsel: Leistung im Ist-Jahr zählt nach Zahlung (UStAE 13.6), Journal = Nebenbuch", async () => {
    await sql`update company set versteuerung = 'ist'`;
    await contacts.saveCompany(actor, { ...(await contacts.loadCompany()), versteuerung: "soll" }, "2026-01-01");
    const final = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, { ...input(), issueDate: "2026-01-08", serviceFrom: "2025-12-01", serviceTo: "2025-12-31" })).id,
    );
    await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-02-03", amount: 119_000 }, "2026-02-03");
    const figures = [
      await vat.computeVatFigures({ year: 2025, month: 12 }),
      await vat.computeVatFigures({ year: 2026, month: 1 }),
      await vat.computeVatFigures({ year: 2026, month: 2 }),
    ];
    // Genau einmal gemeldet
    expect(figures.reduce((s, f) => s + f.tax81, 0)).toBe(19_000);
    expect(await abweichungen(2025, 12)).toEqual([]);
    expect(await abweichungen(2026, 1)).toEqual([]);
    expect(await abweichungen(2026, 2)).toEqual([]);
  }, 30_000);

  it("Storno einer Soll-Rechnung mindert im Monat des Stornos (§ 17 Abs. 1 Satz 7 UStG), nicht im Leistungsmonat", async () => {
    const final = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input())).id);
    await invoices.cancelInvoice(actor, final.id, "2026-08-05");
    expect(await vat.computeVatFigures({ year: 2026, month: 5 })).toMatchObject({ kz81: 100_000, tax81: 19_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 8 })).toMatchObject({ kz81: -100_000, tax81: -19_000 });
    for (const month of [5, 7, 8]) expect(await abweichungen(2026, month)).toEqual([]);
  }, 30_000);
});
