import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * #853 Gegenprobe: Die Rechnung mit Leistungszeitraum, aber ohne Vorauszahlung, ist der häufigste Fall. Sie bekommt
 * jetzt dieselbe Verfahrensmarkierung wie eine Vorauszahlung; ihre Werte dürfen sich dadurch nicht ändern.
 * Soll: Steuer mit Ablauf des Monats der Leistung (§ 13 Abs. 1 Nr. 1 a Satz 1 UStG), Ist: mit Vereinnahmung (Buchst. b).
 * https://www.gesetze-im-internet.de/ustg_1980/__13.html
 */
describe.skipIf(!testDatabaseUrl)("Normale Rechnung mit Leistungszeitraum ohne Vorauszahlung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let accounting: typeof import("../buchhaltung/index.ts");
  let contactId: string;
  const actor = "normale-rechnung-test";
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

  async function invoice(serviceFrom: string | null, serviceTo: string | null, issueDate: string) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom,
      serviceTo,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
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

  async function balance(account: string, to: string) {
    const rows = await accounting.saldenliste({ from: "2026-01-01", to });
    return rows.find((row) => row.account === account)?.saldo ?? 0;
  }

  async function kz81(month: number) {
    const figures = await vat.computeVatFigures({ year: 2026, month });
    expect.soft((await reports.vatAbgleich({ year: 2026, month })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
    return { kz81: figures.kz81, tax81: figures.tax81 };
  }

  const cases = [
    { form: "gmbh", frame: "SKR03", mode: "soll" },
    { form: "gmbh", frame: "SKR04", mode: "ist" },
    { form: "einzelunternehmen", frame: "SKR04", mode: "soll" },
    { form: "einzelunternehmen", frame: "SKR03", mode: "ist" },
  ] as const;
  for (const { form, frame, mode } of cases)
    it(`${form}, ${frame}, ${mode}: Leistung Oktober, Rechnung 5.11., Zahlung 20.11. wie bisher`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${mode}`;
      const final = await invoice("2026-10-01", "2026-10-31", "2026-11-05");
      await pay(final.id, "2026-11-20", 119_000);
      const accounts = ACCOUNTS[frame];
      expect(await kz81(10)).toEqual(mode === "soll" ? { kz81: 100_000, tax81: 19_000 } : { kz81: 0, tax81: 0 });
      expect(await kz81(11)).toEqual(mode === "ist" ? { kz81: 100_000, tax81: 19_000 } : { kz81: 0, tax81: 0 });
      expect(await balance(accounts.ust[1900], "2026-12-31")).toBe(-19_000);
      expect(await balance(accounts.ustNichtFaellig[1900], "2026-12-31")).toBe(0);
      expect(await balance(accounts.erloese[1900], "2026-12-31")).toBe(-100_000);
      expect(await balance(accounts.forderungen, "2026-12-31")).toBe(0);
      expect(await balance(accounts.erhalteneAnzahlungen, "2026-12-31")).toBe(0);
      expect((await reports.checkIntegrity("2027-01-01")).abgleich.abweichungen).toEqual([]);
    }, 20_000);

  // Rechnung mit und ohne Leistungszeitraum, sonst gleich: Die Steuer darf nicht davon abhängen, ob das Feld befüllt ist.
  for (const service of [null, "2026-10-05"] as const)
    it(`Soll, bezahlt, dann Rechnungskorrektur um 10 % im Dezember (Leistung ${service ?? "ohne Angabe"})`, async () => {
      await sql`update company set rechtsform = 'einzelunternehmen'`;
      const final = await invoice(service, null, "2026-10-05");
      await pay(final.id, "2026-10-20", 119_000);
      const draft = await invoices.createCorrection(actor, final.id, "2026-12-10");
      await invoices.updateDraft(actor, draft.id, {
        contactId,
        issueDate: "2026-12-10",
        serviceFrom: service,
        serviceTo: null,
        paymentTermDays: 0,
        format: "zugferd",
        note: "",
        lines: [{ description: "Nachlass", quantity: 1000, unit: "Psch.", unitPrice: -10_000, taxRate: 1900 }],
      });
      await invoices.finalizeInvoice(actor, draft.id);
      // docs/rechnungen.md, „Verrechnen ohne Zahlung“: Bei Soll mindert die Korrektur die Umsatzsteuer in ihrem eigenen Monat.
      // Die neue Doku nennt den Erstattungszeitpunkt nur für die vollständige Rückabwicklung.
      expect(await kz81(10)).toEqual({ kz81: 100_000, tax81: 19_000 });
      expect(await kz81(12)).toEqual({ kz81: -10_000, tax81: -1_900 });
    }, 20_000);
});
