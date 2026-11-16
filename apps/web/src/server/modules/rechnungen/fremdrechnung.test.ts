import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * Ausgangsrechnung aus einem Fremdsystem übernehmen (#660): fremde Nummer und Original-PDF bleiben, gebucht wird wie beim
 * Festschreiben einer eigenen Rechnung, der eigene Nummernkreis bleibt unberührt, Zahlung und Storno laufen wie sonst.
 * In SKR03 und SKR04, Ist und Soll.
 */
describe.skipIf(!testDatabaseUrl)("Fremde Ausgangsrechnung übernehmen (Postgres)", () => {
  let foreign: typeof import("./fremdrechnung.ts");
  let invoices: typeof import("./invoices.ts");
  let cash: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let auswertungen: typeof import("../auswertungen/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = "2026-10-06";
  const pdf = new TextEncoder().encode("%PDF-1.7\n% Original aus dem Fremdsystem\n");

  beforeAll(async () => {
    sql = await setupTestDb();
    foreign = await import("./fremdrechnung.ts");
    invoices = await import("./invoices.ts");
    cash = await import("../bank/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    vat = await import("../umsatzsteuer/index.ts");
    auswertungen = await import("../auswertungen/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, skonto)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 14, '[]'::jsonb)`;
  }

  async function customer(land = "DE", ustId = "") {
    const { id } = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Bäckerei Kranz",
      strasse: "Marktplatz 3",
      plz: "93047",
      ort: "Regensburg",
      land,
      email: "",
      ustId,
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    return id;
  }

  const input = (contactId: string, over: Record<string, unknown> = {}) => ({
    number: "RE-2026-0042",
    issueDate: "2026-09-25",
    dueDate: "2026-10-09",
    contactId,
    taxes: [{ rate: 1900, net: 400_000, tax: 76_000 }],
    ...over,
  });

  async function balances() {
    return Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    );
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const a = ACCOUNTS[kontenrahmen];

      it(`${kontenrahmen}, ${versteuerung}: Nummer und PDF bleiben, gebucht wie beim Festschreiben, Zahlung wie sonst`, async () => {
        await company(kontenrahmen, versteuerung);
        const contactId = await customer();
        const { id } = await foreign.adoptForeignInvoice(actor, input(contactId), pdf);

        const [row] =
          await sql`select status, number, number_year, number_counter, gross, external_source, external_id, pdf_sha256, locked_at from invoices where id = ${id}`;
        expect(row).toMatchObject({
          status: "final",
          number: "RE-2026-0042",
          number_year: null,
          number_counter: null,
          gross: 476_000,
          external_source: "fremdsystem",
          external_id: "RE-2026-0042",
        });
        expect(row!.locked_at).not.toBeNull();
        expect(row!.pdf_sha256).toBe((await import("node:crypto")).createHash("sha256").update(pdf).digest("hex"));

        // Gebucht zum Rechnungsdatum: Forderung an Erlöse und Umsatzsteuer, bei Ist auf „nicht fällig“
        expect(await balances()).toEqual({
          [a.forderungen]: 476_000,
          [a.erloese[1900]]: -400_000,
          [versteuerung === "ist" ? a.ustNichtFaellig[1900] : a.ust[1900]]: -76_000,
        });
        const september = await vat.computeVatFigures({ year: 2026, month: 9 });
        expect(september).toMatchObject(versteuerung === "ist" ? { kz81: 0, tax81: 0 } : { kz81: 400_000, tax81: 76_000 });

        // Dieselbe Rechnung kein zweites Mal, und die Nummer ist belegt
        await expect(foreign.adoptForeignInvoice(actor, input(contactId), pdf)).rejects.toThrow(/gibt es in Haben schon/);

        // Der eigene Nummernkreis ist unberührt: die erste eigene Rechnung bekommt die erste Nummer
        const draft = await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId,
          lines: [{ description: "Eigene Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
        });
        const own = await invoices.finalizeInvoice(actor, draft.id);
        expect(own.numberCounter).toBe(1);
        expect(own.number).not.toBe("RE-2026-0042");

        // Zahlung bar wie bei jeder Rechnung; bei Ist wird die Umsatzsteuer erst jetzt gemeldet
        await cash.createCashInvoiceEntry(actor, { invoiceId: id, date: "2026-10-02", amount: 476_000 }, today);
        expect((await invoices.listInvoices(today)).find((i) => i.id === id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
        expect((await auswertungen.openPositions(today)).receivables.some((r) => r.id === id)).toBe(false);
        const october = await vat.computeVatFigures({ year: 2026, month: 10 });
        expect(october).toMatchObject(versteuerung === "ist" ? { kz81: 400_000, tax81: 76_000 } : { kz81: 0, tax81: 0 });
      }, 30_000);
    }
  }

  it("lehnt ab, was nicht stimmt: Steuer nicht centgenau, kein PDF, Fälligkeit vor Rechnungsdatum, unbekannter Steuersatz, fehlende USt-IdNr.", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1900, net: 400_000, tax: 75_999 }] }), pdf)).rejects.toThrow(
      /centgenau/,
    );
    await expect(foreign.adoptForeignInvoice(actor, input(contactId), new TextEncoder().encode("kein pdf"))).rejects.toThrow(/PDF/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { dueDate: "2026-09-01" }), pdf)).rejects.toThrow(/Fälligkeit/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1600, net: 1000, tax: 160 }] }), pdf)).rejects.toThrow(/Steuersätze/);
    const eu = await customer("FR", "");
    await expect(
      foreign.adoptForeignInvoice(actor, input(eu, { taxTreatment: "reverse_charge", taxes: [{ rate: 0, net: 100_000, tax: 0 }] }), pdf),
    ).rejects.toThrow(/USt-IdNr/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
  }, 30_000);

  it("übernimmt mehrere Steuersätze und eine steuerfreie Rechnung in einer Rechnung je Beleg", async () => {
    await company("SKR04", "soll");
    const contactId = await customer();
    const mixed = await foreign.adoptForeignInvoice(
      actor,
      input(contactId, {
        number: "RE-2026-0043",
        taxes: [
          { rate: 1900, net: 100_000, tax: 19_000 },
          { rate: 700, net: 50_000, tax: 3_500 },
        ],
      }),
      pdf,
    );
    const [row] = await sql`select net, tax, gross from invoices where id = ${mixed.id}`;
    expect(row).toMatchObject({ net: 150_000, tax: 22_500, gross: 172_500 });
    const exempt = await foreign.adoptForeignInvoice(
      actor,
      input(contactId, {
        number: "RE-2026-0044",
        taxTreatment: "steuerfrei",
        exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG",
        taxes: [{ rate: 0, net: 20_000, tax: 0 }],
      }),
      pdf,
    );
    const [row2] = await sql`select tax_treatment, exemption_reason from invoices where id = ${exempt.id}`;
    expect(row2).toMatchObject({ tax_treatment: "steuerfrei", exemption_reason: "Steuerfrei nach § 4 Nr. 14 UStG" });
    await expect(
      foreign.adoptForeignInvoice(
        actor,
        input(contactId, { number: "RE-2026-0045", taxTreatment: "steuerfrei", taxes: [{ rate: 0, net: 20_000, tax: 0 }] }),
        pdf,
      ),
    ).rejects.toThrow(/Vorschrift/);
  }, 30_000);
  it("liest Nummer, Datum, Steuer und Kunde aus der E-Rechnung und schlägt ohne PDF fehl", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id);
    const xml = own.xml!;
    const proposal = await foreign.foreignInvoiceProposal({ bytes: new TextEncoder().encode(xml), filename: "re.xml", mimeType: "application/xml" });
    expect(proposal).toMatchObject({
      from: "xrechnung",
      number: own.number,
      issueDate: "2026-09-26",
      taxTreatment: "regulaer",
      taxes: [{ rate: 1900, net: 10_000, tax: 1_900 }],
      contactId,
      warnings: [],
    });
    // Ohne E-Rechnung bleibt der Vorschlag leer und sagt es
    const plain = await foreign.foreignInvoiceProposal({ bytes: pdf, filename: "re.pdf", mimeType: "application/pdf" });
    expect(plain).toMatchObject({ from: null, number: "", taxes: [], contactId: null });
    expect(plain.warnings).toHaveLength(1);
    // Eine reine XML ist kein Original-PDF: abgelehnt, es entsteht keine zweite Rechnung
    await expect(
      foreign.adoptForeignInvoiceFile(
        actor,
        { ...proposal, contactId },
        { bytes: new TextEncoder().encode(xml), filename: "re.xml", mimeType: "application/xml" },
      ),
    ).rejects.toThrow(/PDF/);
    expect(await sql`select 1 from invoices`).toHaveLength(1);
  }, 30_000);
  it("lehnt ab, was beim Festschreiben einer eigenen Rechnung auch scheitert: negativer Betrag, Steuerzeichen in der Nummer, Zahlungsziel, Rundung je Satz", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1900, net: -10_000, tax: -1_900 }] }), pdf)).rejects.toThrow();
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { number: "A/../B" }), pdf)).rejects.toThrow(/Rechnungsnummer/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { number: `A${String.fromCharCode(10)}B` }), pdf)).rejects.toThrow(/Rechnungsnummer/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { dueDate: "2030-01-01" }), pdf)).rejects.toThrow(/365 Tage/);
    // Summe stimmt (+1 Cent bei 19 %, −1 Cent bei 7 %), je Satz nicht: würde die Kennzahlen der Voranmeldung verschieben
    await expect(
      foreign.adoptForeignInvoice(
        actor,
        input(contactId, {
          taxes: [
            { rate: 1900, net: 1_000, tax: 191 },
            { rate: 700, net: 1_000, tax: 69 },
          ],
        }),
        pdf,
      ),
    ).rejects.toThrow(/centgenau/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
  }, 30_000);

  it("prüft die Firmendaten, den Wechsel der Versteuerung im Jahr und die Umsatzgrenze der Kleinunternehmer", async () => {
    await company("SKR03", "ist");
    const contactId = await customer();
    await sql`update company set steuernummer = '', ust_id = '' where id = 1`;
    await expect(foreign.adoptForeignInvoice(actor, input(contactId), pdf)).rejects.toThrow(/Firmendaten/);
    await sql`update company set steuernummer = '198/113/10010', ust_id = 'DE123456789' where id = 1`;

    // Ist-Jahr gebucht, dann auf Soll umgestellt: eine zweite Rechnung desselben Jahres würde die Steuer doppelt melden
    await foreign.adoptForeignInvoice(actor, input(contactId, { number: "A1", issueDate: "2025-09-25", dueDate: "2025-10-09" }), pdf);
    await sql`update company set versteuerung = 'soll' where id = 1`;
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { number: "A2", issueDate: "2025-09-26", dueDate: "2025-10-10" }), pdf)).rejects.toThrow(
      /Ist-Versteuerung gebucht/,
    );

    // Kleinunternehmer: Umsatzgrenze wie beim Festschreiben
    await sql`update company set kleinunternehmer = true, versteuerung = 'ist' where id = 1`;
    const year = new Date().getFullYear();
    await expect(
      foreign.adoptForeignInvoice(
        actor,
        input(contactId, {
          number: "K1",
          issueDate: `${year}-01-10`,
          dueDate: `${year}-01-24`,
          taxTreatment: "kleinunternehmer",
          exemptionReason: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
          taxes: [{ rate: 0, net: 12_000_000, tax: 0 }],
        }),
        pdf,
      ),
    ).rejects.toThrow();
  }, 30_000);

  it("bucht bei Soll im Monat der Leistung und nimmt keine E-Rechnung an, die zu den Angaben nicht passt", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await foreign.adoptForeignInvoice(actor, input(contactId, { serviceFrom: "2026-08-01", serviceTo: "2026-08-31" }), pdf);
    expect(await vat.computeVatFigures({ year: 2026, month: 8 })).toMatchObject({ kz81: 400_000, tax81: 76_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 9 })).toMatchObject({ kz81: 0, tax81: 0 });

    // Das ZUGFeRD-PDF einer eigenen Rechnung trägt eine E-Rechnung mit anderer Nummer und anderen Beträgen
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id);
    await expect(
      foreign.adoptForeignInvoiceFile(actor, input(contactId, { number: "FREMD-1" }), { bytes: own.pdf!, filename: "re.pdf", mimeType: "application/pdf" }),
    ).rejects.toThrow(/passt nicht zu den Angaben/);
    expect(await sql`select 1 from invoices where number = 'FREMD-1'`).toHaveLength(0);
  }, 30_000);
});
