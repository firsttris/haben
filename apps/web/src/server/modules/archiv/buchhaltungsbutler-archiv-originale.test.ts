import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Mischjahr bei schon hochgeladenem Stapel, Rechnungsnummer aus BB-Belegen

const BB_HEADERS = [
  "Datum",
  "Buchungstext",
  "Betrag",
  "Währung",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Zugewiesene Beträge",
  "Beleglinks",
  "Festschreibung",
  "Kommentar",
  "Leistungsdatum",
];
const DATEV_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Buchungstext",
  ...Array.from({ length: 16 }, (_, i) => `Beleginfo - ${i % 2 === 0 ? "Art" : "Inhalt"} ${Math.floor(i / 2) + 1}`),
];
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF");

interface Row {
  id: string;
  debit: string;
  credit: string;
  bu: string;
  rate: string;
  receipt: boolean;
  amount?: string;
  /** TTMM */
  date?: string;
  number?: string;
}

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((r) => r.map((f) => `"${f}"`).join(";")).join("\r\n"));

function parts(rows: Row[], skr = "03") {
  const meta = Array.from({ length: 30 }, () => "");
  Object.assign(meta, {
    0: "EXTF",
    1: "700",
    2: "21",
    3: "Buchungsstapel",
    4: "12",
    12: "20230101",
    13: "4",
    14: "20230101",
    15: "20231231",
    21: "EUR",
    26: skr,
  });
  const datev: string[][] = [meta, DATEV_HEADERS];
  const bb: string[][] = [BB_HEADERS];
  const receipts: Record<string, Uint8Array> = {};
  for (const r of rows) {
    const amount = r.amount ?? "119,00";
    const number = r.number ?? (r.receipt ? `R-${r.id}` : "");
    const ddmm = r.date ?? "0401";
    const day = `${ddmm.slice(0, 2)}.${ddmm.slice(2)}.2023`;
    const url = r.receipt ? `https://bb.example/${r.id}.pdf` : "";
    const info = [
      "Buchungsnummer",
      r.id,
      ...(r.receipt
        ? ["URL", url, "Gegenpartei", "Muster GmbH", "Rechnungsnummer", number, "Betrag", amount, "Umsatzsteuer", r.rate, "Rechnungsdatum", day]
        : []),
    ];
    // Soll/Haben-Kennzeichen S: Konto ist das Sollkonto
    datev.push([amount, "S", "EUR", r.debit, r.credit, r.bu, ddmm, number, "Muster GmbH", ...info]);
    bb.push([day, "Muster GmbH", amount, "EUR", r.debit, r.credit, r.bu, r.id, number, "Muster GmbH", r.rate, amount, url, "1", "", day]);
    if (r.receipt) receipts[`Belege/${r.id}.pdf`] = PDF;
  }
  return [
    { name: "EXTF_Buchungsstapel.csv", bytes: csv(datev) },
    { name: "BB_Buchungsstapel.csv", bytes: csv(bb) },
    { name: "Belege.zip", bytes: zipSync(receipts) },
  ];
}

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler: Originale und Stapel im Archiv (Postgres)", () => {
  let bb: typeof import("./buchhaltungsbutler.ts");
  let lex: typeof import("./lexoffice.ts");
  let archive: typeof import("./archive.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bb = await import("./buchhaltungsbutler.ts");
    lex = await import("./lexoffice.ts");
    archive = await import("./archive.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
  });

  const row1: Row = { id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true, date: "0108" };
  const files = () => sql`select kind, filename, sha256, note from archive_files order by kind, filename`;
  const sha = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const datevIds = async () =>
    (await sql`select progress from lexoffice_imports where source = 'buchhaltungsbutler' order by started_at`).map(
      (r) => (r.progress as { datevFileIds?: string[] }).datevFileIds,
    );

  it("getrennte Dateien: drei Archivdateien, eine davon DATEV mit Buchungen, Bytes unverändert", async () => {
    const p = parts([row1]);
    await bb.startBuchhaltungsbutlerImport("test-user", p);
    const rows = await files();
    expect(rows.map((r) => [r.kind, r.filename])).toEqual([
      ["datev", "EXTF_Buchungsstapel.csv"],
      ["sonstiges", "BB_Buchungsstapel.csv"],
      ["sonstiges", "Belege.zip"],
    ]);
    expect(new Set(rows.map((r) => r.sha256))).toEqual(new Set(await Promise.all(p.map((x) => sha(x.bytes)))));
    expect((await sql`select count(*)::int as n from datev_bookings`)[0]!.n).toBe(1);
    expect((await datevIds())[0]).toHaveLength(1);
  });

  it(".zip: die .zip unverändert als sonstiges, der Stapel als DATEV; erneuter Import legt nichts doppelt ab", async () => {
    const p = parts([row1]);
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    const rows = await files();
    expect(rows.map((r) => [r.kind, r.filename, r.sha256])).toEqual([
      ["datev", "EXTF_Buchungsstapel.csv", await sha(p[0]!.bytes)],
      ["sonstiges", "datenexport.zip", await sha(zip)],
    ]);
    const ids = await datevIds();
    expect(ids[0]).toEqual(ids[1]);
    expect((await sql`select count(*)::int as n from datev_bookings`)[0]!.n).toBe(1);
  });

  it("Stapel vorher schon von Hand hochgeladen, dann .zip-Import: keine Überschneidung, Stapel zählt im Mischjahr", async () => {
    const p = parts([row1]);
    const manual = await archive.addArchiveFile("test-user", { bytes: p[0]!.bytes, filename: "stapel.csv", kind: "datev", year: 2023 });
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    expect((await datevIds())[0]).toEqual([manual.id]);
    expect((await files()).map((r) => r.kind)).toEqual(["datev", "sonstiges"]);
  });

  it("erst getrennt, dann derselbe Export als .zip: Stapel nur einmal", async () => {
    const p = parts([row1]);
    await bb.startBuchhaltungsbutlerImport("test-user", p);
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    const ids = await datevIds();
    expect(ids[1]).toEqual(ids[0]);
    expect((await sql`select count(*)::int as n from archive_files where kind = 'datev'`)[0]!.n).toBe(1);
  });

  it(".zip mit Ordner (z. B. Ordner im Finder/Explorer gepackt): Import läuft, Stapel als DATEV ohne Ordnernamen", async () => {
    const p = parts([row1]);
    const zip = zipSync({ datenexport: Object.fromEntries(p.map((part) => [part.name, part.bytes])) });
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    expect((await files()).map((r) => [r.kind, r.filename])).toEqual([
      ["datev", "EXTF_Buchungsstapel.csv"],
      ["sonstiges", "datenexport.zip"],
    ]);
  });

  it(".zip vom Mac (mit __MACOSX/._-Einträgen): Import läuft", async () => {
    const p = parts([row1]);
    const fork = new Uint8Array([0, 5, 22, 7, 0, 2, 0, 0]);
    const entries: Record<string, Uint8Array> = {};
    for (const part of p) {
      entries[part.name] = part.bytes;
      entries[`__MACOSX/._${part.name}`] = fork;
    }
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "Archiv.zip", bytes: zipSync(entries) }]);
    expect((await files()).map((r) => r.kind)).toEqual(["datev", "sonstiges"]);
  });

  it("Fehler beim Ablegen des Stapels (Zeitraum schon belegt): Import endet mit Fehler, kein datevFileIds", async () => {
    const p = parts([row1]);
    const other = parts([{ ...row1, id: "2", amount: "238,00" }]);
    await archive.addArchiveFile("test-user", { bytes: other[0]!.bytes, filename: "anderer.csv", kind: "datev", year: 2023 });
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await expect(bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }])).rejects.toThrow("überschneidet");
    const [run] = await sql`select status, progress from lexoffice_imports where source = 'buchhaltungsbutler'`;
    expect(run!.status).toBe("fehler");
    expect((run!.progress as { datevFileIds?: string[] }).datevFileIds).toBeUndefined();
    expect((await sql`select count(*)::int as n from lexoffice_vouchers`)[0]!.n).toBe(0);
  });

  it("reines BB-Jahr aus der .zip: Summen aus dem Stapel, Archiv-Export enthält .zip und Stapel", async () => {
    const p = parts([row1]);
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    const { years } = await lex.reconciliation();
    const y = years.find((x) => x.year === 2023)!;
    expect(y.sumsFrom).toBe("datev");
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });
});
