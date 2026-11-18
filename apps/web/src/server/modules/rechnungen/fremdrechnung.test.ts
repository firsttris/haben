import { ACCOUNTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/**
 * Ausgangsrechnung aus einem Fremdsystem übernehmen (#660): fremde Nummer und Original-PDF bleiben, gebucht wird wie beim
 * Festschreiben einer eigenen Rechnung, der eigene Nummernkreis bleibt unberührt, Zahlung und Storno laufen wie sonst.
 * In SKR03 und SKR04, Ist und Soll.
 */
describe.skipIf(!testDatabaseUrl)("Fremde Ausgangsrechnung übernehmen (Postgres)", () => {
  let foreign: typeof import("./fremdrechnung.ts");
  let UmsatzgrenzeError: typeof import("./umsatzgrenze.ts").UmsatzgrenzeError;
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
    ({ UmsatzgrenzeError } = await import("./umsatzgrenze.ts"));
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
        const { id } = await foreign.adoptForeignInvoice(actor, input(contactId), pdf, kleinunternehmerStand);

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
        await expect(foreign.adoptForeignInvoice(actor, input(contactId), pdf, kleinunternehmerStand)).rejects.toThrow(/gibt es in Haben schon/);

        // Der eigene Nummernkreis ist unberührt: die erste eigene Rechnung bekommt die erste Nummer
        const draft = await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId,
          lines: [{ description: "Eigene Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
        });
        const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
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
    await expect(
      foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1900, net: 400_000, tax: 75_999 }] }), pdf, kleinunternehmerStand),
    ).rejects.toThrow(/centgenau/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId), new TextEncoder().encode("kein pdf"), kleinunternehmerStand)).rejects.toThrow(/PDF/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { dueDate: "2026-09-01" }), pdf, kleinunternehmerStand)).rejects.toThrow(/Fälligkeit/);
    await expect(
      foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1600, net: 1000, tax: 160 }] }), pdf, kleinunternehmerStand),
    ).rejects.toThrow(/Steuersätze/);
    const eu = await customer("FR", "");
    await expect(
      foreign.adoptForeignInvoice(actor, input(eu, { taxTreatment: "reverse_charge", taxes: [{ rate: 0, net: 100_000, tax: 0 }] }), pdf, kleinunternehmerStand),
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
      kleinunternehmerStand,
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
      kleinunternehmerStand,
    );
    const [row2] = await sql`select tax_treatment, exemption_reason from invoices where id = ${exempt.id}`;
    expect(row2).toMatchObject({ tax_treatment: "steuerfrei", exemption_reason: "Steuerfrei nach § 4 Nr. 14 UStG" });
    await expect(
      foreign.adoptForeignInvoice(
        actor,
        input(contactId, { number: "RE-2026-0045", taxTreatment: "steuerfrei", taxes: [{ rate: 0, net: 20_000, tax: 0 }] }),
        pdf,
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(/Vorschrift/);
  }, 30_000);
  /**
   * #1392: Der tatsächliche Leistungsort einer Auslandsleistung kommt wie im Rechnungseditor als strukturierte Angabe mit;
   * erst bestätigt nimmt der Gesamtumsatz nach § 19 Abs. 2 UStG den Umsatz aus (§ 3a UStG), ohne Angabe bleibt er ungeklärt.
   */
  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`${kontenrahmen}, ${versteuerung}: übernimmt den bestätigten Leistungsort einer Leistung ins Nicht-EU-Ausland für den Gesamtumsatz`, async () => {
      await company(kontenrahmen, versteuerung);
      const contactId = await customer("CH");
      const drittland = (number: string, taxDetails: unknown) =>
        input(contactId, { number, taxTreatment: "drittland", taxes: [{ rate: 0, net: 12_345, tax: 0 }], taxDetails });
      const place = { exemption: null, ancillary: null, foreignPlace: { country: "CH", noForeignVat: true }, assetDisposal: false };

      const confirmed = await foreign.adoptForeignInvoice(actor, drittland("RE-2026-0050", place), pdf, kleinunternehmerStand);
      const open = await foreign.adoptForeignInvoice(actor, drittland("RE-2026-0051", null), pdf, kleinunternehmerStand);
      const [row] = await sql`select tax_details from invoices where id = ${confirmed.id}`;
      expect(row!.tax_details).toEqual(place);
      await expect(
        foreign.adoptForeignInvoice(
          actor,
          drittland("RE-2026-0052", { ...place, foreignPlace: { country: "AT", noForeignVat: true } }),
          pdf,
          kleinunternehmerStand,
        ),
      ).rejects.toThrow(/Leistungsort passt nicht/);

      await cash.createCashInvoiceEntry(actor, { invoiceId: confirmed.id, date: "2026-10-02", amount: 12_345 }, today);
      await cash.createCashInvoiceEntry(actor, { invoiceId: open.id, date: "2026-10-03", amount: 12_345 }, today);
      const result = await auswertungen.gesamtumsatzForYear(2026);
      expect(result.items.map((i) => [i.occurredOn, i.decision])).toEqual(
        expect.arrayContaining([
          ["2026-10-02", "excluded"],
          ["2026-10-03", "unknown"],
        ]),
      );
    }, 30_000);

    it(`${kontenrahmen}, ${versteuerung}: Leistungsort EU nur mit bestätigtem Land im EU-Ausland, Reverse Charge mit Leistungsort`, async () => {
      await company(kontenrahmen, versteuerung);
      const contactId = await customer("AT", "ATU12345678");
      const eu = (number: string, taxTreatment: string, taxDetails: unknown) =>
        input(contactId, { number, taxTreatment, taxes: [{ rate: 0, net: 10_000, tax: 0 }], taxDetails });
      const at = { exemption: null, ancillary: null, foreignPlace: { country: "AT", noForeignVat: true }, assetDisposal: false };

      await expect(foreign.adoptForeignInvoice(actor, eu("RE-2026-0060", "eu_sonstige", null), pdf, kleinunternehmerStand)).rejects.toThrow(
        /sonstige EU-Leistung/,
      );
      await expect(
        foreign.adoptForeignInvoice(
          actor,
          eu("RE-2026-0061", "eu_sonstige", { ...at, foreignPlace: { country: "AT", noForeignVat: false } }),
          pdf,
          kleinunternehmerStand,
        ),
      ).rejects.toThrow(/sonstige EU-Leistung/);
      await expect(
        foreign.adoptForeignInvoice(
          actor,
          eu("RE-2026-0062", "reverse_charge", { ...at, foreignPlace: { country: "CH", noForeignVat: true } }),
          pdf,
          kleinunternehmerStand,
        ),
      ).rejects.toThrow(/Leistungsort passt nicht/);
      expect(await sql`select 1 from invoices`).toHaveLength(0);

      const sonstige = await foreign.adoptForeignInvoice(actor, eu("RE-2026-0063", "eu_sonstige", at), pdf, kleinunternehmerStand);
      const rc = await foreign.adoptForeignInvoice(actor, eu("RE-2026-0064", "reverse_charge", at), pdf, kleinunternehmerStand);
      const rows = await sql`select number, tax_treatment, tax_details from invoices order by number`;
      expect(rows).toEqual([
        { number: "RE-2026-0063", tax_treatment: "eu_sonstige", tax_details: at },
        { number: "RE-2026-0064", tax_treatment: "reverse_charge", tax_details: at },
      ]);

      await cash.createCashInvoiceEntry(actor, { invoiceId: sonstige.id, date: "2026-10-02", amount: 10_000 }, today);
      await cash.createCashInvoiceEntry(actor, { invoiceId: rc.id, date: "2026-10-03", amount: 10_000 }, today);
      const result = await auswertungen.gesamtumsatzForYear(2026);
      expect(result.items.map((i) => [i.occurredOn, i.decision])).toEqual(
        expect.arrayContaining([
          ["2026-10-02", "excluded"],
          ["2026-10-03", "excluded"],
        ]),
      );
    }, 30_000);
  }

  it("Kleinunternehmer: Leistung ins Nicht-EU-Ausland nur mit bestätigtem Leistungsort, dann nicht im Gesamtumsatz und ohne Umsatzgrenze", async () => {
    await company("SKR03", "ist");
    await sql`update company set kleinunternehmer = true where id = 1`;
    const contactId = await customer("CH");
    const place = { exemption: null, ancillary: null, foreignPlace: { country: "CH", noForeignVat: true }, assetDisposal: false };
    // 120.000 € über der Grenze: Ein nicht steuerbarer Umsatz zählt nicht zum Gesamtumsatz, also keine Rückfrage zur Umsatzgrenze
    const drittland = (number: string, taxDetails: unknown) =>
      input(contactId, { number, taxTreatment: "drittland", taxes: [{ rate: 0, net: 12_000_000, tax: 0 }], taxDetails });
    await expect(foreign.adoptForeignInvoice(actor, drittland("RE-2026-0070", null), pdf, kleinunternehmerStand)).rejects.toThrow(/Als Kleinunternehmer/);
    const { id } = await foreign.adoptForeignInvoice(actor, drittland("RE-2026-0071", place), pdf, kleinunternehmerStand);
    await cash.createCashInvoiceEntry(actor, { invoiceId: id, date: "2026-10-02", amount: 12_000_000 }, today);
    const result = await auswertungen.gesamtumsatzForYear(2026);
    expect(result.items.map((i) => [i.occurredOn, i.decision])).toEqual([["2026-10-02", "excluded"]]);
    expect(result.included).toBe(0);
  }, 30_000);

  it("liest Nummer, Datum, Steuer und Kunde aus der E-Rechnung und schlägt ohne PDF fehl", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
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
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(/PDF/);
    expect(await sql`select 1 from invoices`).toHaveLength(1);
  }, 30_000);
  it("lehnt ab, was beim Festschreiben einer eigenen Rechnung auch scheitert: negativer Betrag, Steuerzeichen in der Nummer, Zahlungsziel, Rundung je Satz", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await expect(
      foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1900, net: -10_000, tax: -1_900 }] }), pdf, kleinunternehmerStand),
    ).rejects.toThrow();
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { number: "A/../B" }), pdf, kleinunternehmerStand)).rejects.toThrow(/Rechnungsnummer/);
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { number: `A${String.fromCharCode(10)}B` }), pdf, kleinunternehmerStand)).rejects.toThrow(
      /Rechnungsnummer/,
    );
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { dueDate: "2030-01-01" }), pdf, kleinunternehmerStand)).rejects.toThrow(/365 Tage/);
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
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(/centgenau/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
  }, 30_000);

  it("prüft die Firmendaten, den Wechsel der Versteuerung im Jahr und die Umsatzgrenze der Kleinunternehmer", async () => {
    await company("SKR03", "ist");
    const contactId = await customer();
    await sql`update company set steuernummer = '', ust_id = '' where id = 1`;
    await expect(foreign.adoptForeignInvoice(actor, input(contactId), pdf, kleinunternehmerStand)).rejects.toThrow(/Firmendaten/);
    await sql`update company set steuernummer = '198/113/10010', ust_id = 'DE123456789' where id = 1`;

    // Ist-Jahr gebucht, dann auf Soll umgestellt: eine zweite Rechnung desselben Jahres würde die Steuer doppelt melden
    await foreign.adoptForeignInvoice(actor, input(contactId, { number: "A1", issueDate: "2025-09-25", dueDate: "2025-10-09" }), pdf, kleinunternehmerStand);
    await sql`update company set versteuerung = 'soll' where id = 1`;
    await expect(
      foreign.adoptForeignInvoice(actor, input(contactId, { number: "A2", issueDate: "2025-09-26", dueDate: "2025-10-10" }), pdf, kleinunternehmerStand),
    ).rejects.toThrow(/Ist-Versteuerung gebucht/);

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
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(UmsatzgrenzeError);
  }, 30_000);

  it("übernimmt eine Rechnung über der Umsatzgrenze erst mit der Bestätigung der gemeldeten Werte", async () => {
    await company("SKR03", "ist");
    const contactId = await customer();
    await sql`update company set kleinunternehmer = true where id = 1`;
    const year = new Date().getFullYear();
    const big = input(contactId, {
      number: "K2",
      issueDate: `${year}-01-10`,
      dueDate: `${year}-01-24`,
      taxTreatment: "kleinunternehmer",
      exemptionReason: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
      taxes: [{ rate: 0, net: 12_000_000, tax: 0 }],
    });
    const warning = await foreign.adoptForeignInvoice(actor, big, pdf, kleinunternehmerStand).catch((e: unknown) => e);
    expect(warning).toBeInstanceOf(UmsatzgrenzeError);
    const { umsatz, rechnung, grenze, vorjahresumsatz } = warning as InstanceType<typeof UmsatzgrenzeError>;
    expect(await sql`select 1 from invoices`).toHaveLength(0);
    // Abweichende Werte bestätigen nichts
    await expect(
      foreign.adoptForeignInvoice(actor, { ...big, bestaetigt: { umsatz, rechnung: rechnung + 1, grenze } }, pdf, kleinunternehmerStand),
    ).rejects.toThrow(UmsatzgrenzeError);
    await foreign.adoptForeignInvoice(
      actor,
      { ...big, bestaetigt: { umsatz, rechnung, grenze, ...(vorjahresumsatz === undefined ? {} : { vorjahresumsatz }) } },
      pdf,
      kleinunternehmerStand,
    );
    expect(await sql`select 1 from invoices where number = ${"K2"}`).toHaveLength(1);
  }, 30_000);

  it("bucht bei Soll im Monat der Leistung und nimmt keine E-Rechnung an, die zu den Angaben nicht passt", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await foreign.adoptForeignInvoice(actor, input(contactId, { serviceFrom: "2026-08-01", serviceTo: "2026-08-31" }), pdf, kleinunternehmerStand);
    expect(await vat.computeVatFigures({ year: 2026, month: 8 })).toMatchObject({ kz81: 400_000, tax81: 76_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 9 })).toMatchObject({ kz81: 0, tax81: 0 });

    // Das ZUGFeRD-PDF einer eigenen Rechnung trägt eine E-Rechnung mit anderer Nummer und anderen Beträgen
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    await expect(
      foreign.adoptForeignInvoiceFile(
        actor,
        input(contactId, { number: "FREMD-1" }),
        { bytes: own.pdf!, filename: "re.pdf", mimeType: "application/pdf" },
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(/passt nicht zu den Angaben/);
    expect(await sql`select 1 from invoices where number = 'FREMD-1'`).toHaveLength(0);
  }, 30_000);

  it("lehnt eine Rechnung über 0 € und einen Leistungszeitraum rückwärts mit Meldung ab", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await expect(foreign.adoptForeignInvoice(actor, input(contactId, { taxes: [{ rate: 1900, net: 0, tax: 0 }] }), pdf, kleinunternehmerStand)).rejects.toThrow(
      /größer als 0/,
    );
    await expect(
      foreign.adoptForeignInvoice(actor, input(contactId, { serviceFrom: "2026-09-30", serviceTo: "2026-09-01" }), pdf, kleinunternehmerStand),
    ).rejects.toThrow(/Leistungszeitraum/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
  }, 30_000);

  it("Soll: Die Steuer gehört in den Monat der Leistung, nicht in den des Rechnungsdatums", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    // Rechnung vom 2. Oktober für eine Leistung im September
    await foreign.adoptForeignInvoice(
      actor,
      input(contactId, { issueDate: "2026-10-02", dueDate: "2026-10-16", serviceFrom: "2026-09-10", serviceTo: "2026-09-30" }),
      pdf,
      kleinunternehmerStand,
    );
    expect(await vat.computeVatFigures({ year: 2026, month: 9 })).toMatchObject({ kz81: 400_000, tax81: 76_000 });
    expect(await vat.computeVatFigures({ year: 2026, month: 10 })).toMatchObject({ kz81: 0, tax81: 0 });
  }, 30_000);

  it("lehnt eine E-Rechnung als Gutschrift oder in Fremdwährung beim Übernehmen ab", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    const xml = own.xml!;
    const proposal = await foreign.foreignInvoiceProposal({ bytes: new TextEncoder().encode(xml), filename: "re.xml", mimeType: "application/xml" });
    const adopt = (text: string) =>
      foreign.adoptForeignInvoiceFile(
        actor,
        { ...proposal, contactId },
        { bytes: new TextEncoder().encode(text), filename: "re.xml", mimeType: "application/xml" },
        kleinunternehmerStand,
      );
    const credit = xml.replace("<ram:TypeCode>380</ram:TypeCode>", "<ram:TypeCode>381</ram:TypeCode>");
    expect(credit).not.toBe(xml);
    await expect(adopt(credit)).rejects.toThrow(/Gutschrift/);
    const usd = xml.replace("<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>", "<ram:InvoiceCurrencyCode>USD</ram:InvoiceCurrencyCode>");
    expect(usd).not.toBe(xml);
    await expect(adopt(usd)).rejects.toThrow(/USD/);
    expect(await sql`select 1 from invoices`).toHaveLength(1);
  }, 30_000);

  it("lehnt zwei Zeilen mit demselben Steuersatz mit klarer Meldung ab", async () => {
    await company("SKR03", "soll");
    const contactId = await customer();
    await expect(
      foreign.adoptForeignInvoice(
        actor,
        input(contactId, {
          taxes: [
            { rate: 1900, net: 100_000, tax: 19_000 },
            { rate: 1900, net: 50_000, tax: 9_500 },
          ],
        }),
        pdf,
        kleinunternehmerStand,
      ),
    ).rejects.toThrow(/nur einmal/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
  }, 30_000);
  it("fasst Zeilen desselben Satzes aus der E-Rechnung zusammen und nimmt die Datei dann an", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    // Die Steuer 19 % als zwei Aufschlüsselungen (50 € + 50 € netto): nach EN 16931 eigentlich eine, andere Systeme schreiben es so
    const block = [...own.xml!.matchAll(/<ram:ApplicableTradeTax>[\s\S]*?<\/ram:ApplicableTradeTax>/g)]
      .map((m) => m[0])
      .find((b) => b.includes("<ram:CalculatedAmount>"))!;
    const half = (net: string, tax: string) => block.replace(/(<ram:BasisAmount>)[^<]*/, `$1${net}`).replace(/(<ram:CalculatedAmount>)[^<]*/, `$1${tax}`);
    const split = own.xml!.replace(block, half("50.00", "9.50") + half("50.00", "9.50"));
    expect(split).not.toBe(own.xml);
    const file = { bytes: new TextEncoder().encode(split), filename: "re.xml", mimeType: "application/xml" };
    const proposal = await foreign.foreignInvoiceProposal(file);
    expect(proposal.taxes).toEqual([{ rate: 1900, net: 10_000, tax: 1_900 }]);
    // Die E-Rechnung passt zu den Angaben; abgelehnt wird erst, dass eine reine XML kein Original-PDF ist
    await expect(foreign.adoptForeignInvoiceFile(actor, { ...proposal, contactId }, file, kleinunternehmerStand)).rejects.toThrow(/PDF/);
  }, 30_000);

  it("schlägt für einen Kleinunternehmer nur die Behandlung nach § 19 vor", async () => {
    await company("SKR03", "ist");
    const contactId = await customer("DE", "DE811128135");
    const draft = await invoices.createDraft(actor, {
      ...(await invoices.newDraftDefaults("2026-09-26")),
      contactId,
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
    });
    const own = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    // Die Umstellung auf Kleinunternehmer geht nur ohne Buchungen im Jahr: Firma neu anlegen, die E-Rechnung bleibt
    await company("SKR03", "ist");
    await sql`update company set kleinunternehmer = true where id = 1`;
    const proposal = await foreign.foreignInvoiceProposal({ bytes: new TextEncoder().encode(own.xml!), filename: "re.xml", mimeType: "application/xml" });
    expect(proposal.taxTreatment).toBe("kleinunternehmer");
  }, 30_000);

  /*
   * Steuerkategorie der E-Rechnung gegen die gewählte Behandlung: Steuerfreie Umsätze nach § 4 Nr. 8 bis 29 UStG gehören in
   * Kz 48 der Voranmeldung (Anleitung zur Umsatzsteuer-Voranmeldung 2026, Zeile 21), regulär zu 0 % gebucht stehen sie in
   * keiner Kennzahl. Kategorie E (UNCL 5305, „Exempt from tax“) verträgt sich nur mit „steuerfrei“ oder „Kleinunternehmer“.
   */
  it("übernimmt eine steuerfreie E-Rechnung (Kategorie E) nicht als regulär zu 0 %, sondern nur als steuerfrei mit Kz 48", async () => {
    await company("SKR03", "soll");
    const own = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId: await customer(),
          taxTreatment: "steuerfrei",
          exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG",
          lines: [{ description: "Heilbehandlung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 0 }],
        })
      ).id,
      kleinunternehmerStand,
    );
    // Dieselbe Rechnung als Original aus dem Fremdsystem: eigene Bücher leer, das PDF trägt die E-Rechnung mit Kategorie E
    await company("SKR03", "soll");
    const contactId = await customer();
    const file = { bytes: new Uint8Array(own.pdf!), filename: "re.pdf", mimeType: "application/pdf" };
    const base = { number: own.number!, issueDate: "2026-09-26", dueDate: "2026-10-10", contactId, taxes: [{ rate: 0, net: 10_000, tax: 0 }] };
    await expect(foreign.adoptForeignInvoiceFile(actor, { ...base, taxTreatment: "regulaer" }, file, kleinunternehmerStand)).rejects.toThrow(/passt nicht/);
    expect(await sql`select 1 from invoices`).toHaveLength(0);
    await foreign.adoptForeignInvoiceFile(
      actor,
      { ...base, taxTreatment: "steuerfrei", exemptionReason: "Steuerfrei nach § 4 Nr. 14 UStG" },
      file,
      kleinunternehmerStand,
    );
    expect(await vat.computeVatFigures({ year: 2026, month: 9 })).toMatchObject({ kz48: 10_000 });
  }, 30_000);

  it("lehnt eine E-Rechnung mit steuerpflichtigen und steuerfreien Zeilen (S und E) ab, statt den steuerfreien Teil ohne Kennzahl zu buchen", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const own = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId,
          lines: [
            { description: "Gutachten", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 },
            { description: "Heilbehandlung", quantity: 1000, unit: "Psch.", unitPrice: 5_000, taxRate: 0 },
          ],
        })
      ).id,
      kleinunternehmerStand,
    );
    // So schreibt eine Praxissoftware Gutachten (19 %) und Heilbehandlung (§ 4 Nr. 14 UStG) auf eine Rechnung
    const xml = own.xml!.replace(/<ram:CategoryCode>Z<\/ram:CategoryCode>/g, "<ram:CategoryCode>E</ram:CategoryCode>");
    expect(xml).not.toBe(own.xml);
    const file = { bytes: new TextEncoder().encode(xml), filename: "re.xml", mimeType: "application/xml" };
    const proposal = await foreign.foreignInvoiceProposal(file);
    // Abgelehnt werden muss die Steuerkategorie, nicht erst die reine XML-Datei
    await expect(foreign.adoptForeignInvoiceFile(actor, { ...proposal, contactId, taxTreatment: "regulaer" }, file, kleinunternehmerStand)).rejects.toThrow(
      /passt nicht/,
    );
  }, 30_000);

  /*
   * Anzahlungsrechnung (UNTDID 1001 Code 386, „Prepayment invoice“): Bei Soll entsteht die Steuer erst mit der Vereinnahmung
   * (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG), als Rechnung gebucht stünde sie schon im Monat der Rechnung in Kz 81.
   */
  it("lehnt eine E-Rechnung als Anzahlungsrechnung (386) ab", async () => {
    await company("SKR03", "soll");
    const contactId = await customer("DE", "DE811128135");
    const own = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId,
          lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
        })
      ).id,
      kleinunternehmerStand,
    );
    const xml = own.xml!.replace("<ram:TypeCode>380</ram:TypeCode>", "<ram:TypeCode>386</ram:TypeCode>");
    expect(xml).not.toBe(own.xml);
    const file = { bytes: new TextEncoder().encode(xml), filename: "re.xml", mimeType: "application/xml" };
    const proposal = await foreign.foreignInvoiceProposal(file);
    expect(proposal.warnings.join(" ")).toMatch(/Anzahlung/);
    await expect(foreign.adoptForeignInvoiceFile(actor, { ...proposal, contactId }, file, kleinunternehmerStand)).rejects.toThrow(/Anzahlung/);
  }, 30_000);

  /*
   * § 19 UStG in der E-Rechnung: EN 16931 (UNCL 5305) sieht Kategorie E vor, manche Erzeuger schreiben O. Beides muss sich
   * als Kleinunternehmer übernehmen lassen; auf d1cc6cea ging das, die Prüfung der Kategorie darf es nicht verbauen.
   */
  it("übernimmt als Kleinunternehmer ein ZUGFeRD-PDF mit Kategorie O nach § 19", async () => {
    await company("SKR03", "ist");
    await sql`update company set kleinunternehmer = true where id = 1`;
    const own = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          ...(await invoices.newDraftDefaults("2026-09-26")),
          contactId: await customer(),
          taxTreatment: "kleinunternehmer",
          lines: [{ description: "Leistung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 0 }],
        })
      ).id,
      kleinunternehmerStand,
    );
    // Wie ein Fremdsystem: ein PDF mit eingebettetem factur-x.xml, das O statt E nennt
    const xml = own.xml!.replaceAll("<ram:CategoryCode>E</ram:CategoryCode>", "<ram:CategoryCode>O</ram:CategoryCode>");
    expect(xml).not.toBe(own.xml);
    const bytes = pdfWithXml(xml);
    await company("SKR03", "ist");
    await sql`update company set kleinunternehmer = true where id = 1`;
    const contactId = await customer();
    const file = { bytes, filename: "re.pdf", mimeType: "application/pdf" };
    const proposal = await foreign.foreignInvoiceProposal(file);
    expect(proposal).toMatchObject({ from: "zugferd", taxTreatment: "kleinunternehmer", taxes: [{ rate: 0, net: 10_000, tax: 0 }] });
    await foreign.adoptForeignInvoiceFile(actor, { ...proposal, contactId }, file, kleinunternehmerStand);
    expect(await sql`select tax_treatment from invoices`).toEqual([{ tax_treatment: "kleinunternehmer" }]);
  }, 30_000);
});

/** Kleinstes PDF mit eingebetteter Rechnungs-XML (unkomprimiert, mit Querverweistabelle) */
function pdfWithXml(xml: string): Uint8Array {
  const enc = new TextEncoder();
  const data = enc.encode(xml);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(factur-x.xml) 4 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    "<< /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /AFRelationship /Data /EF << /F 5 0 R >> >>",
  ];
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.7\n");
  objects.forEach((body, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  offsets.push(length);
  push(`5 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Length ${data.length} >>\nstream\n`);
  push(data);
  push("\nendstream\nendobj\n");
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
