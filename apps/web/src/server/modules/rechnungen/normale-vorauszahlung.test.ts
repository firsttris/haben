import { ACCOUNTS } from "@haben/core";
import { datevAccountTotals, parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #853: Eine normale Rechnung ändert den Charakter einer vor Leistung erhaltenen Zahlung nicht.
 * § 13 Abs. 1 Nr. 1 a Satz 4 / b UStG: Steuer bei Vereinnahmung, auch bei Soll; UStAE 13.5 Abs. 1/3.
 * § 252 Abs. 1 Nr. 4/5 und § 266 Abs. 3 C.3 HGB: bis zur Leistung Verbindlichkeit, danach genau einmal Erlös.
 * Kontierung 1710/3250 ohne AM: DATEV SKR03/04 2026, S. 10/11 und Maintainerentscheid #750.
 * https://www.gesetze-im-internet.de/ustg_1980/__13.html
 * https://www.gesetze-im-internet.de/hgb/__252.html
 * https://www.gesetze-im-internet.de/hgb/__266.html
 * https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
describe.skipIf(!testDatabaseUrl)("Vorauszahlung auf normale EUR-Inlandsrechnung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let accounting: typeof import("../buchhaltung/index.ts");
  let contactId: string;
  const actor = "normale-vorauszahlung-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
    accounting = await import("../buchhaltung/index.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung, journal_ab)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', ${iban}, 'SKR03', 'soll', 2025)`;
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

  async function invoice(serviceFrom = "2026-01-20") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-01-20",
      serviceFrom,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "Vereinbarte vollständige Softwareeinrichtung am angegebenen Leistungstag",
      lines: [{ description: "Softwareeinrichtung", quantity: 1000, unit: "Psch.", unitPrice: 70_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  // Derselbe CSV-Import wie im Bankabgleich, anschließend die öffentliche Zuordnungs-API.
  async function pay(invoiceId: string, via: "bank" | "bar", date: string, amount: number) {
    if (via === "bar") {
      await bank.createCashInvoiceEntry(actor, { invoiceId, date, amount }, "2026-03-01");
      return;
    }
    const germanDate = `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
    const purpose = `Rechnungszahlung ${date}`;
    const euros = `${Math.trunc(amount / 100)},${String(amount % 100).padStart(2, "0")}`;
    const csv =
      `"Girokonto";"${iban}"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${germanDate}";"${germanDate}";"Gebucht";"Nordwerk Software GmbH";"Test GmbH";"${purpose}";"Überweisung";"DE02120300000000202051";"${euros}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${date}.csv` }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose = ${purpose}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount });
  }

  async function balance(account: string, to: string) {
    const rows = await accounting.saldenliste({ from: "2025-01-01", to });
    return rows.find((row) => row.account === account)?.saldo ?? 0;
  }

  async function tax(year: number, month: number, base: number, amount: number) {
    const figures = await vat.computeVatFigures({ year, month });
    expect.soft(figures, `USt ${year}-${month}`).toMatchObject({ kz81: base, tax81: amount });
    expect.soft(figures.nebenbuecher, `USt-Nebenbuch ${year}-${month}`).toMatchObject({ kz81: base, tax81: amount });
    expect.soft((await reports.vatAbgleich({ year, month })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
  }

  const cases = [
    { form: "gmbh", frame: "SKR03", mode: "soll", via: "bank", paid: 83_300 },
    { form: "ug", frame: "SKR04", mode: "ist", via: "bar", paid: 83_300 },
    { form: "ug", frame: "SKR04", mode: "soll", via: "bank", paid: 11_900 },
    { form: "gmbh", frame: "SKR03", mode: "ist", via: "bar", paid: 11_900 },
  ] as const;
  for (const { form, frame, mode, via, paid } of cases) {
    it(`${form}, ${frame}, ${mode}, ${via}, ${paid / 100} €: Zahlung im Dezember, Erlös im Januar, Steuer insgesamt genau einmal`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${mode}`;
      const finalized = await invoice();
      expect(finalized).toMatchObject({ net: 70_000, tax: 13_300, gross: 83_300, variant: null });
      // Nachträglich erfasst: das Geld war tatsächlich am 13.12.2025 eingegangen.
      await pay(finalized.id, via, "2025-12-13", paid);
      const full = paid === 83_300;
      const netPaid = full ? 70_000 : 10_000;
      const taxPaid = full ? 13_300 : 1_900;
      const accounts = ACCOUNTS[frame];

      expect.soft(await balance(accounts.erhalteneAnzahlungen, "2025-12-31"), "Nettoanzahlung am Jahresende").toBe(-netPaid);
      expect.soft(await balance(accounts.forderungen, "2025-12-31"), "keine negative Forderung statt Anzahlung").toBe(0);
      expect.soft(await balance(accounts.erloese[1900], "2025-12-31"), "kein Erlös vor Leistung").toBe(0);
      expect.soft(await balance(accounts.ust[1900], "2025-12-31"), "fällige Dezember-USt auch bei Soll").toBe(-taxPaid);
      await tax(2025, 12, netPaid, taxPaid);
      await tax(2026, 1, mode === "soll" ? 70_000 - netPaid : 0, mode === "soll" ? 13_300 - taxPaid : 0);

      const december = await accounting.jahresabschluss(2025, "2026-03-01");
      const january = await accounting.jahresabschluss(2026, "2027-01-01");
      expect.soft(december.kapitalgesellschaft && december.report.guv.umsatzerloese).toBe(0);
      expect.soft(december.kapitalgesellschaft && december.report.bilanz["passiva.C"], "Anzahlung und USt als Verbindlichkeiten").toBe(paid);
      expect.soft(january.kapitalgesellschaft && january.report.guv.umsatzerloese).toBe(70_000);
      expect.soft(await balance(accounts.erhalteneAnzahlungen, "2026-01-31"), "Anzahlung mit Leistung aufgelöst").toBe(0);
      expect.soft(await balance(accounts.forderungen, "2026-01-31")).toBe(83_300 - paid);

      if (!full) await pay(finalized.id, via, "2026-02-13", 71_400);
      await tax(2026, 2, mode === "ist" ? 70_000 - netPaid : 0, mode === "ist" ? 13_300 - taxPaid : 0);
      expect.soft(await balance(accounts.ust[1900], "2026-02-28"), "gesamte Steuer genau einmal").toBe(-13_300);
      expect.soft(await balance(accounts.erloese[1900], "2026-02-28"), "Gesamterlös 700 Euro").toBe(-70_000);
      expect.soft((await reports.openPositions("2026-02-28")).receivables).toEqual([]);
      expect((await bank.invoicePaymentList(finalized.id)).map((payment) => [payment.via, payment.date, payment.amount])).toEqual(
        full
          ? [[via, "2025-12-13", 83_300]]
          : [
              [via, "2025-12-13", 11_900],
              [via, "2026-02-13", 71_400],
            ],
      );
      expect(await sql`select count(*)::int as n from bank_transactions`).toEqual([{ n: via === "bank" ? (full ? 1 : 2) : 0 }]);
      expect(await sql`select count(*)::int as n from cash_entries`).toEqual([{ n: via === "bar" ? (full ? 1 : 2) : 0 }]);
      await reports.saveDatevNumbers(actor, { beraterNr: "12345", mandantNr: "123" });
      const { bytes } = await reports.datevExport(2025);
      const exported = datevAccountTotals(parseDatevBuchungsstapel(bytes).bookings);
      const advance = exported.find((row) => row.account === accounts.erhalteneAnzahlungen);
      expect.soft((advance?.credit ?? 0) - (advance?.debit ?? 0), "DATEV-Nettoanzahlung").toBe(netPaid);
      expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
    });
  }

  it("#455: Zahlung nach erbrachter Leistung und vor Rechnungsdatum bleibt möglich", async () => {
    const finalized = await invoice("2025-12-01");
    await pay(finalized.id, "bar", "2025-12-13", 83_300);
    expect(await balance(ACCOUNTS.SKR03.erhalteneAnzahlungen, "2025-12-31")).toBe(0);
    expect(await balance(ACCOUNTS.SKR03.erloese[1900], "2025-12-31")).toBe(-70_000);
    await tax(2025, 12, 70_000, 13_300);
    await tax(2026, 1, 0, 0);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("EÜR: normale Rechnung mit künftiger Leistung bleibt im tatsächlichen Zuflussjahr (§ 11 Abs. 1 EStG)", async () => {
    // Quelle: https://www.gesetze-im-internet.de/estg/__11.html
    await sql`update company set rechtsform = 'einzelunternehmen', versteuerung = 'ist'`;
    const finalized = await invoice();
    await pay(finalized.id, "bar", "2025-12-13", 83_300);
    for (const year of [2025, 2026]) {
      const euer = await reports.euerForYear(year);
      expect(euer.einnahmen.find((row) => row.key === "einnahmenSteuerpflichtig")?.amount).toBe(year === 2025 ? 70_000 : 0);
      expect(euer.einnahmen.find((row) => row.key === "vereinnahmteUst")?.amount).toBe(year === 2025 ? 13_300 : 0);
      expect((await reports.euerAbgleich(year)).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
    }
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
