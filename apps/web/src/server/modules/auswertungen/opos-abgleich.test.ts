import { ACCOUNTS, type Kontenrahmen } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const FORDERUNGEN = "Bilanzierte Forderungen aus neuen Anzahlungs-/Schlussketten";
const ANZAHLUNGEN = "Erhaltene Anzahlungen netto, neues Verfahren";

/** #750: Nebenbuch und Journal unabhängig lesen; die erwartete unbilanzierte Anforderung ist keine Abweichung. */
describe.skipIf(!testDatabaseUrl)("OPOS-Gegenprobe des neuen Anzahlungsverfahrens (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/index.ts");
  let bank: typeof import("../bank/index.ts");
  let bookkeeping: typeof import("../buchhaltung/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let abgleich: typeof import("./abgleich.ts");
  let oposAbgleich: typeof import("./opos-abgleich.ts")["oposAbgleich"];
  let contactId: string;
  const actor = "opos-abgleich-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/index.ts");
    bank = await import("../bank/index.ts");
    bookkeeping = await import("../buchhaltung/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
    abgleich = await import("./abgleich.ts");
    ({ oposAbgleich } = await import("./opos-abgleich.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,bundesland,iban,kontenrahmen,versteuerung,rechtsform,journal_ab)
      values (1,'Muster GmbH','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010','BY',
        'DE89370400440532013000','SKR03','soll','gmbh',2025)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Musterkunde GmbH",
        strasse: "Musterweg 7",
        plz: "12345",
        ort: "Musterstadt",
        land: "DE",
        email: "kunde@example.org",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function advance() {
    return invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2025-12-01",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          variant: "abschlag",
          advanceType: "anzahlung",
          lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
        })
      ).id,
    );
  }
  async function finalInvoice(advanceId: string, issueDate = "2026-01-20") {
    return invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate,
          serviceFrom: "2026-01-20",
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          variant: "schluss",
          deducts: [advanceId],
          lines: [{ description: "Gesamtleistung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
        })
      ).id,
    );
  }
  async function bankPayment(invoiceId: string, date: string, amount: number) {
    const dateDkb = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
    const text = `Zahlung ${invoiceId}`;
    const csv =
      `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      [
        dateDkb,
        dateDkb,
        "Gebucht",
        "Musterkunde",
        "Muster GmbH",
        text,
        "Eingang",
        "DE02100100100006820101",
        (amount / 100).toFixed(2).replace(".", ","),
        "",
        "",
        "",
      ]
        .map((v) => `"${v}"`)
        .join(";");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "zahlung.csv" }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose=${text}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount });
  }
  function expected(cutoff: string, receivables: number, advances: number) {
    return [
      { bereich: "opos", zeitraum: cutoff, posten: FORDERUNGEN, journal: receivables, quelle: receivables },
      { bereich: "opos", zeitraum: cutoff, posten: ANZAHLUNGEN, journal: advances, quelle: advances },
    ];
  }
  async function extraJournal(frame: Kontenrahmen, invoiceId: string | null, date: string, amount: number) {
    await withActor(actor, async (tx) =>
      bookkeeping.post(tx, await bookkeeping.openBooks(tx), {
        date,
        description: "Neutrale Testbeschreibung ohne Rechnungsnummer",
        sourceType: invoiceId ? "invoice" : "manuell",
        sourceId: invoiceId ?? crypto.randomUUID(),
        lines: [
          { account: ACCOUNTS[frame].forderungen, debit: amount, credit: 0, taxCode: null },
          { account: "9000", debit: 0, credit: amount, taxCode: null },
        ],
      }),
    );
  }

  it("zeigt die unbilanzierte Anforderung als Hinweis und erfasst ihr Jahr auch ohne Journal", async () => {
    await advance();
    expect(await sql`select id from journal_entries`).toEqual([]);
    const result = await oposAbgleich("2025-12-31");
    expect(result.zeilen).toEqual(expected("2025-12-31", 0, 0));
    expect(result.hinweise).toEqual([expect.stringMatching(/2025-12-31.*[Uu]nbilanzierte Anzahlungsanforderungen.*357,00/)]);
    expect(abgleich.abweichungen(result.zeilen)).toEqual([]);
    const all = await abgleich.abgleichAll("2026-02-15");
    expect(all.zeilen.filter((z) => z.bereich === "opos")).toEqual(expect.arrayContaining([...expected("2025-12-31", 0, 0), ...expected("2026-02-15", 0, 0)]));
    expect(all.hinweise).toEqual(expect.arrayContaining(result.hinweise));
  });

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "ist"],
  ] as const)("%s/%s: Forderungsbestand über Jahreswechsel, Papierstorno und Ersatz statt bloßer Jahresbewegung", async (frame, mode) => {
    await sql`update company set kontenrahmen=${frame}, versteuerung=${mode}`;
    const a = await advance();
    await bank.createCashInvoiceEntry(actor, { invoiceId: a.id, date: "2025-12-12", amount: 11_900 }, "2026-04-20");
    const f = await finalInvoice(a.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: f.id, date: "2026-01-25", amount: 10_000 }, "2026-04-20");
    await invoices.cancelInvoice(actor, f.id, "2026-02-12");
    const r = await finalInvoice(a.id, "2026-03-12");
    await bank.createCashInvoiceEntry(actor, { invoiceId: r.id, date: "2026-04-20", amount: 73_300 }, "2026-04-20");
    const stands = await Promise.all(["2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"].map((day) => oposAbgleich(day)));
    expect(stands.map((s) => s.zeilen)).toEqual([
      expected("2025-12-31", 0, 10_000),
      expected("2026-01-31", 97_100, 0),
      expected("2026-02-28", 97_100, 0),
      expected("2026-03-31", 97_100, 0),
      expected("2026-04-30", 23_800, 0),
    ]);
    expect(stands[0]!.hinweise).toEqual([expect.stringMatching(/[Uu]nbilanzierte Anzahlungsanforderungen.*238,00/)]);
    expect(stands[2]!.hinweise).toEqual([expect.stringMatching(/[Rr]ealisierter Schlussrest ohne aktuellen Schlussbeleg.*733,00/)]);
    expect(stands[3]!.hinweise).toEqual([]);
  });

  it("verknüpft Bank, Kasse und datierte Ausbuchungsgegenzeile über IDs und lässt Alt-/Sachbuchungen außerhalb", async () => {
    const a = await advance();
    await bankPayment(a.id, "2025-12-12", 35_700);
    const f = await finalInvoice(a.id);
    await bank.createCashInvoiceEntry(actor, { invoiceId: f.id, date: "2026-01-25", amount: 10_000 }, "2026-04-20");
    await bank.writeOff(actor, { kind: "skonto", invoiceId: f.id, date: "2026-02-05", amount: 1_190 });
    const [writtenOff] = await sql`select id from write_offs where invoice_id=${f.id}`;
    await bank.reverseWriteOff(actor, writtenOff!.id, "2026-03-05");
    await extraJournal("SKR03", null, "2025-12-20", 9_999);
    const old = await invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2026-01-02",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          lines: [{ description: "Normale Kontrollrechnung", quantity: 1000, unit: "Psch.", unitPrice: 10_000, taxRate: 1900 }],
        })
      ).id,
    );
    expect(old.advanceAccounting).toBeNull();
    expect((await oposAbgleich("2025-12-31")).zeilen).toEqual(expected("2025-12-31", 0, 30_000));
    expect((await oposAbgleich("2026-02-28")).zeilen).toEqual(expected("2026-02-28", 72_110, 0));
    expect((await oposAbgleich("2026-03-31")).zeilen).toEqual(expected("2026-03-31", 73_300, 0));
    // Eine eigene zusätzliche Buchung im verglichenen Umfang ist ein echter Widerspruch, ohne Siegel abzuschalten.
    await extraJournal("SKR03", f.id, "2026-03-20", 1);
    expect(abgleich.abweichungen((await oposAbgleich("2026-03-31")).zeilen)).toEqual([
      { bereich: "opos", zeitraum: "2026-03-31", posten: FORDERUNGEN, journal: 73_301, quelle: 73_300 },
    ]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("begrenzt OPOS auf historische Monatsenden und den heutigen Tag, ohne VAT-only in OPOS umzudeuten", async () => {
    const a = await advance();
    await bank.createCashInvoiceEntry(actor, { invoiceId: a.id, date: "2026-02-20", amount: 11_900 }, "2026-02-20");
    const before = await abgleich.abgleichJahr(2026, "2026-02-15");
    const rows = before.zeilen.filter((z) => z.bereich === "opos");
    expect(rows).toEqual([...expected("2026-01-31", 0, 0), ...expected("2026-02-15", 0, 0)]);
    const after = await abgleich.abgleichJahr(2026, "2026-02-28");
    expect(after.zeilen.filter((z) => z.bereich === "opos")).toEqual([...expected("2026-01-31", 0, 0), ...expected("2026-02-28", 0, 10_000)]);
    const vat = await abgleich.vatAbgleich({ year: 2026, month: 2 });
    expect(vat.zeilen.every((z) => z.bereich === "ustva")).toBe(true);
    expect(vat.hinweise).toEqual([]);
  });
});
