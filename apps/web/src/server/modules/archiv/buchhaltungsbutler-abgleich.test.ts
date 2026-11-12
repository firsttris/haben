import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Review PR #571: Abgleich je Jahr (Einnahmen, Umsatzsteuer je Monat) nach einem BuchhaltungsButler-Import

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

function parts(rows: Row[]) {
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
    26: "03",
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

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler-Import im Jahresabgleich (Postgres)", () => {
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

  async function company(versteuerung: "ist" | "soll", rechtsform = "einzelunternehmen") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', ${versteuerung}, ${rechtsform})`;
  }

  async function year2023() {
    const { years } = await lex.reconciliation();
    return years.find((y) => y.year === 2023)!;
  }

  beforeEach(() => company("soll"));

  it("zählt Erlöse auf dem Automatikkonto 8400 (ohne BU-Schlüssel) mit Umsatzsteuer", async () => {
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1200", credit: "8400", bu: "", rate: "19", receipt: true }]));
    const y = await year2023();
    expect(y.sumsFrom).toBe("datev");
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("zählt Geldtransit zwischen Bankkonten nicht als Einnahme", async () => {
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1360", credit: "1200", bu: "", rate: "", receipt: true }]));
    const y = await year2023();
    expect(y.einnahmen.gross).toBe(0);
  });

  it("verliert Erlöse ohne Beleg nicht aus den Einnahmen des Jahres", async () => {
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([
        { id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: false },
        { id: "2", debit: "4964", credit: "1200", bu: "9", rate: "19", receipt: true },
      ]),
    );
    const y = await year2023();
    expect(y.einnahmen.net).toBe(10000);
  });

  it("zeigt bei Ist-Versteuerung keine Umsatzsteuer je Monat aus BB-Belegen, die Jahressummen kommen aus dem DATEV-Stapel", async () => {
    await company("ist");
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true }]));
    const y = await year2023();
    // Der Export enthält keine Zahlungen je Rechnung; ohne sie gibt es keine Monate nach vereinnahmten Entgelten
    expect(y.vat).toEqual([]);
    expect(y.sumsFrom).toBe("datev");
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("zählt die Zahlung einer Rechnung über das Debitorenkonto nicht ein zweites Mal", async () => {
    await bb.startBuchhaltungsbutlerImport(
      "test-user",
      parts([
        { id: "1", debit: "10000", credit: "8400", bu: "", rate: "19", receipt: true },
        { id: "2", debit: "1200", credit: "10000", bu: "", rate: "", receipt: false },
      ]),
    );
    const y = await year2023();
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("zählt Geldtransit auch bei einer GmbH nicht als Einnahme", async () => {
    await company("soll", "gmbh");
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1360", credit: "1200", bu: "", rate: "19", receipt: true }]));
    const y = await year2023();
    expect(y.einnahmen.gross).toBe(0);
    expect(y.ausgaben.gross).toBe(0);
  });
});
