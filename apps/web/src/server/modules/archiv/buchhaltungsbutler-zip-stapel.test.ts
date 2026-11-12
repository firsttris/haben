import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

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

describe.skipIf(!testDatabaseUrl)("BuchhaltungsButler: DATEV-Stapel des Exports im Abgleich (Postgres)", () => {
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

  beforeEach(async () => {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'soll', 'einzelunternehmen')`;
  });

  async function lexofficeInvoice(net: number, tax: number) {
    const [run] =
      await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb, 'lexoffice') returning id`;
    await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, source, type, direction, number, date, status, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, ${run!.id}, 'lexoffice', 'invoice', 'einnahme', 'RE-100', '2023-03-10', 'paid', 'Kunde AG', ${net}, ${tax}, ${net + tax},
        ${JSON.stringify([{ rate: 1900, net, tax }])}::jsonb, '[]'::jsonb, null, '{}'::jsonb)`;
  }

  async function year2023() {
    const { years } = await lex.reconciliation();
    return years.find((y) => y.year === 2023)!;
  }

  it("Mischjahr: alle drei Dateien als eine .zip hochgeladen, der BB-Teil zählt trotzdem", async () => {
    await lexofficeInvoice(50000, 9500);
    const p = parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true, date: "0108" }]);
    const zip = zipSync(Object.fromEntries(p.map((part) => [part.name, part.bytes])));
    await bb.startBuchhaltungsbutlerImport("test-user", [{ name: "datenexport.zip", bytes: zip }]);
    const y = await year2023();
    expect(y.einnahmen).toMatchObject({ net: 60000, tax: 11400 });
  });

  it("Mischjahr: erneuter Import desselben Exports zählt den BB-Stapel nur einmal", async () => {
    await lexofficeInvoice(50000, 9500);
    const p = parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true, date: "0108" }]);
    await bb.startBuchhaltungsbutlerImport("test-user", p);
    await bb.startBuchhaltungsbutlerImport("test-user", p);
    const y = await year2023();
    expect(y.einnahmen).toMatchObject({ net: 60000, tax: 11400 });
  });

  it("reines BB-Jahr bleibt bei den Summen aus dem Stapel", async () => {
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true, date: "0108" }]));
    const y = await year2023();
    expect(y.sumsFrom).toBe("datev");
    expect(y.einnahmen).toMatchObject({ net: 10000, tax: 1900 });
  });

  it("Lexoffice-Import danach überschreibt datevFileIds des BB-Imports nicht", async () => {
    await bb.startBuchhaltungsbutlerImport("test-user", parts([{ id: "1", debit: "1200", credit: "8400", bu: "3", rate: "19", receipt: true, date: "0108" }]));
    const [row] = await sql`select progress from lexoffice_imports where source = 'buchhaltungsbutler'`;
    expect((row!.progress as { datevFileIds?: string[] }).datevFileIds).toHaveLength(1);
  });
});
