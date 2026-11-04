import { EricGeprueftClient } from "../../test-eric.ts";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const incoming = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Tristan Teufel",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/** Voranmeldungszeitraum vierteljährlich und befreit (§ 18 Abs. 2 UStG) */
describe.skipIf(!testDatabaseUrl)("Voranmeldungszeitraum (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let vat: typeof import("./vat.ts");
  let zeitraum: typeof import("./zeitraum.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const q3 = { year: 2026, month: 43 };

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    vat = await import("./vat.ts");
    zeitraum = await import("./zeitraum.ts");
    fristen = await import("../finanzamt/fristen.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setCompany(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await sql`truncate vat_frequencies, vat_return_submissions, vat_returns, elster_certificates, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
  }

  beforeEach(() => setCompany("soll", "SKR03"));

  async function invoice(net: number, issueDate: string) {
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
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(date: string, net: number, tax: number) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, net % 256, tax % 256, 2]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "b.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Hetzner Online GmbH",
      supplierUstId: "",
      invoiceNumber: `R${net}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
    });
    await documents.bookDocument(actor, id);
  }

  const months = [7, 8, 9].map((month) => ({ year: 2026, month }));

  /** Kennzahlen des Quartals = Summe der drei Monate, für Ist und Soll, SKR03 und SKR04 */
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Soll ${kontenrahmen}: Quartal aus den Rechnungen der drei Monate`, async () => {
      await setCompany("soll", kontenrahmen);
      await invoice(100_050, "2026-07-15");
      await invoice(200_070, "2026-08-31");
      await invoice(300_000, "2026-09-30");
      await invoice(999_900, "2026-10-01");
      await bookedDocument("2026-08-10", 10_000, 1_900);
      const quarter = await figures.computeVatFigures(q3);
      const single = await Promise.all(months.map((m) => figures.computeVatFigures(m)));
      expect(quarter.kz81).toBe(600_120);
      expect(quarter.kz81).toBe(single.reduce((s, m) => s + m.kz81, 0));
      expect(quarter.tax81).toBe(single.reduce((s, m) => s + m.tax81, 0));
      expect(quarter.kz66).toBe(1_900);
      expect(quarter.revenue).toHaveLength(3);
      // Abgeschnitten wird einmal für das Quartal: 6.001,20 € → 6.001 €
      const values = await vat.computedValues(q3);
      expect(values).toMatchObject({ kz81: 600_100, kz66: 1_900, kz83: 114_019 - 1_900 });
    }, 30_000);

    it(`Ist ${kontenrahmen}: Quartal nach Zahlungseingang`, async () => {
      await setCompany("ist", kontenrahmen);
      const inv = await invoice(100_000, "2026-06-20");
      await bank.importStatement(
        actor,
        {
          bytes: dkbCsv([incoming("30.06.26", `RE ${inv.number} Teil 1`, "100,00"), incoming("02.07.26", `RE ${inv.number} Teil 2`, "1.090,00")]),
          filename: "a.csv",
        },
        null,
      );
      const txs = await sql`select id, amount from bank_transactions order by booking_date`;
      for (const tx of txs) await bank.allocate(actor, { kind: "invoice", transactionId: tx.id, invoiceId: inv.id, amount: Number(tx.amount) });
      const q2 = await figures.computeVatFigures({ year: 2026, month: 42 });
      const quarter = await figures.computeVatFigures(q3);
      expect(q2.kz81 + q2.tax81).toBe(10_000);
      expect(quarter.kz81 + quarter.tax81).toBe(109_000);
      expect(quarter.revenue.every((r) => r.type === "payment" && r.date === "2026-07-02")).toBe(true);
    }, 30_000);
  }

  it("ohne Einstellung bleibt es monatlich; das Quartal lässt sich erst nach der Einstellung anmelden", async () => {
    await invoice(100_000, "2026-08-01");
    await expect(vat.saveDraft(actor, q3, { mode: "berechnet" })).rejects.toThrow("passt die Voranmeldung nicht zum eingestellten Zeitraum (monatlich)");
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" });
    const draft = await vat.saveDraft(actor, q3, { mode: "berechnet" });
    expect(draft).toMatchObject({ year: 2026, month: 43, kz81: 100_000 });
    await expect(vat.saveDraft(actor, { year: 2026, month: 8 }, { mode: "berechnet" })).rejects.toThrow("(vierteljährlich)");

    let xml = "";
    const spy = {
      validate: async (body: string) => {
        xml = body;
        return new EricGeprueftClient().validate(body);
      },
      send: new EricGeprueftClient().send,
      fetchPostfach: new EricGeprueftClient().fetchPostfach,
      fetchBelege: new EricGeprueftClient().fetchBelege,
    };
    const result = await vat.submitReturn(actor, draft.id, spy, { kind: "validate" });
    expect(result.ok).toBe(true);
    expect(xml).toContain("<Zeitraum>43</Zeitraum>");
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
    const test = await vat.submitReturn(actor, draft.id, new EricGeprueftClient(), { kind: "test", pin: "1234" });
    expect(test.ok).toBe(true);
  }, 30_000);

  it("befreit: keine Voranmeldung, keine Frist, kein fehlender Monat in der Jahreserklärung", async () => {
    await invoice(100_000, "2026-02-01");
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "keine" });
    await expect(vat.saveDraft(actor, { year: 2026, month: 2 }, { mode: "berechnet" })).rejects.toThrow("keine Voranmeldung eingestellt");
    const list = await fristen.listFristen("2026-11-04");
    expect(list.filter((f) => f.art === "ustva")).toEqual([]);
    expect((await annual.ustYear(2026)).missingMonths).toEqual([]);
  }, 30_000);

  it("Fristen: Quartale am 10. nach Quartalsende, im Jahr davor die Monate", async () => {
    await invoice(100_000, "2025-11-15");
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" });
    const ids = (await fristen.listFristen("2026-11-04")).filter((f) => f.art === "ustva").map((f) => `${f.id} ${f.datum}`);
    expect(ids).toEqual([
      "ustva-2025-11 2025-12-10",
      "ustva-2025-12 2026-01-12",
      "ustva-2026-Q1 2026-04-10",
      "ustva-2026-Q2 2026-07-10",
      "ustva-2026-Q3 2026-10-12",
      "ustva-2026-Q4 2027-01-11",
      // 2027 ohne eigene Einstellung: übernommen
      "ustva-2027-Q1 2027-04-12",
      "ustva-2027-Q2 2027-07-12",
      "ustva-2027-Q3 2027-10-11",
    ]);
    const q3Frist = (await fristen.listFristen("2026-11-04")).find((f) => f.id === "ustva-2026-Q3");
    expect(q3Frist).toMatchObject({ titel: "Umsatzsteuer-Voranmeldung 3. Quartal 2026", link: "/umsatzsteuer/2026-Q3" });
  }, 30_000);

  it("gesendete Voranmeldungen bleiben: kein Wechsel, zu dem sie nicht passen; Wechsel ab einem späteren Quartal geht", async () => {
    const sent = await vat.saveDraft(actor, { year: 2026, month: 2 }, { kz81: 100_000, kz86: 0, kz66: 0 });
    await sql`update vat_returns set status = 'sent', sent_at = now(), locked_at = now() where id = ${sent.id}`;
    const before = await sql`select * from vat_returns where id = ${sent.id}`;
    // Entwurf im Mai: gehört danach zum 2. Quartal, bleibt stehen, lässt sich aber nicht mehr senden
    const draft = await vat.saveDraft(actor, { year: 2026, month: 5 }, { kz81: 10_000, kz86: 0, kz66: 0 });

    await expect(zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "vierteljaehrlich" })).rejects.toThrow(
      "Für Februar 2026 ist schon eine Voranmeldung gesendet",
    );
    await expect(zeitraum.saveFrequency(actor, { year: 2025, fromMonth: 1, frequency: "keine" })).rejects.toThrow("Februar 2026");
    expect(await zeitraum.loadFrequencies()).toEqual([]);

    const { orphanedDrafts } = await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 4, frequency: "vierteljaehrlich" });
    expect(orphanedDrafts).toEqual(["Mai 2026"]);
    await expect(vat.submitReturn(actor, draft.id, new EricGeprueftClient(), { kind: "validate" })).rejects.toThrow("(vierteljährlich)");
    expect(await sql`select * from vat_returns where id = ${sent.id}`).toEqual(before);
    expect(await zeitraum.loadFrequencies()).toEqual([{ year: 2026, fromMonth: 4, frequency: "vierteljaehrlich" }]);

    // Berichtigen bleibt im Zeitraum der gesendeten Anmeldung möglich
    const correction = await vat.createCorrection(actor, { year: 2026, month: 2 });
    const check = await vat.submitReturn(actor, correction.id, new EricGeprueftClient(), { kind: "validate" });
    expect(check.ok).toBe(true);

    // Ab Januar ersetzt die Einstellungen des Jahres ab diesem Monat, monatlich passt wieder zum Februar
    await zeitraum.saveFrequency(actor, { year: 2026, fromMonth: 1, frequency: "monatlich" });
    expect(await zeitraum.loadFrequencies()).toEqual([{ year: 2026, fromMonth: 1, frequency: "monatlich" }]);
  }, 30_000);

  it("Änderungen stehen im Audit-Log", async () => {
    await zeitraum.saveFrequency(actor, { year: 2027, fromMonth: 1, frequency: "vierteljaehrlich" });
    const rows = await sql`select actor, action, new_value from audit_log where table_name = 'vat_frequencies' order by seq desc limit 1`;
    expect(rows.map((r) => r.action)).toEqual(["INSERT"]);
    expect(rows[0]?.new_value).toMatchObject({ year: 2027, from_month: 1, frequency: "vierteljaehrlich" });
    expect(rows[0]?.actor).toBe(actor);
  });

  it("Vorschlag aus der Steuer des Vorjahres", async () => {
    await invoice(5_000_000, "2025-03-01");
    await invoice(100_000, "2026-03-01");
    const overview = await zeitraum.frequencyOverview(2026);
    expect(overview.previousYearTax).toBe(950_000);
    expect(overview.suggestion?.frequency).toBe("monatlich");
    expect(overview).toMatchObject({ frequency: "monatlich", own: [], inherited: false });
  }, 30_000);
});
