import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * Vorgang gegen Buchung (#1116), Randfälle: Jede Buchung trägt den Kontenrahmen, mit dem sie entstand; eine Zahlung im
 * neuen Jahr bucht nach einem Wechsel zum Jahresbeginn im neuen Rahmen (docs/einrichtung.md, Kontenrahmen).
 */
describe.skipIf(!testDatabaseUrl)("Vorgang gegen Buchung, Randfälle (Postgres)", () => {
  let vorgang: typeof import("./abgleich-vorgang.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    vorgang = await import("./abgleich-vorgang.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate journal_umstellung, vat_return_submissions, vat_returns, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', ${kontenrahmen})`;
  }

  async function rechnung(issueDate: string) {
    const { id: contactId } = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  /** Zahlungseingang über einen echten Bankumsatz, zugeordnet zur Rechnung */
  async function zahlung(invoiceId: string, nummer: string, betrag: number, datum: string) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const d = `${tag}.${monat}.${jahr!.slice(2)}`;
    const csv =
      `"Girokonto";"DE12 1203 0000 1234 5678 90"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${d}";"${d}";"Gebucht";"Nordwerk";"Testfirma";"RE ${nummer}";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions where booking_date = ${datum} order by created_at desc limit 1`;
    await bank.allocate(actor, { kind: "invoice", transactionId: umsatz!.id as string, invoiceId, amount: betrag });
  }

  /** Wechsel zum Jahresbeginn, wie in den Einstellungen (die Sperre gilt dem laufenden Jahr, in dem hier nichts mehr gebucht wird) */
  async function wechsel(nach: "SKR03" | "SKR04") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update company set kontenrahmen = ${nach} where id = 1`;
    });
  }

  for (const [von, nach] of [
    ["SKR03", "SKR04"],
    ["SKR04", "SKR03"],
  ] as const)
    it(`Ist: Rechnung im Dezember, Zahlung nach dem Wechsel ${von} → ${nach} im Januar, keine nicht fällige Umsatzsteuer gemeldet`, async () => {
      await reset(von);
      const r = await rechnung("2026-12-10");
      await wechsel(nach);
      await zahlung(r.id, r.number!, 119_000, "2027-01-08");
      // Die Zahlung hat die Umsatzsteuer im neuen Rahmen fällig gestellt: über beide Rahmen ist nichts mehr „nicht fällig“
      const [rest] = await sql`select coalesce(sum(l.debit - l.credit), 0)::int as saldo from journal_lines l
        join journal_entries e on e.id = l.entry_id
        where (e.kontenrahmen = 'SKR03' and l.account in ('1766', '1761')) or (e.kontenrahmen = 'SKR04' and l.account in ('3816', '3811'))`;
      expect(rest!.saldo).toBe(0);
      expect(await vorgang.vorgangZeilen(2026)).toEqual([]);
      expect(await vorgang.vorgangZeilen(2027)).toEqual([]);
    }, 30_000);
});
