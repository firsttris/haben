import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/*
 * Eine Anmeldung, die nach dem Festschreiben gesendet oder vermerkt wurde, enthält die Rechnung nur, wenn
 * ihre Werte beim Senden aus den Buchungen berechnet wurden. Manuell überschriebene Werte (z. B. laut Protokoll aus
 * Mein ELSTER, wie Haben es beim Vermerk mit abweichender Kz 83 verlangt) enthalten sie nicht.
 */
describe.skipIf(!testDatabaseUrl)("Leistungsmonat-Hinweis gegen den Inhalt der Meldung (#988, Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/vat.ts");
  let vermerk: typeof import("../umsatzsteuer/vermerk.ts");
  let crypto: typeof import("../../crypto.ts");
  const actor = "leistungsmonat-meldung";
  const oktober = { year: 2026, month: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/vat.ts");
    vermerk = await import("../umsatzsteuer/vermerk.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate vat_return_filings, vat_frequencies, vat_return_submissions, vat_returns, elster_certificates,
      seals, audit_log, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03')`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  });

  async function rechnung(net: number, issueDate: string) {
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
      serviceFrom: "2026-10-01",
      serviceTo: "2026-10-31",
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  const liveClient = (): ElsterClient => {
    const fake = new EricGeprueftClient();
    return {
      validate: (xml) => fake.validate(xml),
      send: (...args) => fake.send(...args),
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  };

  it("Vermerk mit Werten laut Protokoll nach dem Festschreiben: Die abgegebene Anmeldung enthält die Rechnung nicht", async () => {
    // Abgegeben am 09.11. in Mein ELSTER mit 6.500 € (ohne die Rechnung), vermerkt erst nach dem Festschreiben
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 650_000, kz86: 0, kz66: 0, reason: "Werte laut Protokoll" });
    const final = await rechnung(100_000, "2026-11-05");
    await vermerk.vermerkeAbgabe(
      actor,
      draft.id,
      {
        filedOn: "2026-11-09",
        transferTicket: "et9k3m2x7q4w8z1a",
        kz83: draft.kz83,
        file: { bytes: new TextEncoder().encode("%PDF-1.4\n% Protokoll\n%%EOF\n"), filename: "p.pdf" },
      },
      "2026-11-09",
    );
    const [gesendet] = await sql`select kz81, source from vat_returns where status = 'sent'`;
    expect(gesendet).toMatchObject({ kz81: 650_000, source: "manuell" });
    expect(await invoices.leistungsmonatHinweisFuer(final)).toContain("10/2026");
  }, 30_000);

  it("über ERiC gesendete manuelle Anmeldung nach dem Festschreiben: enthält die Rechnung nicht", async () => {
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 650_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerbüro" });
    const final = await rechnung(100_000, "2026-11-05");
    expect((await vat.submitReturn(actor, draft.id, liveClient(), { kind: "send", pin: "1", herstellerId: "12345" })).ok).toBe(true);
    const [gesendet] = await sql`select kz81 from vat_returns where status = 'sent'`;
    expect(gesendet!.kz81).toBe(650_000);
    expect(await invoices.leistungsmonatHinweisFuer(final)).toContain("10/2026");
  }, 30_000);

  it("Gegenprobe: berechnete Anmeldung nach dem Festschreiben enthält die Rechnung, kein Hinweis", async () => {
    const draft = await vat.saveDraft(actor, oktober, { mode: "berechnet" });
    const final = await rechnung(100_000, "2026-11-05");
    expect((await vat.submitReturn(actor, draft.id, liveClient(), { kind: "send", pin: "1", herstellerId: "12345" })).ok).toBe(true);
    const [gesendet] = await sql`select kz81 from vat_returns where status = 'sent'`;
    expect(gesendet!.kz81).toBe(100_000);
    expect(await invoices.leistungsmonatHinweisFuer(final)).toBeNull();
  }, 30_000);
});
