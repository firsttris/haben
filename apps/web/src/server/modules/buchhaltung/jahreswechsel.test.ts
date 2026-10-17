import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Buchungen ins Vorjahr nach einem Wechsel von Kontenrahmen oder Versteuerung zum Jahreswechsel.
 * Umstellen erlaubt Haben, solange im neuen Jahr nichts gebucht ist (settings-guard.ts). Was danach noch ins Vorjahr
 * gebucht würde, hinge von der neuen Einstellung ab, das Vorjahr rechnet aber nach der alten.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

const row = (date: string, purpose: string, amount: string) => [
  date, date, "Gebucht", "Nordwerk", "Tristan Teufel", purpose, "Eingang", "DE02100100100006820101", amount, "", "", "",
];

/** Fehlermeldung samt Ursache: Drizzle verpackt den Fehler der Datenbank in „Failed query“ */
async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("Erwartet war ein Fehler");
}

describe.skipIf(!testDatabaseUrl)("Buchen ins Vorjahr nach einem Wechsel zum Jahreswechsel (Postgres)", () => {
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("../umsatzsteuer/vat-figures.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03')`;
  });

  async function draft(issueDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "a@b.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    return invoices.createDraft(actor, {
      contactId: contact.id, issueDate, serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 }],
    });
  }

  /** Rechnung über 1.000 € + 19 %, festgeschrieben und am `paid` (TT.MM.JJ) voll bezahlt */
  async function paidInvoice(issueDate: string, paid: string) {
    const invoice = await invoices.finalizeInvoice(actor, (await draft(issueDate)).id);
    await bank.importStatement(actor, { bytes: dkbCsv([row(paid, `RE ${invoice.number}`, "1.190,00")]), filename: `${invoice.number}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 119_000 });
    const [allocation] = await sql`select id from allocations where invoice_id = ${invoice.id}`;
    return { invoice, allocationId: allocation!.id as string };
  }

  const entryCount = async () => Number((await sql`select count(*)::int as n from journal_entries`)[0]!.n);

  describe("Versteuerung", () => {
    it("Soll → Ist: ein Entwurf des Vorjahres lässt sich nicht mehr festschreiben, die Steuer steht nicht doppelt in der Anmeldung", async () => {
      await paidInvoice("2025-11-10", "05.12.25");
      const late = await draft("2025-12-30");
      // Zum Jahreswechsel umgestellt, im neuen Jahr ist noch nichts gebucht
      await sql`update company set versteuerung = 'ist'`;

      expect(await invoices.finalizeIssues(late.id)).toContain(
        "Das Jahr 2025 ist nach Soll-Versteuerung gebucht, eingestellt ist jetzt Ist-Versteuerung; bitte ein Rechnungsdatum im laufenden Jahr wählen",
      );
      const before = await entryCount();
      await expect(invoices.finalizeInvoice(actor, late.id)).rejects.toThrow(/Das Jahr 2025 ist nach Soll-Versteuerung gebucht/);
      expect(await entryCount()).toBe(before);
      // Keine Nummer verbraucht, der Entwurf bleibt Entwurf
      const [stored] = await sql`select status, number from invoices where id = ${late.id}`;
      expect(stored).toMatchObject({ status: "draft", number: null });
      // Dezember 2025 bleibt nach Soll ohne die Rechnung; sie wäre nach Ist im Januar mit der Zahlung noch einmal gekommen
      expect(await figures.computeVatFigures({ year: 2025, month: 12 })).toMatchObject({ versteuerung: "soll", tax81: 0 });

      // Mit Datum im neuen Jahr geht es, gebucht nach Ist
      const now = await invoices.finalizeInvoice(actor, (await draft("2026-01-05")).id);
      expect(now.status).toBe("final");
      expect(await figures.computeVatFigures({ year: 2026, month: 1 })).toMatchObject({ versteuerung: "ist", tax81: 0 });
    }, 30_000);

    it("Ist → Soll: ebenso, sonst würde die Steuer der Rechnung nie angemeldet", async () => {
      await sql`update company set versteuerung = 'ist'`;
      await paidInvoice("2025-11-10", "05.12.25");
      const late = await draft("2025-12-30");
      await sql`update company set versteuerung = 'soll'`;
      await expect(invoices.finalizeInvoice(actor, late.id)).rejects.toThrow(
        /Das Jahr 2025 ist nach Ist-Versteuerung gebucht, eingestellt ist jetzt Soll-Versteuerung/,
      );
    }, 30_000);

    it("ohne Wechsel und in Jahren ohne Buchung gilt die aktuelle Einstellung, nichts wird abgelehnt", async () => {
      await paidInvoice("2025-11-10", "05.12.25");
      // Vorjahr, gleiche Versteuerung
      expect(await invoices.finalizeIssues((await draft("2025-12-30")).id)).toEqual([]);
      // Jahr ohne jede Buchung, auch nach einem Wechsel
      await sql`update company set versteuerung = 'ist'`;
      expect(await invoices.finalizeIssues((await draft("2024-12-30")).id)).toEqual([]);
    }, 30_000);

    it("als Kleinunternehmer spielt die Versteuerung keine Rolle", async () => {
      await paidInvoice("2025-11-10", "05.12.25");
      const late = await draft("2025-12-30");
      await sql`update company set versteuerung = 'ist', kleinunternehmer = true`;
      // Der Entwurf mit 19 % passt nicht zum Kleinunternehmer, eine Meldung zur Versteuerung gibt es aber nicht
      const issues = await invoices.finalizeIssues(late.id);
      expect(issues.some((issue) => issue.includes("Kleinunternehmer"))).toBe(true);
      expect(issues.some((issue) => issue.includes("Versteuerung"))).toBe(false);
    }, 30_000);
  });

  describe("Kontenrahmen", () => {
    it("Aufheben einer Vorjahres-Zuordnung nach dem Wechsel: abgelehnt statt im neuen Kontenrahmen mit alten Konten gebucht", async () => {
      const { allocationId } = await paidInvoice("2025-11-02", "15.12.25");
      const [payment] = await sql`select l.account, l.debit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_type = 'allocation' and l.debit > 0`;
      // SKR03: Bank 1200 an Forderungen 1400
      expect(payment!.account).toBe("1200");

      await sql`update company set kontenrahmen = 'SKR04'`;
      const before = await entryCount();
      expect(await failure(bank.reverseAllocation(actor, allocationId))).toMatch(
        /Das Jahr 2025 ist im Kontenrahmen SKR03 gebucht, eingestellt ist jetzt SKR04/,
      );
      // Nichts gebucht, die Zuordnung steht noch
      expect(await entryCount()).toBe(before);
      expect(await sql`select id from allocations where reverses_id = ${allocationId}`).toHaveLength(0);
      expect(await sql`select id from journal_entries where kontenrahmen = 'SKR04'`).toHaveLength(0);
    }, 30_000);

    it("eine rückdatierte Rechnung ins Vorjahr ebenso; im neuen Jahr wird im neuen Kontenrahmen gebucht", async () => {
      await paidInvoice("2025-11-02", "15.12.25");
      const late = await draft("2025-12-30");
      await sql`update company set kontenrahmen = 'SKR04'`;
      expect(await failure(invoices.finalizeInvoice(actor, late.id))).toMatch(/Das Jahr 2025 ist im Kontenrahmen SKR03 gebucht/);
      const [stored] = await sql`select status, number from invoices where id = ${late.id}`;
      expect(stored).toMatchObject({ status: "draft", number: null });

      await invoices.finalizeInvoice(actor, (await draft("2026-01-05")).id);
      const years = await sql`select extract(year from date)::int as year, kontenrahmen from journal_entries group by 1, 2 order by 1`;
      expect(years.map((r) => `${r.year} ${r.kontenrahmen}`)).toEqual(["2025 SKR03", "2026 SKR04"]);
    }, 30_000);

    it("ohne Wechsel lässt sich eine Vorjahres-Zuordnung weiter aufheben", async () => {
      const { allocationId } = await paidInvoice("2025-11-02", "15.12.25");
      await bank.reverseAllocation(actor, allocationId);
      expect(await sql`select id from allocations where reverses_id = ${allocationId}`).toHaveLength(1);
    }, 30_000);
  });
});
