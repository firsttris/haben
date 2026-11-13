import { mapSevCreditNote, type SevCreditNote } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* Review #535: Honorar- und Provisions-Gutschriften aus sevDesk auf allen Lesepfaden als Ausgabe mit positiven Beträgen. */

const note = (bookingCategory: string, status: string, sums: { net: string; tax: string; gross: string }) =>
  ({
    id: "31",
    creditNoteDate: "2025-03-10",
    creditNoteNumber: "GS-31",
    status,
    bookingCategory,
    sumNet: sums.net,
    sumTax: sums.tax,
    sumGross: sums.gross,
  }) as unknown as SevCreditNote;

const simple = [{ sumNet: "100.00", sumTax: "19.00", sumGross: "119.00", taxRate: "19" }] as never[];

describe.skipIf(!testDatabaseUrl)("Review #535 (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let kontakt: typeof import("./kontakt-altbestand.ts");
  let history: typeof import("../auswertungen/kontakt-historie.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    kontakt = await import("./kontakt-altbestand.ts");
    history = await import("../auswertungen/kontakt-historie.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: string, versteuerung: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(
      sql,
    )`truncate legacy_voucher_payments, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  beforeEach(() => reset("SKR03", "soll"));

  async function insert(raw: SevCreditNote, positions: never[], contactId: string | null = null) {
    const { voucher: v, payment } = mapSevCreditNote(raw, positions);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, contact_id, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${contactId}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions })}::jsonb)
      returning id`;
    return row!.id as string;
  }

  it("Kontaktseite: Honorar-Gutschrift zählt bei den Einkäufen positiv wie unter Archiv › Belege", async () => {
    const freelancer = await contacts.createContact("test-user", {
      kundennummer: "",
      name: "Freie Feder",
      strasse: "Deich 1",
      plz: "28195",
      ort: "Bremen",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isCustomer: false,
      isSupplier: true,
    } as Parameters<typeof contacts.createContact>[1]);
    await insert(note("ROYALTY_ASSIGNED", "1000", { net: "100.00", tax: "19.00", gross: "119.00" }), simple, freelancer.id);
    const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "ausgabe", search: "", ohneDatei: false });
    const [archived] = await kontakt.legacyVouchersForContact(freelancer.id);
    const { purchases } = await history.contactHistory(freelancer.id, "2026-11-12");
    expect({ listed: listed!.gross, kontakt: archived!.gross, jahr: purchases.years[0]?.gross, richtung: archived!.direction }).toEqual({
      listed: 11_900,
      kontakt: 11_900,
      jahr: 11_900,
      richtung: "ausgabe",
    });
  });

  it("Detail: offener Betrag einer offenen Provisions-Gutschrift hat das Vorzeichen des Bruttos", async () => {
    const id = await insert(note("PROVISION", "200", { net: "100.00", tax: "19.00", gross: "119.00" }), simple);
    const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
    expect(detail.gross).toBe(11_900);
    expect(detail.payment).toMatchObject({ status: "open", openAmount: 11_900 });
  });

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "ist"],
  ])("mehrere Steuersätze mit Rabattzeile bei %s/%s: Vorsteuer und Aufteilung positiv und stimmig", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    const positions = [
      { sumNet: "100.00", sumTax: "19.00", sumGross: "119.00", taxRate: "19" },
      { sumNet: "50.00", sumTax: "3.50", sumGross: "53.50", taxRate: "7" },
      { sumNet: "-10.00", sumTax: "-1.90", sumGross: "-11.90", taxRate: "19" },
    ] as never[];
    const id = await insert(note("ROYALTY_UNASSIGNED", "1000", { net: "140.00", tax: "20.60", gross: "160.60" }), positions);
    const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
    expect(detail).toMatchObject({ direction: "ausgabe", net: 14_000, tax: 2_060, gross: 16_060 });
    expect([...detail.taxes].sort((a, b) => b.rate - a.rate)).toEqual([
      { rate: 1900, net: 9_000, tax: 1_710 },
      { rate: 700, net: 5_000, tax: 350 },
    ]);
    const y = (await lexoffice.reconciliation()).years.find((r) => r.year === 2025)!;
    expect(y.ausgaben).toEqual({ count: 1, net: 14_000, tax: 2_060, gross: 16_060 });
    expect(y.vat[0]).toMatchObject({ month: "2025-03", kz66: 2_060, kz81: 0, kz86: 0 });
  });

  it("Ist: Zeitraumabfrage mit Zahlungen sperrt nicht wegen einer bezahlten Honorar-Gutschrift ohne Einzelzahlung", async () => {
    await reset("SKR03", "ist");
    await insert(note("ROYALTY_ASSIGNED", "1000", { net: "100.00", tax: "19.00", gross: "119.00" }), simple);
    const period = await lexoffice.legacyVouchersForPeriod({ period: "2025-03", direction: "alle", search: "", withPayments: true, limit: 10 });
    expect(period.vouchers).toHaveLength(1);
    expect(period.vouchers[0]).toMatchObject({ direction: "ausgabe", gross: 11_900 });
  });

  it("UNDERACHIEVEMENT und ACCOUNTING_TYPE bleiben in Liste und Kontakt negativ", async () => {
    await insert(note("UNDERACHIEVEMENT", "200", { net: "100.00", tax: "19.00", gross: "119.00" }), simple);
    const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "einnahme", search: "", ohneDatei: false });
    expect(listed).toMatchObject({ type: "creditnote", gross: -11_900, net: -10_000, tax: -1_900 });
  });
});
