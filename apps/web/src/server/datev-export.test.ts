import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

describe.skipIf(!testDatabaseUrl)("DATEV-Export (Postgres)", () => {
  let datev: typeof import("./datev-export.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let ledger: typeof import("./ledger.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    ledger = await import("./ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  it("exportiert das Journal mit Rechnungsnummern; Salden wie in der Saldenliste", async () => {
    await expect(datev.datevExport(2026)).rejects.toThrow(/Berater- und Mandantennummer/);
    await expect(datev.saveDatevNumbers(actor, { beraterNr: "12", mandantNr: "1" })).rejects.toThrow(/4 bis 7 Ziffern/);
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });

    const contact = await contacts.createContact(actor, {
      kundennummer: "", name: "Nordwerk GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
      email: "", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
    });
    const input = {
      contactId: contact.id, issueDate: "2026-09-01", serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd" as const, note: "",
      lines: [
        { description: "Beratung", quantity: 10_000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const },
        { description: "Fachbuch", quantity: 1000, unit: "Stk." as const, unitPrice: 5_000, taxRate: 700 as const },
      ],
    };
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);

    const { bytes, filename, bookings } = await datev.datevExport(2026, new Date(2026, 9, 4, 8, 0, 0));
    expect(filename).toBe("EXTF_Buchungsstapel_2026.csv");
    const stack = parseDatevBuchungsstapel(bytes);
    expect(stack.header).toMatchObject({ beraterNr: "29098", mandantNr: "55003", kontenrahmen: "SKR03", dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(stack.bookings).toHaveLength(bookings);
    expect(stack.bookings.every((b) => b.voucherField1 === invoice.number && b.side === "S")).toBe(true);
    // Erlöse 19 % und 7 % auf Automatikkonten mit BU 40, die Steuer auf Umsatzsteuer nicht fällig ohne Schlüssel
    expect(stack.bookings.map((b) => `${b.account}/${b.contraAccount}/${b.buKey}/${b.amount}`).sort()).toEqual(
      ["1400/8400/40/100000", "1400/1766//19000", "1400/8300/40/5000", "1400/1761//350"].sort(),
    );

    const saldo = new Map<string, number>();
    for (const b of stack.bookings) {
      saldo.set(b.account, (saldo.get(b.account) ?? 0) + b.amount);
      saldo.set(b.contraAccount, (saldo.get(b.contraAccount) ?? 0) - b.amount);
    }
    const liste = await ledger.saldenliste(ledger.ledgerRange(2026));
    expect(liste.length).toBeGreaterThan(0);
    for (const zeile of liste) expect(saldo.get(zeile.account) ?? 0, zeile.account).toBe(zeile.saldo);

    // Nach einem Wechsel des Kontenrahmens bleibt das Jahr im Rahmen seiner Buchungen exportierbar
    await sql`update company set kontenrahmen = 'SKR04'`;
    expect(parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes).header.kontenrahmen).toBe("SKR03");
    // Gemischte Rahmen in einem Jahr: klare Meldung statt eines falschen Stapels
    await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
    await expect(datev.datevExport(2026)).rejects.toThrow(/Buchungen in SKR03 und SKR04/);
  });
});
