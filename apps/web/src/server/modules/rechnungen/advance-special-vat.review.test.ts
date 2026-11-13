import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** § 18b Satz 1 Nr. 2 und Satz 3 UStG: vollständiges Entgelt im Zeitraum der EU-Leistung erklären.
 * https://www.gesetze-im-internet.de/ustg_1980/__18b.html
 */
describe.skipIf(!testDatabaseUrl)("Review #813: Anzahlungsanteil einer EU-Leistung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let contactId: string;
  const actor = "pr813-review-special-vat";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id,name,rechtsform,strasse,plz,ort,email,telefon,steuernummer,bundesland,iban,ust_id,
      kontenrahmen,versteuerung,journal_ab) values (1,'Test GmbH','gmbh','Musterstraße 1','93047','Regensburg',
      'rechnung@example.com','0941 1','198/113/10010','BY','DE89370400440532013000','DE123456789','SKR03','soll',2026)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Alpenblick GmbH",
        strasse: "Musterstraße 1",
        plz: "1010",
        ort: "Wien",
        land: "AT",
        email: "rechnung@example.org",
        ustId: "ATU12345678",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function chain(treatment: "reverse_charge" | "ig_lieferung" | "drittland", skonto = false) {
    if (treatment === "drittland") await sql`update contacts set land='US', ust_id='' where id=${contactId}`;
    const request = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2026-12-01",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          variant: "abschlag",
          advanceType: "anzahlung",
          taxTreatment: treatment,
          lines: [{ description: "Anzahlung EU-Beratung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 0 }],
        })
      ).id,
    );
    expect(request.advanceAccounting).toBe("deferred");
    await bank.createCashInvoiceEntry(actor, { invoiceId: request.id, date: "2026-12-12", amount: skonto ? 29_400 : 30_000, skonto }, "2026-12-12");
    const final = await finalInvoice(request.id, treatment);
    return { request, final };
  }

  async function finalInvoice(requestId: string, treatment: "reverse_charge" | "ig_lieferung" | "drittland", date = "2027-01-20") {
    const final = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: date,
          serviceFrom: "2027-01-20",
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          variant: "schluss",
          deducts: [requestId],
          taxTreatment: treatment,
          lines: [{ description: "EU-Beratung vollständig erbracht", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 0 }],
        })
      ).id,
    );
    expect(final).toMatchObject({ advanceAccounting: "deferred", gross: 70_000 });
    return final;
  }

  it.each([
    ["SKR03", "soll", "reverse_charge", "kz21"],
    ["SKR04", "ist", "reverse_charge", "kz21"],
    ["SKR03", "soll", "ig_lieferung", "kz41"],
    ["SKR04", "ist", "drittland", "kz45"],
  ] as const)("%s/%s/%s: meldet im Leistungsmonat volle 1.000 Euro statt nur 700 Euro Schlussrest in %s", async (frame, mode, treatment, field) => {
    await sql`update company set kontenrahmen=${frame}, versteuerung=${mode}`;
    const { request, final } = await chain(treatment);
    const december = await vat.computeVatFigures({ year: 2026, month: 12 });
    const january = await vat.computeVatFigures({ year: 2027, month: 1 });
    expect({ december: december[field], january: january[field], source: january.nebenbuecher?.[field] }).toEqual({
      december: 0,
      january: 100_000,
      source: 100_000,
    });
    if (treatment !== "drittland") {
      expect((await vat.zmOverview({ year: 2027, month: 41 })).zeilen).toEqual([
        { ustId: "ATU12345678", art: treatment === "reverse_charge" ? "S" : "L", betrag: 100_000 },
      ]);
    }
    await invoices.cancelInvoice(actor, final.id, "2027-02-12");
    await finalInvoice(request.id, treatment, "2027-03-12");
    expect(await Promise.all([1, 2, 3].map(async (month) => (await vat.computeVatFigures({ year: 2027, month }))[field]))).toEqual([100_000, 0, 0]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("SKR04/Ist: verschiebt auch das Skonto der EU-Anforderung erst zur Leistung", async () => {
    await sql`update company set kontenrahmen='SKR04', versteuerung='ist'`;
    await chain("reverse_charge", true);
    const december = await vat.computeVatFigures({ year: 2026, month: 12 });
    const january = await vat.computeVatFigures({ year: 2027, month: 1 });
    expect({ december: december.kz21, sourceDecember: december.nebenbuecher?.kz21, january: january.kz21, sourceJanuary: january.nebenbuecher?.kz21 }).toEqual({
      december: 0,
      sourceDecember: 0,
      january: 99_400,
      sourceJanuary: 99_400,
    });
  });
});
