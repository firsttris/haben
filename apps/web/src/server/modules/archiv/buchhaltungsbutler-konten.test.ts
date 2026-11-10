import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Abgleich je Jahr (Einnahmen, Umsatzsteuer je Monat) nach einem BuchhaltungsButler-Import

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
    const number = r.receipt ? `R-${r.id}` : "";
    const url = r.receipt ? `https://bb.example/${r.id}.pdf` : "";
    const info = [
      "Buchungsnummer",
      r.id,
      ...(r.receipt
        ? ["URL", url, "Gegenpartei", "Muster GmbH", "Rechnungsnummer", number, "Betrag", amount, "Umsatzsteuer", r.rate, "Rechnungsdatum", "04.01.2023"]
        : []),
    ];
    // Soll/Haben-Kennzeichen S: Konto ist das Sollkonto
    datev.push([amount, "S", "EUR", r.debit, r.credit, r.bu, "0401", number, "Muster GmbH", ...info]);
    bb.push(["04.01.2023", "Muster GmbH", amount, "EUR", r.debit, r.credit, r.bu, r.id, number, "Muster GmbH", r.rate, amount, url, "1", "", "04.01.2023"]);
    if (r.receipt) receipts[`Belege/${r.id}.pdf`] = PDF;
  }
  return [
    { name: "EXTF_Buchungsstapel.csv", bytes: csv(datev) },
    { name: "BB_Buchungsstapel.csv", bytes: csv(bb) },
    { name: "Belege.zip", bytes: zipSync(receipts) },
  ];
}

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler im Jahresabgleich: Anlagen, Kreditoren und sonstige Konten (Postgres)", () => {
  let bb: typeof import("./buchhaltungsbutler.ts");
  let lex: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    bb = await import("./buchhaltungsbutler.ts");
    lex = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", rechtsform: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  async function year2023() {
    const { years } = await lex.reconciliation();
    return years.find((y) => y.year === 2023)!;
  }

  it.each([
    ["SKR03", "0650", "1200", "03"],
    ["SKR04", "0650", "1800", "04"],
  ] as const)("%s: Anlage über das Kreditorenkonto behält ihre Vorsteuer (Kz 66)", async (skr, asset, bank, code) => {
    await company(skr, "soll", "gmbh");
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts(
        [
          { id: "1", debit: asset, credit: "70000", bu: "9", rate: "19", receipt: true, amount: "1.190,00" },
          { id: "2", debit: "70000", credit: bank, bu: "", rate: "", receipt: false, amount: "1.190,00" },
        ],
        code,
      ),
    );
    const y = await year2023();
    expect(y.vat[0]).toMatchObject({ month: "2023-01", kz66: 19000 });
  });

  it("SKR04: Kfz-Steuer (7685) mit Beleg ist eine Ausgabe, kein Privat oder Geldtransit", async () => {
    await company("SKR04", "soll", "einzelunternehmen");
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([{ id: "1", debit: "7685", credit: "1800", bu: "", rate: "0", receipt: true, amount: "180,00" }], "04"),
    );
    const y = await year2023();
    expect(y.ausgaben.gross).toBe(18000);
    expect(y.neutral).toEqual([]);
  });

  it("SKR03: Zinsaufwand (2110) mit Beleg ist eine Ausgabe", async () => {
    await company("SKR03", "soll", "einzelunternehmen");
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([{ id: "1", debit: "2110", credit: "1200", bu: "", rate: "0", receipt: true, amount: "50,00" }], "03"),
    );
    const y = await year2023();
    expect(y.ausgaben.gross).toBe(5000);
    expect(y.neutral).toEqual([]);
  });

  it("SKR04: Privatentnahme (2100) mit Beleg bleibt neutral", async () => {
    await company("SKR04", "soll", "einzelunternehmen");
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([{ id: "1", debit: "2100", credit: "1800", bu: "", rate: "0", receipt: true, amount: "500,00" }], "04"),
    );
    const y = await year2023();
    expect(y.ausgaben.gross).toBe(0);
    expect(y.neutral).toMatchObject([{ count: 1 }]);
  });
});
