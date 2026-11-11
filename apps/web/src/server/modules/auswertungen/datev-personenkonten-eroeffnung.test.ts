import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today as heute } from "../../today.ts";

/*
 * Personenkonten im DATEV-Export neben einer Eröffnung aus dem DATEV-Stapel (#452): Ein offener Posten, den die Eröffnung
 * schon enthält, wird ohne eigene Buchung übernommen. Seine Zahlung darf das Personenkonto nicht ins Minus drehen, während
 * der Posten auf dem Sammelkonto offen bleibt.
 */

type Kontenrahmen = "SKR03" | "SKR04";

const COLUMNS = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;

type Row = [number, "S" | "H", string, string, string, string];

function stack(year: number, kontenrahmen: Kontenrahmen, rows: Row[]) {
  const skr = kontenrahmen === "SKR03" ? "03" : "04";
  const header = `"EXTF";700;21;"Buchungsstapel";13;${year + 1}0102120000000;;"LO";"";"";1001;12345;${year}0101;4;${year}0101;${year}1231;"Lexware Export";"";1;0;0;"EUR";;"";;;"${skr}";;;"";""`;
  const lines = rows.map(([cents, side, account, contra, bu, ttmm]) => {
    const amount = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
    return `${amount};"${side}";"EUR";;;;${account};${contra};"${bu}";${ttmm};"";"";;"Test"`;
  });
  return new TextEncoder().encode([header, COLUMNS, ...lines].join("\r\n"));
}

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const K = {
  SKR03: { bank: "1200", forderungen: "1400", kapital: "0800", erloes: "8400" },
  SKR04: { bank: "1800", forderungen: "1200", kapital: "2900", erloes: "4400" },
} as const;

const PDF = new TextEncoder().encode("%PDF-1.4\n% offener Posten\n%%EOF\n");

describe.skipIf(!testDatabaseUrl)("DATEV-Export mit Personenkonten nach einer Eröffnung aus dem Stapel (Postgres, #452)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("../archiv/archive.ts");
  let eroeffnung: typeof import("../archiv/datev-eroeffnung.ts");
  let legacy: typeof import("../archiv/legacy-open.ts");
  let storage: typeof import("../../storage.ts");
  let bank: typeof import("../bank/bank.ts");
  let datev: typeof import("./datev-export.ts");
  const actor = "test-user";
  const today = heute();
  const year = Number(today.slice(0, 4));
  const schlussjahr = year - 1;

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("../archiv/archive.ts");
    eroeffnung = await import("../archiv/datev-eroeffnung.ts");
    legacy = await import("../archiv/legacy-open.ts");
    storage = await import("../../storage.ts");
    bank = await import("../bank/bank.ts");
    datev = await import("./datev-export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: Kontenrahmen, versteuerung: "ist" | "soll") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(sql)`truncate datev_personenkonten, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, kontenrahmen, versteuerung, rechtsform,
              datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'DE89370400440532013000',
              ${kontenrahmen}, ${versteuerung}, 'gmbh', '29098', '55003')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  }

  async function offeneRechnung(number: string, net: number, tax: number) {
    const gross = net + tax;
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), 'invoice', 'einnahme', ${number},
        ${`${schlussjahr}-03-15`}, ${`${schlussjahr}-03-15`}, 'open', null, 'Nordwerk GmbH', ${net}, ${tax}, ${gross},
        ${JSON.stringify([{ rate: 1900, net, tax }])}::jsonb, '[]'::jsonb,
        ${JSON.stringify({ status: "openRevenue", openAmount: gross, paidDate: null, items: [] })}::jsonb,
        ${JSON.stringify({ address: { name: "Nordwerk GmbH" } })}::jsonb)
      returning id`;
    const sha = await storage.storeFile(PDF);
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
      values (${row!.id}, 'pdf', ${`${number}.pdf`}, 'application/pdf', ${sha}, ${PDF.byteLength})`;
    return row!.id as string;
  }

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: Zahlung eines übernommenen Postens aus der Eröffnung lässt das Personenkonto nicht im Minus", async (kr, versteuerung) => {
    await setup(kr, versteuerung);
    const k = K[kr];
    await archive.addArchiveFile(actor, {
      bytes: stack(schlussjahr, kr, [
        [2_500_000, "S", k.bank, "9000", "", "0101"],
        [2_500_000, "S", "9000", k.kapital, "", "0101"],
        [119_000, "S", "10001", k.erloes, "", "1503"],
      ]),
      filename: `EXTF_Buchungsstapel_${schlussjahr}.csv`,
      kind: "datev",
      year: null,
    });
    const rechnung = await offeneRechnung("RE-7", 100_000, 19_000);
    const vorschlag = await eroeffnung.datevEroeffnung(today);
    expect(vorschlag!.issues).toEqual([]);
    await eroeffnung.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);
    // Die Eröffnung enthält den Posten schon: Übernahme ohne eigene Buchung
    const uebernommen = await legacy.takeOverLegacyItem(actor, rechnung);
    expect(await sql`select 1 from journal_entries where source_type = 'invoice' and source_id = ${uebernommen.id}`).toHaveLength(0);
    await sql`update contacts set debitor_nr = 10001 where id = (select contact_id from invoices where id = ${uebernommen.id})`;
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: year, bestaetigt: true }, new Date());

    // Der Kunde zahlt die ganze übernommene Rechnung
    const date = `${year}-02-10`;
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([[date, date, "Gebucht", "Nordwerk GmbH", "Nordlicht GmbH", "RE-7", "Eingang", "DE02100100100006820101", "1190,00", "", "", ""]]),
        filename: "zahlung.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions where purpose = 'RE-7'`;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: uebernommen.id, amount: 119_000 });

    const result = await datev.datevExport(year, new Date(), { id: actor, role: "inhaber" });
    const bookings = parseDatevBuchungsstapel(result.bytes).bookings;
    const saldo = (konto: string) => bookings.reduce((sum, b) => sum + (b.account === konto ? b.amount : 0) - (b.contraAccount === konto ? b.amount : 0), 0);
    // Bezahlt ist bezahlt: weder der Debitor noch das Sammelkonto behält einen offenen Posten
    expect({ debitor: saldo("10001"), sammelkonto: saldo(k.forderungen) }).toEqual({ debitor: 0, sammelkonto: 0 });
  });
});
