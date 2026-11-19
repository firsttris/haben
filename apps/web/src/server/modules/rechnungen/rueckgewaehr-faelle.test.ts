import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/**
 * #853, Fälle aus den Prüfungen zu rueckgewaehr.test.ts: Teilleistungs-Abschlag, Raten, Kasse, Jahreswechsel, Aufhebung,
 * Ist, Fremdwährung, Verrechnung im Folgejahr und mehrere Steuersätze. Die Überzahlung verteilt sich auf die Sätze im
 * Verhältnis der Minderung der gekennzeichneten Korrekturen; eingehendes Geld wird nie abgelehnt (Entscheidung des
 * Maintainers zu #1228).
 */
describe.skipIf(!testDatabaseUrl)("Minderung erst mit der Rückzahlung: weitere Fälle (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let contactId: string;
  const actor = "rueckgewaehr-faelle-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries, invoice_settlements cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', ${iban}, 'SKR03', 'soll')`;
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

  type Line = { description: string; quantity: number; unit: string; unitPrice: number; taxRate: 0 | 700 | 1900 };
  const beratung = (unitPrice: number, taxRate: Line["taxRate"] = 1900): Line => ({
    description: "Beratung",
    quantity: 1000,
    unit: "Psch.",
    unitPrice,
    taxRate,
  });

  async function invoice(lines: Line[] = [beratung(100_000)], issueDate = "2026-05-05") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines,
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function correctionDraft(originalId: string, date: string, lines: Line[]) {
    const draft = await invoices.createCorrection(actor, originalId, date);
    await invoices.updateDraft(actor, draft.id, {
      contactId,
      issueDate: date,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 0,
      format: "zugferd",
      note: "",
      lines,
    });
    return draft;
  }

  async function correction(originalId: string, date: string, lines: Line[] = [beratung(-10_000)]) {
    return invoices.finalizeInvoice(actor, (await correctionDraft(originalId, date, lines)).id, kleinunternehmerStand);
  }

  async function pay(invoiceId: string, date: string, amount: number) {
    const germanDate = `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
    const purpose = `Zahlung ${invoiceId} ${date} ${amount}`;
    const abs = Math.abs(amount);
    const euros = `${amount < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${germanDate}";"${germanDate}";"Gebucht";"Nordwerk Software GmbH";"Test GmbH";"${purpose}";"Überweisung";"DE02120300000000202051";"${euros}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${date}-${amount}.csv` }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount });
  }

  async function figures(month: number) {
    const f = await vat.computeVatFigures({ year: 2026, month });
    expect.soft((await reports.vatAbgleich({ year: 2026, month })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
    return { kz81: f.kz81, tax81: f.tax81, kz86: f.kz86, tax86: f.tax86 };
  }
  const kz = async (month: number) => {
    const { kz81, tax81 } = await figures(month);
    return { kz81, tax81 };
  };

  async function integrity() {
    expect((await reports.checkIntegrity("2027-01-01")).abgleich.abweichungen).toEqual([]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  }

  async function kzIn(year: number, month: number) {
    const f = await vat.computeVatFigures({ year, month });
    expect.soft((await reports.vatAbgleich({ year, month })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
    return { kz81: f.kz81, tax81: f.tax81 };
  }

  it("R1 Soll: bezahlte Teilleistungs-Abschlagsrechnung, Korrektur mindert erst mit der Rückzahlung", async () => {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-05-05",
      serviceFrom: "2026-05-01",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "teilleistung",
      lines: [beratung(100_000)],
    } as never);
    const original = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await pay(original.id, "2026-05-20", 119_000);
    const k = await correction(original.id, "2026-06-10");
    expect(k.reductionRule).toBe("rueckgewaehr");
    expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
    await pay(k.id, "2026-07-15", -11_900);
    expect(await kz(7)).toEqual({ kz81: -10_000, tax81: -1_900 });
    await integrity();
  }, 40_000);

  it("R2 Soll: Teilerstattung der Korrektur, danach Storno der Rechnung samt Korrektur", async () => {
    const original = await invoice();
    await pay(original.id, "2026-05-20", 119_000);
    const k = await correction(original.id, "2026-06-10");
    expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
    await pay(k.id, "2026-07-15", -5_000);
    expect(await kz(7)).toEqual({ kz81: -4_202, tax81: -798 });
    await invoices.cancelInvoice(actor, original.id, "2026-08-10");
    expect(await kz(8)).toEqual({ kz81: 0, tax81: 0 });
    await integrity();
  }, 40_000);

  it("R3 Soll: bar bezahlt, dann Korrektur", async () => {
    const original = await invoice();
    await bank.createCashInvoiceEntry(actor, { invoiceId: original.id, date: "2026-05-20", amount: 119_000 }, "2026-05-20");
    await correction(original.id, "2026-06-10");
    expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
    await integrity();
  }, 40_000);

  it("R4 Soll: Korrektur im Dezember, Erstattung im Januar des Folgejahres", async () => {
    const original = await invoice([beratung(100_000)], "2026-11-05");
    await pay(original.id, "2026-11-20", 119_000);
    const k = await correction(original.id, "2026-12-10");
    expect(await kzIn(2026, 12)).toEqual({ kz81: 0, tax81: 0 });
    await pay(k.id, "2027-01-15", -11_900);
    expect(await kzIn(2027, 1)).toEqual({ kz81: -10_000, tax81: -1_900 });
    await integrity();
  }, 40_000);

  it("R5 Soll: Erstattung zugeordnet und wieder aufgehoben", async () => {
    const original = await invoice();
    await pay(original.id, "2026-05-20", 119_000);
    const k = await correction(original.id, "2026-06-10");
    await pay(k.id, "2026-07-15", -11_900);
    const [a] = await sql`select id from allocations where invoice_id = ${k.id}`;
    await bank.reverseAllocation(actor, a!.id, "2026-08-03");
    expect(await kz(8)).toEqual({ kz81: 10_000, tax81: 1_900 });
    await integrity();
  }, 40_000);

  it("R7 Ist, GmbH: bezahlt, Korrektur, Erstattung", async () => {
    await sql`update company set versteuerung = 'ist'`;
    const original = await invoice();
    await pay(original.id, "2026-05-20", 119_000);
    const k = await correction(original.id, "2026-06-10");
    expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
    await pay(k.id, "2026-07-15", -11_900);
    expect(await kz(7)).toEqual({ kz81: -10_000, tax81: -1_900 });
    await integrity();
  }, 40_000);

  it("R8 Soll: Rechnung in USD bezahlt, Storno, Erstattung", async () => {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-05-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      currency: "USD",
      exchangeRate: "1,0000",
      lines: [beratung(100_000)],
    } as never);
    const original = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await pay(original.id, "2026-05-20", 119_000);
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-06-10");
    expect(storno.currency).toBe("USD");
    expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
    await pay(storno.id, "2026-07-15", -119_000);
    expect(await kz(7)).toEqual({ kz81: -100_000, tax81: -19_000 });
    await integrity();
  }, 40_000);
  describe("mehrere Steuersätze, Korrektur nur des 19-%-Teils (100 € zu 19 % und 100 € zu 7 %)", () => {
    const lines = [beratung(10_000), beratung(10_000, 700)];

    it("50 € bezahlt, Korrektur, danach weitere 100 €: Zahlung angenommen, Überzahlung nur auf 19 % gehalten", async () => {
      const original = await invoice(lines);
      await pay(original.id, "2026-05-20", 5_000);
      await correction(original.id, "2026-06-10");
      expect(await figures(6)).toEqual({ kz81: -10_000, tax81: -1_900, kz86: 0, tax86: 0 });
      await pay(original.id, "2026-07-15", 10_000);
      // 150 € vereinnahmt, Entgelt 107 €: 43 € Überzahlung, ganz beim gekennzeichnet geminderten Satz 19 %
      expect(await figures(7)).toEqual({ kz81: 3_613, tax81: 687, kz86: 0, tax86: 0 });
      await integrity();
    }, 40_000);

    it("150 € bezahlt, dann Korrektur: 43 € Überzahlung auf 19 % gehalten", async () => {
      const original = await invoice(lines);
      await pay(original.id, "2026-05-20", 15_000);
      const k = await correction(original.id, "2026-06-10");
      expect(await figures(6)).toEqual({ kz81: -6_387, tax81: -1_213, kz86: 0, tax86: 0 });
      await pay(k.id, "2026-07-15", -4_300);
      expect(await figures(7)).toEqual({ kz81: -3_613, tax81: -687, kz86: 0, tax86: 0 });
      await integrity();
    }, 40_000);
  });
});
