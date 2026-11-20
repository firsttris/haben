import { createHash } from "node:crypto";
import { ACCOUNTS, invoicePosting } from "@haben/core";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/**
 * #853: Storno und Korrektur mindern bereits vereinnahmte Umsatzsteuer erst mit der Rückzahlung (§ 17 UStG, UStAE 17.1
 * Abs. 2 Satz 3, BFH V R 34/09), mit und ohne Leistungstag, bei Soll wie bei Ist. Das Kennzeichen setzt das
 * Festschreiben; vorher festgeschriebene Korrekturen behalten das bisherige Verfahren. Entscheidungen:
 * https://github.com/Speicherstadt/haben/pull/1228#issuecomment-6925771896, …#issuecomment-6940857265
 */
describe.skipIf(!testDatabaseUrl)("Minderung erst mit der Rückzahlung (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let contacts: typeof import("../stammdaten/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let accounting: typeof import("../buchhaltung/index.ts");
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let contactId: string;
  const actor = "rueckgewaehr-test";
  const iban = "DE89370400440532013000";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    bank = await import("../bank/index.ts");
    contacts = await import("../stammdaten/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    reports = await import("../auswertungen/index.ts");
    accounting = await import("../buchhaltung/index.ts");
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries,
      allocations, write_offs, bank_transactions, bank_imports, bank_accounts, cash_entries, invoice_settlements cascade`;
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

  type Line = { description: string; quantity: number; unit: string; unitPrice: number; taxRate: 0 | 700 | 1900 };
  const beratung = (unitPrice: number, taxRate: Line["taxRate"] = 1900): Line => ({
    description: "Beratung",
    quantity: 1000,
    unit: "Psch.",
    unitPrice,
    taxRate,
  });

  async function invoice(lines: Line[] = [beratung(100_000)], issueDate = "2026-05-05") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines,
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function correctionDraft(originalId: string, date: string, lines: Line[]) {
    const draft = await invoices.createCorrection(actor, originalId, date);
    await invoices.updateDraft(actor, draft.id, {
      contactId,
      issueDate: date,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 0,
      format: "zugferd",
      note: "",
      lines,
    });
    return draft;
  }

  async function correction(originalId: string, date: string, lines: Line[] = [beratung(-10_000)]) {
    return invoices.finalizeInvoice(actor, (await correctionDraft(originalId, date, lines)).id, kleinunternehmerStand);
  }

  /** Korrektur wie vor #853 festgeschrieben: normale Buchung, versiegelt, ohne Kennzeichen. */
  async function legacyCorrection(originalId: string, date: string) {
    const draft = await correctionDraft(originalId, date, [beratung(-10_000)]);
    await sql`alter table invoices disable trigger invoices_reduction_rule`;
    try {
      return await withActor(actor, async (tx) => {
        const books = await accounting.openBooks(tx);
        const totals = (await invoices.invoiceTotalsById([draft.id], tx)).get(draft.id)!;
        await accounting.post(tx, books, {
          date,
          description: "Alte Rechnungskorrektur",
          sourceType: "invoice",
          sourceId: draft.id,
          lines: invoicePosting(totals, books.kontenrahmen, books.versteuerung),
        });
        const pdf = Buffer.from("%PDF-1.7\nErfundene alte Korrektur\n%%EOF");
        const [saved] = await tx
          .update(database.schema.invoices)
          .set({
            status: "final",
            number: "ALT-K-001",
            lockedAt: new Date(),
            net: totals.net,
            tax: totals.tax,
            gross: totals.gross,
            pdf,
            pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          })
          .where(eq(database.schema.invoices.id, draft.id))
          .returning();
        return saved!;
      });
    } finally {
      await sql`alter table invoices enable trigger invoices_reduction_rule`;
    }
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

  async function figures(month: number, year = 2026) {
    const f = await vat.computeVatFigures({ year, month });
    expect.soft((await reports.vatAbgleich({ year, month })).zeilen.filter((row) => row.journal !== row.quelle)).toEqual([]);
    return { kz81: f.kz81, tax81: f.tax81, kz86: f.kz86, tax86: f.tax86 };
  }
  const kz = async (month: number, year = 2026) => {
    const { kz81, tax81 } = await figures(month, year);
    return { kz81, tax81 };
  };

  async function balance(account: string) {
    const rows = await accounting.saldenliste({ from: "2026-01-01", to: "2026-12-31" });
    return rows.find((row) => row.account === account)?.saldo ?? 0;
  }

  async function integrity() {
    expect((await reports.checkIntegrity("2027-01-01")).abgleich.abweichungen).toEqual([]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  }

  describe("Kennzeichen", () => {
    it("setzt es beim Festschreiben von Korrektur und Storno, auch beim Storno der Korrekturen, nie bei der Rechnung", async () => {
      const original = await invoice();
      expect(original.reductionRule).toBeNull();
      const k = await correction(original.id, "2026-06-10");
      expect(k.reductionRule).toBe("rueckgewaehr");
      await invoices.cancelInvoice(actor, original.id, "2026-06-20");
      const rows = await sql`select kind, reduction_rule from invoices where kind = 'storno' order by gross`;
      expect(rows.map((r) => [r.kind, r.reduction_rule])).toEqual([
        ["storno", "rueckgewaehr"],
        ["storno", "rueckgewaehr"],
      ]);
      await integrity();
    }, 30_000);

    it("lehnt eine ohne Kennzeichen festgeschriebene Korrektur und ein so eingefügtes Storno in der Datenbank ab", async () => {
      const original = await invoice();
      const draft = await correctionDraft(original.id, "2026-06-10", [beratung(-10_000)]);
      await expect(sql`update invoices set status = 'final', number = 'K-1', locked_at = now() where id = ${draft.id}`.then((r) => r)).rejects.toThrow(
        /Kennzeichen der Rückgewähr/,
      );
      await expect(
        sql`insert into invoices (kind, contact_id, issue_date, payment_term_days, corrects_id, status, number, locked_at)
          values ('storno', ${contactId}, '2026-06-10', 0, ${original.id}, 'final', 'S-1', now())`.then((r) => r),
      ).rejects.toThrow(/Kennzeichen der Rückgewähr/);
      await expect(sql`update invoices set reduction_rule = 'rueckgewaehr' where id = ${draft.id}`.then((r) => r)).resolves.toBeDefined();
      const rechnung = await invoices.createDraft(actor, {
        contactId,
        issueDate: "2026-06-10",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [beratung(10_000)],
      });
      await expect(sql`update invoices set reduction_rule = 'rueckgewaehr' where id = ${rechnung.id}`.then((r) => r)).rejects.toThrow(
        /invoices_reduction_rule/,
      );
    });

    it("lässt eine vorher festgeschriebene Korrektur ohne Kennzeichen unverändert und im bisherigen Verfahren", async () => {
      const original = await invoice();
      await pay(original.id, "2026-05-20", 119_000);
      const old = await legacyCorrection(original.id, "2026-06-10");
      expect(old.reductionRule).toBeNull();
      const stored = await sql`select * from invoices where id = ${old.id}`;
      expect(await kz(6)).toEqual({ kz81: -10_000, tax81: -1_900 });
      await pay(old.id, "2026-07-15", -11_900);
      expect(await kz(7)).toEqual({ kz81: 0, tax81: 0 });
      expect(await sql`select * from invoices where id = ${old.id}`).toEqual(stored);
      await integrity();
    }, 30_000);
  });

  // Rückabwicklung in Raten: UStAE 17.1 Abs. 8 Satz 5, je tatsächlich zurückgezahltem Anteil
  for (const { form, frame, mode } of [
    { form: "gmbh", frame: "SKR04", mode: "soll" },
    { form: "einzelunternehmen", frame: "SKR03", mode: "ist" },
  ] as const)
    it(`${form}, ${frame}, ${mode}: Storno einer bezahlten Rechnung ohne Leistungstag, Erstattung in zwei Raten`, async () => {
      await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${mode}`;
      const original = await invoice();
      await pay(original.id, "2026-05-20", 119_000);
      const storno = await invoices.cancelInvoice(actor, original.id, "2026-06-10");
      expect(await kz(5)).toEqual({ kz81: 100_000, tax81: 19_000 });
      expect(await kz(6)).toEqual({ kz81: 0, tax81: 0 });
      await pay(storno.id, "2026-07-15", -11_900);
      expect(await kz(7)).toEqual({ kz81: -10_000, tax81: -1_900 });
      await pay(storno.id, "2026-08-14", -107_100);
      expect(await kz(8)).toEqual({ kz81: -90_000, tax81: -17_100 });
      const accounts = ACCOUNTS[frame];
      expect(await balance(accounts.ust[1900])).toBe(0);
      expect(await balance(accounts.ustNichtFaellig[1900])).toBe(0);
      await integrity();
    }, 40_000);

  it("SKR03, Soll: Teilzahlung, Korrektur und Verrechnung hält nur die Überzahlung bis zur Rückzahlung", async () => {
    const original = await invoice();
    await pay(original.id, "2026-05-20", 110_000);
    const k = await correction(original.id, "2026-06-10");
    // 1.100 € vereinnahmt, Entgelt jetzt 1.071 €: 29 € Überzahlung (24,37 € + 4,63 €) bleiben bis zur Rückzahlung besteuert
    expect(await kz(6)).toEqual({ kz81: -7_563, tax81: -1_437 });
    await invoices.settleInvoices(actor, { invoiceId: original.id, counterInvoiceId: k.id, amount: 9_000, date: "2026-06-12", note: "Nachlass" });
    expect(await kz(6)).toEqual({ kz81: -7_563, tax81: -1_437 });
    await pay(k.id, "2026-07-15", -2_900);
    expect(await kz(7)).toEqual({ kz81: -2_437, tax81: -463 });
    expect(await balance(ACCOUNTS.SKR03.ust[1900])).toBe(-17_100);
    expect(await balance(ACCOUNTS.SKR03.ustNichtFaellig[1900])).toBe(0);
    await integrity();
  }, 40_000);

  it("SKR03, Soll: alte Korrektur ohne Kennzeichen neben einer neuen, Erstattungen einzeln zugeordnet", async () => {
    const original = await invoice();
    await pay(original.id, "2026-05-20", 119_000);
    const old = await legacyCorrection(original.id, "2026-06-10");
    const fresh = await correction(original.id, "2026-07-10");
    expect(await kz(6)).toEqual({ kz81: -10_000, tax81: -1_900 });
    expect(await kz(7)).toEqual({ kz81: 0, tax81: 0 });
    await pay(old.id, "2026-08-14", -11_900);
    expect(await kz(8)).toEqual({ kz81: 0, tax81: 0 });
    await pay(fresh.id, "2026-09-15", -11_900);
    expect(await kz(9)).toEqual({ kz81: -10_000, tax81: -1_900 });
    expect(await balance(ACCOUNTS.SKR03.ust[1900])).toBe(-15_200);
    await integrity();
  }, 40_000);

  // Die Verrechnung der alten Korrektur ist das einzige Ereignis im Folgejahr; auch dann gehört die Kette in dessen Plan.
  it("SKR03, Soll: Verrechnung einer alten Korrektur im Folgejahr gibt die Steuer der neuen bis zur Rückzahlung frei", async () => {
    const original = await invoice([beratung(100_000)], "2025-05-05");
    await pay(original.id, "2025-05-20", 107_100);
    const old = await legacyCorrection(original.id, "2025-06-10");
    await correction(original.id, "2025-07-10");
    // Der Anspruch aus der alten Korrektur ist offen: keine Überzahlung, die neue mindert sofort
    expect(await kz(7, 2025)).toEqual({ kz81: -10_000, tax81: -1_900 });
    await invoices.settleInvoices(actor, { invoiceId: original.id, counterInvoiceId: old.id, amount: 11_900, date: "2026-01-12", note: "Alte Korrektur" });
    // Verrechnet: 1.071 € vereinnahmt, Entgelt 952 €; die 119 € der neuen Korrektur bleiben bis zur Rückzahlung besteuert
    expect(await kz(1, 2026)).toEqual({ kz81: 10_000, tax81: 1_900 });
    // Die Quelle der Voranmeldung nennt die Verrechnung mit Bezug zur Ursprungsrechnung
    const { revenue } = await vat.computeVatFigures({ year: 2026, month: 1 });
    expect(revenue.map(({ date, invoiceId, base, tax }) => ({ date, invoiceId, base, tax }))).toEqual([
      { date: "2026-01-12", invoiceId: original.id, base: 10_000, tax: 1_900 },
    ]);
    await integrity();
  }, 40_000);

  describe("mehrere Steuersätze, Korrektur nur des 19-%-Teils", () => {
    const lines = [beratung(10_000), beratung(10_000, 700)];

    it("50 € von 226 € bezahlt: keine Überzahlung, die Minderung wirkt sofort", async () => {
      const original = await invoice(lines);
      await pay(original.id, "2026-05-20", 5_000);
      await correction(original.id, "2026-06-10");
      expect(await figures(6)).toEqual({ kz81: -10_000, tax81: -1_900, kz86: 0, tax86: 0 });
      await integrity();
    }, 30_000);

    it("bezahlt: hält genau die Steuer des korrigierten Satzes", async () => {
      const original = await invoice(lines);
      await pay(original.id, "2026-05-20", 22_600);
      const k = await correction(original.id, "2026-06-10");
      expect(await figures(6)).toEqual({ kz81: 0, tax81: 0, kz86: 0, tax86: 0 });
      await pay(k.id, "2026-07-15", -11_900);
      expect(await figures(7)).toEqual({ kz81: -10_000, tax81: -1_900, kz86: 0, tax86: 0 });
      await integrity();
    }, 30_000);
  });
});
