import { ACCOUNTS } from "@haben/core";
import { datevSalden, parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/**
 * #853: Ausgabe derselben normalen Vorauszahlung, keine vorbereiteten Journal-/Anmeldungszeilen.
 * § 13 Abs. 1 Nr. 1 a Satz 4/b UStG; § 252 Abs. 1 Nr. 4/5 und § 266 Abs. 3 C.3 HGB.
 * DATEV SKR03/04 2026: 1710/3250 ohne AM, 8400/4400 mit AM; separate Steuer erfordert dort BU 40.
 * E-Bilanz: BMF vom 10.06.2025, Taxonomie 6.9 und unverdichtete Kontennachweise (§ 5b EStG).
 * https://www.gesetze-im-internet.de/ustg_1980/__13.html
 * https://www.gesetze-im-internet.de/hgb/__266.html
 * https://developer.datev.de/de/file-formats/details/datev-format/format-description/booking-batch
 * https://apps.datev.de/help-center/documents/0904313 (BU 40, einschließlich unterbundener Ist-Steuerumbuchung)
 * https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2025-06-10-ebilanz-taxonomien-6-9.html
 */
describe.skipIf(!testDatabaseUrl)("Normale Vorauszahlung: Ausgaben und vorhandene UStVA (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let accounting: typeof import("../buchhaltung/index.ts");
  let ebilanz: typeof import("./ebilanz.ts");
  let contactId: string;
  const actor = "normale-vorauszahlung-ausgabe-test";
  const december = { year: 2025, month: 12 };
  const advancePosition = "bs.eqLiab.liab.advPaym";
  const vatPosition = "bs.eqLiab.liab.other.theroffTax.vat";
  const revenuePosition = "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
    accounting = await import("../buchhaltung/index.ts");
    ebilanz = await import("./ebilanz.ts");
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries, annual_submissions,
      vat_return_filings, vat_return_submissions, vat_returns cascade`;
    await sql`insert into company (id, name, rechtsform, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban,
      kontenrahmen, versteuerung)
      values (1, 'Test GmbH', 'gmbh', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1',
      '198/113/10010', 'BY', 'DE89370400440532013000', 'SKR03', 'soll')`;
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

  async function invoice() {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-01-20",
      serviceFrom: "2026-01-20",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Vereinbarte Softwareeinrichtung", quantity: 1000, unit: "Psch.", unitPrice: 70_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }
  const pay = (id: string) => bank.createCashInvoiceEntry(actor, { invoiceId: id, date: "2025-12-13", amount: 83_300 }, "2026-02-10");

  for (const [frame, mode, form] of [
    ["SKR03", "soll", "gmbh"],
    ["SKR04", "ist", "ug"],
  ] as const) {
    it(`${frame}/${mode}: Dezemberanzahlung und USt getrennt in E-Bilanz/XML; Januarerlös mit DATEV-Automatikaufhebung`, async () => {
      await sql`update company set kontenrahmen = ${frame}, versteuerung = ${mode}, rechtsform = ${form}`;
      const original = await invoice();
      await pay(original.id);
      const accounts = ACCOUNTS[frame];
      const company = await contacts.loadCompany();
      for (const year of [2025, 2026]) {
        const { daten, issues } = await ebilanz.ebilanzDaten(year, company);
        expect(issues).toEqual([]);
        expect(daten.werte[advancePosition] ?? 0).toBe(year === 2025 ? 70_000 : 0);
        expect(daten.werte[vatPosition]).toBe(13_300);
        expect(daten.werte[revenuePosition] ?? 0).toBe(year === 2025 ? 0 : 70_000);
        expect(daten.konten).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              account: year === 2025 ? accounts.erhalteneAnzahlungen : accounts.erloese[1900],
              position: year === 2025 ? advancePosition : revenuePosition,
              betrag: 70_000,
            }),
            expect.objectContaining({ account: accounts.ust[1900], position: vatPosition, betrag: 13_300 }),
          ]),
        );
        const balance = await accounting.jahresabschluss(year, "2027-02-10");
        expect(balance.kapitalgesellschaft && balance.report.bilanz["passiva.C"]).toBe(year === 2025 ? 83_300 : 13_300);
        expect(balance.kapitalgesellschaft && balance.report.guv.umsatzerloese).toBe(year === 2025 ? 0 : 70_000);
        // Nur lokaler Validierungsweg, keine simulierte oder echte Übermittlung als "send".
        expect((await ebilanz.submitEbilanz(actor, year, new EricGeprueftClient(), { kind: "validate", today: "2027-02-10" })).ok).toBe(true);
        const [submission] = await sql`select request_xml from annual_submissions where year = ${year} and form = 'ebilanz'`;
        const position = year === 2025 ? advancePosition : revenuePosition;
        const context = year === 2025 ? "I-AKTJAHR" : "D-AKTJAHR";
        expect(submission!.request_xml).toContain(`<de-gaap-ci:${position} contextRef="${context}" unitRef="EUR" decimals="2">700.00<`);
        expect(submission!.request_xml).toContain(`<de-gaap-ci:${vatPosition} contextRef="I-AKTJAHR" unitRef="EUR" decimals="2">133.00<`);
      }

      await reports.saveDatevNumbers(actor, { beraterNr: "12345", mandantNr: "123" });
      for (const year of [2025, 2026]) {
        const { bytes, warnings } = await reports.datevExport(year);
        expect(warnings).toEqual([]);
        const stack = parseDatevBuchungsstapel(bytes);
        expect(stack.warnings).toEqual([]);
        expect(stack.bookings.length).toBeGreaterThan(0);
        for (const row of stack.bookings) {
          const revenue = [row.account, row.contraAccount].includes(accounts.erloese[1900]);
          expect(row.buKey).toBe(revenue ? "40" : "");
          expect([row.account, row.contraAccount]).not.toEqual(expect.arrayContaining([frame === "SKR03" ? "1718" : "3272"]));
        }
        // Die steuerbewusste Rücklesung führt AM/BU aus. Ohne BU 40 würde sie im Januar nochmals USt herausrechnen.
        const salden = Object.fromEntries(datevSalden(stack.bookings, frame).map(({ account, saldo }) => [account, saldo]));
        expect(salden).toEqual(
          year === 2025
            ? { [accounts.kasse]: 83_300, [accounts.erhalteneAnzahlungen]: -70_000, [accounts.ust[1900]]: -13_300 }
            : { [accounts.erhalteneAnzahlungen]: 70_000, [accounts.erloese[1900]]: -70_000 },
        );
      }
      expect((await vat.computeVatFigures(december)).tax81).toBe(13_300);
      expect((await vat.computeVatFigures({ year: 2026, month: 1 })).tax81).toBe(0);
      expect((await reports.checkIntegrity("2027-02-10")).abgleich.abweichungen).toEqual([]);
    }, 15_000);
  }

  it("nachträgliche Dezemberzahlung erhält abgegebene Nullmeldung, Protokolldatei und Siegel; Berichtigung bleibt ein neuer Datensatz", async () => {
    const draft = await vat.saveDraft(actor, december, { mode: "berechnet" });
    // Synthetisches Protokollfixture wie in offener-posten.test.ts, über den echten Abgabevermerk persistiert.
    // Kein umdeklarierter Fake-Client, kein direkt gesetztes sent-Flag und kein Schreiben von Siegeln/Snapshots.
    const protocol = new TextEncoder().encode("%PDF-1.4\n% Synthetisches UStVA-Protokoll Dezember 2025, Kz83 0\n%%EOF\n");
    const sent = await vat.vermerkeAbgabe(
      actor,
      draft.id,
      {
        filedOn: "2026-01-10",
        transferTicket: "et853DEZEMBER2025",
        kz83: 0,
        file: { bytes: protocol, filename: "UStVA-2025-12-Protokoll.pdf" },
      },
      "2026-01-10",
    );
    expect(sent).toMatchObject({ status: "sent", kz81: 0, kz83: 0, computed: expect.objectContaining({ kz81: 0, kz83: 0 }) });
    const [filing] = await vat.filingsFor([sent.id]);
    const original = await invoice();
    const oldUpload = (await vat.meinElsterUpload(sent.id)).bytes;
    const originalFiles = await sql`select pdf, pdf_sha256, xml, xml_sha256 from invoices where id = ${original.id}`;
    const frozen = await sql`select to_jsonb(v)::text as snapshot from vat_returns v where id = ${sent.id}`;
    const frozenFiling = await sql`select to_jsonb(f)::text as snapshot from vat_return_filings f where id = ${filing!.id}`;
    const seals =
      await sql`select table_name, row_id, digest, columns from seals where row_id in ${sql([sent.id, filing!.id, original.id])} order by table_name, row_id`;
    // Vermerke sind append-only und über Audit-Kette/Datei-SHA geschützt; die Anmeldung und Rechnung tragen Siegel.
    expect(seals.map((row) => row.table_name)).toEqual(["invoices", "vat_returns"]);

    await pay(original.id);

    expect(await sql`select to_jsonb(v)::text as snapshot from vat_returns v where id = ${sent.id}`).toEqual(frozen);
    expect(await sql`select to_jsonb(f)::text as snapshot from vat_return_filings f where id = ${filing!.id}`).toEqual(frozenFiling);
    expect(
      await sql`select table_name, row_id, digest, columns from seals where row_id in ${sql([sent.id, filing!.id, original.id])} order by table_name, row_id`,
    ).toEqual(seals);
    expect((await vat.loadFilingProtocol(filing!.id))?.pdf).toEqual(protocol);
    expect((await vat.meinElsterUpload(sent.id)).bytes).toEqual(oldUpload);
    expect(await sql`select pdf, pdf_sha256, xml, xml_sha256 from invoices where id = ${original.id}`).toEqual(originalFiles);
    await expect(sql`update vat_return_filings set filename = 'nachträglich.pdf' where id = ${filing!.id}`).rejects.toThrow(/nur ergänzt/);
    expect(await vat.computedValues(december)).toMatchObject({ kz81: 70_000, kz83: 13_300 });
    expect((await vat.returnsForPeriod(december))[0]).toMatchObject({ id: sent.id, status: "sent", kz81: 0, kz83: 0 });
    await expect(vat.saveDraft(actor, december, { mode: "berechnet" })).rejects.toThrow(/berichtigte Anmeldung/);
    const correction = await vat.createCorrection(actor, december);
    expect(correction).toMatchObject({ berichtigt: true, correctsId: sent.id, kz81: 0, kz83: 0 });
    const updated = await vat.saveDraft(actor, december, { mode: "berechnet" });
    expect(updated).toMatchObject({ id: correction.id, berichtigt: true, correctsId: sent.id, kz81: 70_000, kz83: 13_300 });
    const xml = new TextDecoder().decode((await vat.meinElsterUpload(updated.id)).bytes);
    expect(xml).toContain("<Kz10>1</Kz10>");
    expect(xml).toContain("<Kz81>700</Kz81>");
    expect(await sql`select to_jsonb(v)::text as snapshot from vat_returns v where id = ${sent.id}`).toEqual(frozen);
    expect((await vat.loadFilingProtocol(filing!.id))?.pdf).toEqual(protocol);
    expect((await vat.meinElsterUpload(sent.id)).bytes).toEqual(oldUpload);
    expect(
      await sql`select table_name, row_id, digest, columns from seals where row_id in ${sql([sent.id, filing!.id, original.id])} order by table_name, row_id`,
    ).toEqual(seals);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
