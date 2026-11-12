import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Neue Teilleistung: Steuerzeitpunkt und Verfahrenswechsel (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let bank: typeof import("../bank/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contactId: string;
  const actor = "teilleistung-test";

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
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, cash_entries cascade`;
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
    issueDate: "2026-12-01",
    serviceFrom: "2026-11-05",
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    variant: "abschlag" as const,
    advanceType: "teilleistung" as const,
    lines: [{ description: "Teilleistung", quantity: 1000, unit: "Psch." as const, unitPrice: 30_000, taxRate: 1900 as const }],
  });

  it.each(["ist", "soll"] as const)("Reverse-Charge-Teilleistung wird auch bei %s im Leistungsmonat gemeldet (§ 18b Satz 3 UStG)", async (mode) => {
    await sql`update company set versteuerung = ${mode}, kontenrahmen = ${mode === "ist" ? "SKR04" : "SKR03"}`;
    const foreign = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Muster GmbH",
      strasse: "Testgasse 1",
      plz: "1010",
      ort: "Wien",
      land: "AT",
      email: "rechnung@firma.example",
      ustId: "ATU12345678",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      ...input(),
      contactId: foreign.id,
      taxTreatment: "reverse_charge",
      lines: [{ description: "Erbrachte Teilleistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 0 }],
    });
    await invoices.finalizeInvoice(actor, draft.id);
    expect(await vat.computeVatFigures({ year: 2026, month: 11 })).toMatchObject({ kz21: 30_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz21: 0 });
    for (const month of [11, 12]) expect((await reports.vatAbgleich({ year: 2026, month })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
  });

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "ist"],
  ] as const)("ZM-Auswahl enthält das Leistungsquartal einer EU-Teilleistung bei %s und %s", async (kontenrahmen, versteuerung) => {
    await sql`update company set versteuerung = ${versteuerung}, kontenrahmen = ${kontenrahmen}`;
    const foreign = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Muster GmbH",
      strasse: "Testgasse 1",
      plz: "1010",
      ort: "Wien",
      land: "AT",
      email: "rechnung@firma.example",
      ustId: "ATU12345678",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      ...input(),
      contactId: foreign.id,
      issueDate: "2026-04-01",
      serviceFrom: "2026-03-31",
      taxTreatment: "reverse_charge",
      lines: [{ description: "Erbrachte Teilleistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 0 }],
    });
    await invoices.finalizeInvoice(actor, draft.id);
    expect(await vat.computeVatFigures({ year: 2026, month: 41 })).toMatchObject({ kz21: 30_000 });
    expect(await vat.zmQuartale()).toEqual([{ year: 2026, month: 41, sent: false }]);
  });

  it("eine unter Ist erbrachte Teilleistung bleibt nach dem Wechsel zu Soll bei Zahlung steuerpflichtig", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const old = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...input(),
          variant: null,
          advanceType: null,
          issueDate: "2025-11-05",
          serviceFrom: "2025-11-05",
          lines: [{ description: "Frühere Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
        })
      ).id,
    );
    await bank.createCashInvoiceEntry(actor, { invoiceId: old.id, date: "2025-11-05", amount: 11_900 }, "2025-11-05");
    await contacts.saveCompany(actor, { ...(await contacts.loadCompany()), versteuerung: "soll" }, "2026-01-01");
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, { ...input(), serviceFrom: "2025-11-20" })).id);
    expect(await vat.computeVatFigures({ year: 2025, month: 11 })).toMatchObject({ kz81: 10_000, tax81: 1_900 });
    expect(await vat.computeVatFigures({ year: 2026, month: 12 })).toMatchObject({ kz81: 0, tax81: 0 });
    await bank.createCashInvoiceEntry(actor, { invoiceId: invoice.id, date: "2027-01-12", amount: 35_700 }, "2027-01-12");
    expect(await vat.computeVatFigures({ year: 2027, month: 1 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
    expect((await reports.vatAbgleich({ year: 2027, month: 1 })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
  });

  for (const previous of ["ist", "soll"] as const) {
    const next = previous === "ist" ? "soll" : "ist";
    it(`Anzahlung ${previous} → ${next}: Rücknahme der Vorjahreszahlung vor der Schlussleistung folgt dem neuen Leistungsjahr`, async () => {
      await sql`update company set versteuerung = ${previous}`;
      const advance = await invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            ...input(),
            advanceType: "anzahlung",
            issueDate: "2025-12-01",
            serviceFrom: null,
          })
        ).id,
      );
      const payment = await bank.createCashInvoiceEntry(actor, { invoiceId: advance.id, date: "2025-12-12", amount: 35_700 }, "2025-12-12");
      // Erst vollständig bezahlt umstellen, wie es die echte Einstellungssperre verlangt. Die spätere Gegenzeile ist
      // ein normaler Schreibweg; keine manipulierte Firmenhistorie und keine übersprungene Sperre.
      await contacts.saveCompany(actor, { ...(await contacts.loadCompany()), versteuerung: next }, "2026-01-01");
      await bank.reverseCashEntry(actor, payment.id, "2026-01-12");
      await invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            ...input(),
            advanceType: null,
            variant: "schluss",
            issueDate: "2026-01-20",
            serviceFrom: "2026-01-20",
            deducts: [advance.id],
            lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
          })
        ).id,
      );
      expect(await vat.computeVatFigures({ year: 2025, month: 12 })).toMatchObject({ kz81: 30_000, tax81: 5_700 });
      expect(await vat.computeVatFigures({ year: 2026, month: 1 })).toMatchObject(
        next === "soll" ? { kz81: 70_000, tax81: 13_300 } : { kz81: -30_000, tax81: -5_700 },
      );
      expect((await reports.vatAbgleich({ year: 2026, month: 1 })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
    });

    it(`Schlussleistung im ${previous}-Vorjahr behält nach Wechsel zu ${next} ihren Steuerzeitpunkt`, async () => {
      await sql`update company set versteuerung = ${previous}`;
      const advance = await invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            ...input(),
            advanceType: "anzahlung",
            issueDate: "2025-12-01",
            serviceFrom: null,
          })
        ).id,
      );
      await bank.createCashInvoiceEntry(actor, { invoiceId: advance.id, date: "2025-12-12", amount: 35_700 }, "2025-12-12");
      await contacts.saveCompany(actor, { ...(await contacts.loadCompany()), versteuerung: next }, "2026-01-01");
      const final = await invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            ...input(),
            advanceType: null,
            variant: "schluss",
            issueDate: "2026-01-20",
            serviceFrom: "2025-12-20",
            deducts: [advance.id],
            lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
          })
        ).id,
      );
      expect(await vat.computeVatFigures({ year: 2025, month: 12 })).toMatchObject(
        previous === "soll" ? { kz81: 100_000, tax81: 19_000 } : { kz81: 30_000, tax81: 5_700 },
      );
      expect(await vat.computeVatFigures({ year: 2026, month: 1 })).toMatchObject({ kz81: 0, tax81: 0 });
      await bank.createCashInvoiceEntry(actor, { invoiceId: final.id, date: "2026-02-12", amount: 83_300 }, "2026-02-12");
      expect(await vat.computeVatFigures({ year: 2026, month: 2 })).toMatchObject(previous === "ist" ? { kz81: 70_000, tax81: 13_300 } : { kz81: 0, tax81: 0 });
      for (const month of [1, 2]) expect((await reports.vatAbgleich({ year: 2026, month })).zeilen.filter((r) => r.journal !== r.quelle)).toEqual([]);
    });
  }
});
