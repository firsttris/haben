import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Stichjahr anzeigen und vorziehen (#542, docs/adr/journal-als-quelle.md, Entscheidung 1): nur ohne gesendete
 * Voranmeldung im laufenden Jahr und mit sauberem Abgleich; zurück geht es nicht.
 */
describe.skipIf(!testDatabaseUrl)("Stichjahr vorziehen (Postgres)", () => {
  let sql: postgres.Sql;
  let stichjahr: typeof import("./stichjahr.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    stichjahr = await import("./stichjahr.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", journalAb: number | null) {
    await sql`truncate vat_return_submissions, vat_returns, allocations, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'soll', ${kontenrahmen}, ${journalAb})`;
  }

  async function invoice(issueDate: string) {
    const contact = await contacts.createContact(actor, {
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
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`zieht das Stichjahr vor, wenn der Abgleich sauber ist; danach aus dem Journal, zurück nicht (${kontenrahmen})`, async () => {
      await reset(kontenrahmen, 2027);
      await invoice("2026-09-20");
      expect(await stichjahr.stichjahrStand(today)).toEqual({ stichjahr: 2027, jahr: 2026, vorziehbar: true, gruende: [] });
      expect((await figures.computeVatFigures({ year: 2026, month: 9 })).quelle).toBe("nebenbuecher");

      expect(await stichjahr.stichjahrVorziehen(actor, today)).toBe(2026);
      expect(await sql`select journal_ab from company`).toEqual([{ journal_ab: 2026 }]);
      expect((await figures.computeVatFigures({ year: 2026, month: 9 })).quelle).toBe("journal");
      // Im Änderungsprotokoll der Firmendaten, mit Akteur
      const [log] = await sql`select actor, new_value->>'journal_ab' as neu from audit_log where table_name = 'company' order by seq desc limit 1`;
      expect(log).toEqual({ actor, neu: "2026" });
      expect(await stichjahr.stichjahrStand(today)).toEqual({ stichjahr: 2026, jahr: 2026, vorziehbar: false, gruende: [] });
      await expect(stichjahr.stichjahrVorziehen(actor, today)).rejects.toThrow("schon ab 2026");
    }, 60_000);

    it(`nicht mit gesendeter Voranmeldung im laufenden Jahr (${kontenrahmen})`, async () => {
      await reset(kontenrahmen, 2027);
      await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 8, 'sent', 0, 0, 0, 0, now())`;
      const stand = await stichjahr.stichjahrStand(today);
      expect(stand.vorziehbar).toBe(false);
      expect(stand.gruende).toEqual(["Für 2026 ist schon eine Voranmeldung gesendet; sie kam aus den Nebenbüchern."]);
      await expect(stichjahr.stichjahrVorziehen(actor, today)).rejects.toThrow("Voranmeldung gesendet");
      expect(await sql`select journal_ab from company`).toEqual([{ journal_ab: 2027 }]);
    }, 60_000);

    it(`nicht, solange der Abgleich des Jahres eine Abweichung zeigt (${kontenrahmen})`, async () => {
      await reset(kontenrahmen, 2027);
      await invoice("2026-09-20");
      // An Haben vorbei: die Umsatzsteuer im Journal um 1 € gemindert
      const ust = kontenrahmen === "SKR03" ? "1776" : "3806";
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set credit = credit - 100 where account = ${ust}`;
      });
      const stand = await stichjahr.stichjahrStand(today);
      expect(stand.vorziehbar).toBe(false);
      expect(stand.gruende.join()).toMatch(/Der Abgleich 2026 zeigt (eine Abweichung|\d+ Abweichungen)/);
      await expect(stichjahr.stichjahrVorziehen(actor, today)).rejects.toThrow("Abgleich 2026");
      expect(await sql`select journal_ab from company`).toEqual([{ journal_ab: 2027 }]);
    }, 60_000);
  }

  it("ohne Stichjahr in der Zukunft gibt es nichts vorzuziehen", async () => {
    await reset("SKR03", null);
    await invoice("2025-03-01");
    expect(await stichjahr.stichjahrStand(today)).toEqual({ stichjahr: 2025, jahr: 2026, vorziehbar: false, gruende: [] });
    await expect(stichjahr.stichjahrVorziehen(actor, today)).rejects.toThrow("schon ab 2025");
  }, 60_000);
});
