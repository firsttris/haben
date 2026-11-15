import { strToU8 } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixture, innerZip, zip } from "../../../../../../packages/import/src/sevdesk/export/testzip.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Lauf mit der Export-ZIP von sevDesk (#1105), nachgebaut aus dem Auszug der Testdaten 2.0 (test-fixtures/sevdesk):
 * Rechnung (8400 H), Ausgabebeleg (4985 S, BU 9) und ein Darlehen ohne Beleglink. Für SKR04 dieselben Zeilen mit
 * 4400, 6300 und 3150. Belegdateien sind erfundene PDFs aus testzip.ts.
 */

type Kontenrahmen = "SKR03" | "SKR04";
const KONTEN: Record<Kontenrahmen, { erloes: string; aufwand: string; darlehen: string }> = {
  SKR03: { erloes: "8400", aufwand: "4985", darlehen: "0630" },
  SKR04: { erloes: "4400", aufwand: "6300", darlehen: "3150" },
};
const STAPEL = "EXTF_Buchungsstapel_20240101_20241231.csv";
const [kopf, spalten, rechnung, ausgabe] = new TextDecoder().decode(fixture("buchhaltung-2.0/extf-buchungsstapel-auszug.csv")).split("\n") as string[];

function stapel(kontenrahmen: Kontenrahmen): Uint8Array {
  const { erloes, aufwand, darlehen } = KONTEN[kontenrahmen];
  // Darlehen erhalten: Kreditor im Soll, Darlehenskonto im Haben, Netto in Beleginfo, ohne Beleglink
  const darlehenZeile = ausgabe!
    .replace(/"BEDI ""[^"]+"""/, "")
    .replace(/^100,00;"H"/, '500,00;"S"')
    .replace(";70002;4985;9;", `;70002;${darlehen};;`)
    .replace(";1111111111111111112;", ";DL-1;")
    .replace(";84,03;", ";500,00;")
    .replace(";15,97;", ";;");
  const zeilen = [rechnung!, ausgabe!, darlehenZeile].map((z) => z.replace(";8400;", `;${erloes};`).replace(";4985;", `;${aufwand};`));
  return strToU8([kopf, spalten, ...zeilen].join("\n"));
}

/** `ohne`: Belegdateien, die in der inneren ZIP fehlen */
function exportZip(kontenrahmen: Kontenrahmen, ohne: string[] = []): Uint8Array {
  return zip({
    [STAPEL]: stapel(kontenrahmen),
    "EXTF_GP_Stamm_20240101_20241231.csv": fixture("buchhaltung-2.0/extf-gp-stamm.csv"),
    "DATEV_Rechnungsausgang_20240101_20241231.zip": innerZip(fixture("buchhaltung-2.0/document-rechnungsausgang.xml"), ohne),
    "DATEV_Rechnungseingang_20240101_20241231.zip": innerZip(fixture("buchhaltung-2.0/document-rechnungseingang.xml")),
  });
}

const NAME = "BITTE-ENTPACKEN_Buchungsstapel_und_Belegbilder_1_1_20240101_bis_20241231.zip";

describe.skipIf(!testDatabaseUrl)("sevDesk ohne API: Export-ZIP übernehmen (Postgres)", () => {
  let sev: typeof import("./sevdesk-export.ts");
  let archive: typeof import("./archive.ts");
  let lex: typeof import("./lexoffice.ts");
  let open: typeof import("./legacy-open.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    sev = await import("./sevdesk-export.ts");
    archive = await import("./archive.ts");
    lex = await import("./lexoffice.ts");
    open = await import("./legacy-open.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: Kontenrahmen = "SKR03", versteuerung: "ist" | "soll" = "soll") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
  }

  const counts = async () =>
    (
      await sql`select (select count(*)::int from lexoffice_vouchers where source = 'sevdesk-export') as vouchers,
        (select count(*)::int from lexoffice_voucher_files) as files,
        (select count(*)::int from archive_files) as archived,
        (select count(*)::int from datev_bookings) as bookings`
    )[0];

  async function run(bytes: Uint8Array) {
    await sev.analyseSevdeskExport(bytes, NAME);
    const id = await sev.startSevdeskExportImport(actor, { wait: true });
    return (await sev.sevdeskExportImportStatus(id))!;
  }

  beforeEach(() => company());

  it("analysiert, ohne etwas anzulegen", async () => {
    const analysis = await sev.analyseSevdeskExport(exportZip("SKR03"), NAME);
    expect(analysis).toMatchObject({ years: [2024], bookings: 3, vouchers: 3, withFile: 2, withoutImage: 1, otherAccounts: 1, zipArchived: false });
    expect(analysis.stacks).toEqual([{ name: STAPEL, from: "2024-01-15", to: "2024-01-15", state: "neu" }]);
    expect(await counts()).toEqual({ vouchers: 0, files: 0, archived: 0, bookings: 0 });
  });

  it("lehnt eine fremde ZIP mit Grund ab und legt nichts an", async () => {
    const fremd = zip({ "Belege.zip": zip({ "a.pdf": strToU8("%PDF-1.4") }), "readme.txt": strToU8("x") });
    await expect(sev.analyseSevdeskExport(fremd, "fremd.zip")).rejects.toThrow(/Buchungsdaten & Belegbilder/);
    await expect(sev.startSevdeskExportImport(actor, { wait: true })).rejects.toThrow("Zuerst den Export hochladen.");
    expect(await counts()).toMatchObject({ vouchers: 0 });
  });

  it("übernimmt ZIP, Stapel und je Beleg einen Archivbeleg mit Datei; ein zweiter Upload legt nichts doppelt an", async () => {
    const bytes = exportZip("SKR03");
    const first = await run(bytes);
    expect(first.status).toBe("fertig");
    expect(first.progress).toMatchObject({ imported: 3, skipped: 0, files: 2, failed: [] });
    expect(await counts()).toEqual({ vouchers: 3, files: 2, archived: 2, bookings: 3 });
    const files = await sql`select kind, sha256, size from archive_files order by kind`;
    expect(files.map((f) => f.kind)).toEqual(["datev", "sonstiges"]);
    // Die ZIP liegt byte-gleich im Archiv
    const zipRow = files.find((f) => f.kind === "sonstiges")!;
    expect(zipRow.size).toBe(bytes.byteLength);

    const second = await run(bytes);
    expect(second.progress).toMatchObject({ imported: 0, skipped: 3, files: 0 });
    expect(await counts()).toEqual({ vouchers: 3, files: 2, archived: 2, bookings: 3 });
  });

  it("ein späterer Upload hängt ein Belegbild an, das im ersten Export fehlte, ohne den Beleg doppelt anzulegen", async () => {
    const [rechnungsbild] = new TextDecoder().decode(fixture("buchhaltung-2.0/document-rechnungsausgang.xml")).match(/[^"]*Rechnung[^"]*\.pdf/) ?? [];
    expect(rechnungsbild).toBeTruthy();
    const ohneBild = await run(exportZip("SKR03", [rechnungsbild!]));
    expect(ohneBild.sevdeskExport).toMatchObject({ missingFile: 1 });
    expect(await counts()).toMatchObject({ vouchers: 3, files: 1 });
    const [row] = await sql`select raw from lexoffice_vouchers where number = 'XX-1111111111'`;
    expect(row!.raw).toMatchObject({ dateiFehlt: true });
    const mitBild = await run(exportZip("SKR03"));
    expect(mitBild.progress).toMatchObject({ imported: 0, skipped: 3, files: 1 });
    expect(await counts()).toMatchObject({ vouchers: 3, files: 2, bookings: 3 });
  });

  it("früherer Weg: ZIP als Sonstiges und Stapel als DATEV-Buchungsstapel schon im Archiv, keine Doppelung", async () => {
    const bytes = exportZip("SKR03");
    await archive.addArchiveFile(actor, { bytes, filename: NAME, kind: "sonstiges", year: 2024 });
    await archive.addArchiveFile(actor, { bytes: stapel("SKR03"), filename: STAPEL, kind: "datev", year: 2024 });
    const analysis = await sev.analyseSevdeskExport(bytes, NAME);
    expect(analysis).toMatchObject({ zipArchived: true, stacks: [{ state: "vorhanden" }] });
    await sev.startSevdeskExportImport(actor, { wait: true });
    expect(await counts()).toEqual({ vouchers: 3, files: 2, archived: 2, bookings: 3 });
  });

  it("anderer Stapel im selben Zeitraum: der Stapel aus der ZIP kommt nicht dazu", async () => {
    const anders = new TextEncoder().encode(new TextDecoder().decode(stapel("SKR03")).replace(";DL-1;", ";DL-2;"));
    await archive.addArchiveFile(actor, { bytes: anders, filename: "EXTF_Buchungsstapel_eigen.csv", kind: "datev", year: 2024 });
    const result = await run(exportZip("SKR03"));
    expect(result.sevdeskExport).toMatchObject({ stacks: [{ state: "zeitraum", other: "EXTF_Buchungsstapel_eigen.csv" }] });
    expect(result.sevdeskExport!.note).toContain("nicht angelegt");
    expect(await counts()).toEqual({ vouchers: 3, files: 2, archived: 2, bookings: 3 });
  });

  it("ein Jahr mit Belegen aus der API bekommt keine Belege aus dem Export", async () => {
    const [imp] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{"phase":"fertig"}'::jsonb, 'sevdesk') returning id`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, source, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values ('invoice/1', ${imp!.id}, 'sevdesk', 'invoice', 'einnahme', 'RE-1', '2024-03-01', 'paid', 'Kunde', 100, 19, 119, '[]'::jsonb, '[]'::jsonb, null, '{}'::jsonb)`;
    const result = await run(exportZip("SKR03"));
    expect(result.sevdeskExport).toMatchObject({ apiYears: [2024], inApiYears: 3 });
    expect(result.progress).toMatchObject({ imported: 0, skipped: 3 });
    expect(await counts()).toMatchObject({ vouchers: 0, archived: 2, bookings: 3 });
  });

  describe.each([
    ["SKR03", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "soll"],
    ["SKR04", "ist"],
  ] as const)("Abgleich und offene Posten (%s, %s)", (kontenrahmen, versteuerung) => {
    it("Summen aus dem Stapel, das Darlehen zählt weder als Einnahme noch als Ausgabe, keine offenen Posten", async () => {
      await company(kontenrahmen, versteuerung);
      await run(exportZip(kontenrahmen));
      const rows = await sql`select type, direction, gross, raw->>'accountKind' as kind from lexoffice_vouchers order by number`;
      expect(rows.map((r) => [r.type, r.direction, r.gross, r.kind])).toEqual([
        ["purchaseinvoice", "ausgabe", 10000, "aufwand"],
        ["salesinvoice", "einnahme", 50000, "sonstige"],
        ["salesinvoice", "einnahme", 10000, "erloese"],
      ]);
      const year = (await lex.reconciliation()).years.find((y) => y.year === 2024)!;
      expect(year.sumsFrom).toBe("datev");
      expect(year.einnahmen).toMatchObject({ net: 8403, tax: 1597 });
      expect(year.ausgaben).toMatchObject({ net: 8403, tax: 1597 });
      expect(year.neutral).toEqual([]);
      const period = await lex.legacyVouchersForPeriod({ period: "2024", direction: "alle", search: "", withPayments: false, limit: 100 });
      expect(period.total).toBe(0);
      expect(await open.openLegacyItems()).toEqual([]);
    });
  });
});
