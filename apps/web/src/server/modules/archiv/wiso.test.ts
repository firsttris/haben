import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const HEADER =
  "Buchungsnummer;Teilbuchung;Zahlungsdatum;Wertstellungsdatum;Buchungstext;Konto;Kontobezeichnung;Gegenkonto;Gegenkontobezeichnung;Soll;Haben;Steuerschluessel;Steuersatz;Steuerschluesselbezeichnung;Belegnummer;Buchungsdatum;UStID;Umsatzart";

function wisoBytes(lines: string[]): Uint8Array {
  return new TextEncoder().encode([HEADER, ...lines].join("\r\n"));
}

describe.skipIf(!testDatabaseUrl)("WISO-Import (Postgres)", () => {
  let wiso: typeof import("./wiso.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    wiso = await import("./wiso.ts");
  }, 90_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist', 'einzelunternehmen')`;
  });

  it("schreibt im Testlauf nichts, archiviert CSV und Buchungen und bleibt beim zweiten Lauf idempotent", async () => {
    const bytes = wisoBytes([
      "6;1;01.01.2026;01.01.2026;Werbung;4600;Werbekosten;1200;Bank;67,92;0,00;VSt 19 %;19,00;Vorsteuer 19 %;n4;**.**.**26;;0",
      "10;1;05.01.2026;05.01.2026;Honorar;8400;Erlöse 19 % USt;1200;Bank;0,00;200,00;USt 19 %;19,00;Umsatzsteuer 19 %;R8;**.**.**26;;0",
    ]);

    const preview = await wiso.previewWisoCsv(bytes);
    expect(preview).toMatchObject({ years: [2026], bookings: 2, rows: 2 });
    expect(await sql`select count(*)::int as n from lexoffice_vouchers`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 0 }]);

    const first = await wiso.startWisoImport("test-user", bytes, "wiso-buchungen-2026.csv");
    expect(first).toMatchObject({ years: [2026], bookings: 2, rows: 2, imported: 2, skipped: 0 });

    const vouchers =
      await sql`select lexoffice_id, source, direction, number, net, tax, gross, raw->>'ohneBeleg' as ohne_beleg from lexoffice_vouchers order by lexoffice_id`;
    expect(vouchers).toEqual([
      { lexoffice_id: "wiso/2026/10", source: "wiso", direction: "einnahme", number: "R8", net: 16807, tax: 3193, gross: 20000, ohne_beleg: "true" },
      { lexoffice_id: "wiso/2026/6", source: "wiso", direction: "ausgabe", number: "n4", net: 5708, tax: 1084, gross: 6792, ohne_beleg: "true" },
    ]);

    const files = await sql`select kind, year, filename, note from archive_files`;
    expect(files).toEqual([{ kind: "sonstiges", year: 2026, filename: "wiso-buchungen-2026.csv", note: wiso.WISO_ORIGINAL_NOTE }]);

    const second = await wiso.startWisoImport("test-user", bytes, "wiso-buchungen-2026.csv");
    expect(second).toMatchObject({ imported: 0, skipped: 2 });
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 1 }]);
  });

  it("liest im SKR04 Erlös- und Aufwandskonten korrekt", async () => {
    await sql`update company set kontenrahmen = 'SKR04'`;
    const bytes = wisoBytes([
      "1;1;15.03.2026;15.03.2026;Beratung;4400;Erlöse 19 % USt;1800;Bank;0,00;119,00;USt 19 %;19,00;USt 19 %;R1;15.03.2026;;0",
      "2;1;16.03.2026;16.03.2026;Büro;6815;Bürobedarf;1800;Bank;23,80;0,00;VSt 19 %;19,00;VSt 19 %;E1;16.03.2026;;0",
    ]);

    const result = await wiso.startWisoImport("test-user", bytes, "wiso-skr04.csv");
    expect(result).toMatchObject({ imported: 2, skipped: 0 });
    const rows = await sql`select lexoffice_id, direction, gross from lexoffice_vouchers order by lexoffice_id`;
    expect(rows).toEqual([
      { lexoffice_id: "wiso/2026/1", direction: "einnahme", gross: 11900 },
      { lexoffice_id: "wiso/2026/2", direction: "ausgabe", gross: 2380 },
    ]);
  });

  it.each(["SKR03", "SKR04"] as const)("%s: archiviert ohne Leistungsdatum und erhält Zahlung, Original und Dublettenkennung", async (skr) => {
    await sql`update company set kontenrahmen = ${skr}`;
    const revenue = skr === "SKR03" ? "8400" : "4400";
    const bank = skr === "SKR03" ? "1200" : "1800";
    const bytes = wisoBytes([
      `81;1;15.01.2026;16.01.2026;Leistung Dezember 2025;${revenue};Erlöse;${bank};Bank;0,00;119,00;USt 19 %;19,00;Umsatzsteuer;FIKTIV-81;03.02.2026;;0`,
    ]);
    await wiso.startWisoImport("test-user", bytes, "fiktiv.csv");
    const [row] = await sql`select * from lexoffice_vouchers where lexoffice_id = 'wiso/2026/81'`;
    expect(row).toMatchObject({ date: "2026-01-15", service_from: null, service_to: null, net: 10000, tax: 1900, gross: 11900 });
    expect(row!.raw.rows[0]).toMatchObject({ zahlungsdatum: "2026-01-15", wertstellungsdatum: "2026-01-16", buchungsdatum: "2026-02-03" });
    expect(row!.payment).toEqual({ status: "paid", openAmount: 0, paidDate: "2026-01-15", items: [{ type: "payment", date: "2026-01-15", amount: 11900 }] });
    const { loadFile, sha256Of } = await import("../../storage.ts");
    const [original] = await sql`select sha256 from archive_files`;
    expect(original!.sha256).toBe(sha256Of(bytes));
    expect(new Uint8Array(await loadFile(original!.sha256))).toEqual(bytes);
    expect(await wiso.startWisoImport("test-user", bytes, "fiktiv.csv")).toMatchObject({ imported: 0, skipped: 1 });
    expect(await sql`select * from lexoffice_vouchers where id = ${row!.id}`).toEqual([row]);
    expect(await sql`select count(*)::int as n from archive_files`).toEqual([{ n: 1 }]);
  });

  it.each(["wiso", "lexoffice", "import"] as const)("%s: liest alte Leistungsfelder nach Herkunft, ohne die Archivzeile zu ändern", async (source) => {
    const [run] = await sql`insert into lexoffice_imports (source, status, progress) values (${source}, 'fertig', '{"phase":"fertig"}') returning id`;
    const [row] = await sql`insert into lexoffice_vouchers
      (lexoffice_id, import_id, source, type, direction, number, date, service_from, service_to, status, net, tax, gross, taxes, categories, payment, raw)
      values ('wiso/2026/81', ${run!.id}, ${source}, 'salesinvoice', 'einnahme', 'FIKTIV-ALT-81', '2026-01-15', '2026-01-15', '2026-01-15', 'archiviert',
        10000, 1900, 11900, '[{"rate":1900,"net":10000,"tax":1900}]', '[]',
        '{"status":"paid","openAmount":0,"paidDate":"2026-01-15","items":[{"type":"payment","date":"2026-01-15","amount":11900}]}',
        '{"ohneBeleg":true,"rows":[{"zahlungsdatum":"2026-01-15","buchungsdatum":"2026-02-03"}]}') returning *`;
    const before = await sql`select * from audit_log order by id`;
    const { legacyVoucherDetail, findLegacyVouchers } = await import("./lexoffice.ts");
    const dates = source === "wiso" ? { serviceFrom: null, serviceTo: null } : { serviceFrom: "2026-01-15", serviceTo: "2026-01-15" };
    const detail = await legacyVoucherDetail(row!.id);
    expect(detail!.voucher).toMatchObject({ source, date: "2026-01-15", ...dates, net: 10000, tax: 1900, gross: 11900 });
    if (source === "wiso") expect(detail!.voucher.payment).toEqual(row!.payment);
    expect((await findLegacyVouchers("FIKTIV-ALT-81"))[0]!.voucher).toMatchObject(dates);
    expect((await findLegacyVouchers("FIKTIV-ALT-81"))[0]!.raw).toEqual(row!.raw);
    expect(await sql`select * from lexoffice_vouchers where id = ${row!.id}`).toEqual([row]);
    expect(await sql`select * from audit_log order by id`).toEqual(before);
  });

  // WISO EÜR rechnet nach Zahlung: Die Spalte „Zahlungsdatum“ ist der Zufluss. Bei Ist-Versteuerung zählt die Umsatzsteuer
  // im Abgleich nach Zahlungen (legacyVatByMonth, § 13 Abs. 1 Nr. 1 Buchst. b UStG); ohne sie fehlte die Einnahme in Kz 81,
  // während die Vorsteuer in Kz 66 steht
  it("zählt Einnahmen bei Ist-Versteuerung im Abgleich im Monat des Zahlungsdatums", async () => {
    const bytes = wisoBytes([
      "6;1;12.01.2026;12.01.2026;Werbung;4600;Werbekosten;1200;Bank;67,92;0,00;VSt 19 %;19,00;Vorsteuer 19 %;n4;12.01.2026;;0",
      "10;1;15.01.2026;15.01.2026;Honorar;8400;Erlöse 19 % USt;1200;Bank;0,00;200,00;USt 19 %;19,00;Umsatzsteuer 19 %;R8;15.01.2026;;0",
    ]);
    await wiso.startWisoImport("test-user", bytes, "wiso-ist.csv");

    const { reconciliation } = await import("./lexoffice.ts");
    const jahr = (await reconciliation()).years.find((y) => y.year === 2026)!;
    const januar = jahr.vat.find((m) => m.month === "2026-01")!;
    expect({ kz81: januar.kz81, tax81: januar.tax81, kz66: januar.kz66 }).toEqual({ kz81: 16807, tax81: 3193, kz66: 1084 });
  });
  // § 13b UStG und innergemeinschaftlicher Erwerb: Der Lieferant bekommt nur das Netto (§ 14a Abs. 5 UStG), die Steuer
  // schuldet der Empfänger selbst. Im WISO-CSV steht der tatsächliche Abfluss; die selbst berechnete Steuer ist keine Zahlung
  // (Gegenprobe von SteGun93 in #1033)
  it.each([
    ["13b 19% And", "80,00", 8000],
    ["EU VSt 19 %", "55,80", 5580],
  ] as const)("%s: der tatsächliche Abfluss bleibt die Zahlung", async (key, amount, paid) => {
    const bytes = wisoBytes([`8;1;10.01.2026;10.01.2026;Fremdleistung;4806;Wartung;1200;Bank;${amount};0,00;${key};19,00;Steuer;TEST-8;03.02.2026;;0`]);
    await wiso.startWisoImport("test-user", bytes, "synthetisch.csv");
    const [row] = await sql`select payment from lexoffice_vouchers where lexoffice_id = 'wiso/2026/8'`;
    expect(row!.payment.items).toEqual([{ type: "payment", date: "2026-01-10", amount: paid }]);
  });

  // Die selbst geschuldete Steuer gehört in Kz 67 (§ 13b) bzw. Kz 61 (EU-Erwerb), nicht als Vorsteuer des Belegs in Kz 66:
  // Der Beleg trägt wie die Rechnung des Lieferanten keine Steuer (§ 14a Abs. 5 UStG)
  it.each([
    ["13b 19% And", "80,00", 8000],
    ["EU VSt 19 %", "55,80", 5580],
  ] as const)("%s: der Beleg zählt im Abgleich nicht als Vorsteuer in Kz 66", async (key, amount, net) => {
    const bytes = wisoBytes([`8;1;10.01.2026;10.01.2026;Fremdleistung;4806;Wartung;1200;Bank;${amount};0,00;${key};19,00;Steuer;TEST-8;03.02.2026;;0`]);
    await wiso.startWisoImport("test-user", bytes, "synthetisch.csv");
    const [row] = await sql`select net, tax, gross from lexoffice_vouchers where lexoffice_id = 'wiso/2026/8'`;
    expect(row).toEqual({ net, tax: 0, gross: net });

    const { reconciliation } = await import("./lexoffice.ts");
    const januar = (await reconciliation()).years.find((y) => y.year === 2026)!.vat.find((m) => m.month === "2026-01")!;
    expect(januar.kz66).toBe(0);
  });
});
