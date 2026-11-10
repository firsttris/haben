import { strToU8, zipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Der Test baut einen Export nach, wie ihn Accountable liefert: äußerer ZIP mit `datev_skr03_…/EXTF…csv`, `…/Belege.zip`
 * und `PDF/Einkäufe/…`. Alle Namen und Beträge sind erfunden. Geprüft werden Idempotenz (zweiter Lauf doppelt nichts) und
 * die Zählung: Buchung mit Datei, Buchung ohne Beleglink, Privatzeile, Ausgangsrechnung und eine zweite Buchung auf
 * denselben Beleg (dieselbe GUID).
 */

const KOPF =
  '"EXTF";700;21;"Buchungsstapel";9;20261110112213284;"";"AC";"Test";"";"9999999";"12345";20250101;4;"20250101";"20251231";"Accountable-Export Test";"SW";1;';
const SPALTEN =
  "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Beleglink";

const zeile = (betrag: string, seite: string, gegen: string, bu: string, ttmm: string, nr: string, beleg2: string, text: string, link = "") =>
  [betrag, seite, "EUR", "", betrag, "EUR", "1200", gegen, bu, ttmm, nr, beleg2, "", text, link].join(";");

const BUCHUNGEN = [
  // Mit Belegdatei und 19 % (Brutto im Stapel)
  zeile("92,81", "H", "4806", "9", "0601", "06012025_9281", "06012025", "ER Beispiel Hosting GmbH", '"BEDI ""guid-hosting"""'),
  // Ohne Beleglink: bleibt offener Posten
  zeile("10,00", "H", "4964", "506", "0101", "01012025_1000", "01012025", "ER Beispiel Software AG"),
  // Privatzeile: legt nichts an
  zeile("271,40", "H", "1801", "", "1903", "19032025_27140", "19032025", "ER Beispiel Fachmarkt"),
  // Ausgangsrechnung: wird nur gezählt
  zeile("833,00", "S", "8400", "", "1211", "2025-001", "06112025", "AR Beispiel Kunde GmbH"),
  // Zweite Buchung auf denselben Beleg (eine Aufteilung), dieselbe GUID
  zeile("5,00", "H", "4930", "9", "0601", "06012025_500", "06012025", "ER Beispiel Hosting GmbH (Bürobedarf)", '"BEDI ""guid-hosting"""'),
];

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://xml.datev.de/bedi/tps/document/v04.0" generatingSystem="Accountable" version="4.0">
  <content>
    <document type="1" processID="1" guid="guid-hosting">
      <extension xsi:type="File" name="beleg-hosting.pdf"/>
    </document>
  </content>
</archive>`;

/** `guid`: echte Exporte tragen eine UUID; die übrigen Tests bleiben beim lesbaren Platzhalter */
function export_(guid = "guid-hosting", ordner = "datev_skr03_10112026"): Uint8Array {
  const belege = zipSync({ "document.xml": strToU8(XML.replace("guid-hosting", guid)), "beleg-hosting.pdf": strToU8("%PDF-1.4\n% Beleg Test\n%%EOF\n") });
  return zipSync({
    [`${ordner}/EXTF_Buchungsstapel_2025Test.csv`]: strToU8([KOPF, SPALTEN, ...BUCHUNGEN].join("\n").replaceAll("guid-hosting", guid)),
    [`${ordner}/Belege.zip`]: belege,
    "PDF/Einkäufe/beleg-hosting_Wdn.pdf": strToU8("%PDF-1.4\n% Beleg Test\n%%EOF\n"),
  });
}

describe.skipIf(!testDatabaseUrl)("Accountable-Import (Postgres)", () => {
  let accountable: typeof import("./accountable.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    accountable = await import("./accountable.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    // Gebuchte Belege sind gesperrt (Trigger); der Test löscht per Trigger-Bypass, damit jeder Fall frisch startet
    // audit_log und audit_chain bleiben: die Hash-Kette bricht sonst, und das Siegel hängt daran
    for (const table of [
      "journal_lines",
      "journal_entries",
      "seals",
      "document_amounts",
      "documents",
      "lexoffice_voucher_files",
      "lexoffice_vouchers",
      "lexoffice_imports",
      // vor archive_files: datev_bookings haengt per Fremdschluessel daran
      "datev_bookings",
      "archive_files",
    ]) {
      await sql.unsafe(`alter table ${table} disable trigger user`);
      await sql.unsafe(`delete from ${table}`);
      await sql.unsafe(`alter table ${table} enable trigger user`);
    }
  });

  it("analysiert den Export, ohne etwas zu schreiben", async () => {
    const analysis = accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    expect(analysis).toMatchObject({
      filename: "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip",
      year: 2025,
      bookings: 5,
      vouchers: 3,
      withFile: 2,
      withoutFile: 1,
      privateRows: 1,
      missingReceipts: 0,
      unknownTaxRows: 1,
    });
    expect(analysis.invoices.map((i) => i.number)).toEqual(["2025-001"]);
    const [row] = await sql`select count(*)::int as n from lexoffice_imports`;
    expect(row!.n).toBe(0);
  });

  it("übernimmt Buchungen als Belege, zählt Ausgangsrechnungen und Privatzeilen nur", async () => {
    const analysis = accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    expect(analysis.withoutFile).toBe(1);
    const id = await accountable.startAccountableImport(actor, { wait: true });
    const run = await accountable.accountableImportStatus(id);
    expect(run).toMatchObject({ status: "fertig", source: "accountable" });
    expect(run!.progress).toMatchObject({ listed: 3, imported: 2, skipped: 1, files: 1, failed: [] });
    expect(run!.accountable).toMatchObject({ privateRows: 1, withoutFile: 2, openItemCount: 2, archivedAlready: false });
    expect(run!.accountable!.note).toContain("1 Ausgangsrechnung(en) nicht angelegt");
    expect(run!.accountable!.note).toContain("1 Privat- bzw. Umbuchungszeile(n)");

    // Archivbelege: zwei Buchungen mit Beleg (eine mit Datei, eine ohne Beleglink), die zweite Buchung auf denselben Beleg bleibt Hinweis
    const vouchers =
      await sql`select id, lexoffice_id, number, net, tax, gross, taxes, raw from lexoffice_vouchers where source = 'accountable' order by date, number`;
    expect(vouchers).toHaveLength(2);
    expect(vouchers.map((v) => [v.lexoffice_id, v.gross])).toEqual([
      ["accountable/row/4", 1000],
      ["accountable/guid-hosting", 9281],
    ]);
    // 92,81 brutto bei 19 %: 78,00 netto, 14,81 Steuer (so rechnet der Mapper aus brutto)
    expect(vouchers[1]).toMatchObject({ net: 7799, tax: 1482, gross: 9281 });
    expect(vouchers[1]!.taxes).toEqual([{ rate: 1900, net: 7799, tax: 1482 }]);
    // Ohne Datei: als offener Posten markiert, kein Beleg-Kopf
    expect(vouchers[0]!.raw).toMatchObject({ ohneBeleg: true });
    // Die zweite Buchung auf denselben Beleg steht in der Meldung, nicht als eigener Archivbeleg
    expect(run!.accountable!.openItems.map((o) => o.reason)).toContain(
      "Buchung auf denselben Beleg wie accountable/guid-hosting; nicht als eigener Beleg angelegt",
    );

    const files = await sql`select f.filename, f.sha256, f.mime_type from lexoffice_voucher_files f`;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: "beleg-hosting.pdf", mime_type: "application/pdf" });

    // Kein Beleg in Haben: Accountable hat ihn bezahlt, er gehört ins Archiv und nicht in den Bankabgleich (Review #579).
    // Die Datei hängt am Archivbeleg.
    expect(await sql`select count(*)::int as n from documents`).toEqual([{ n: 0 }]);
    const [attached] = await sql`select v.lexoffice_id from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id`;
    expect(attached!.lexoffice_id).toBe("accountable/guid-hosting");

    // Der Export liegt im Archiv, das Jahr aus dem Stapel-Kopf
    const archived = await sql`select kind, year, filename, meta from archive_files where kind = 'datev'`;
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ year: 2025, filename: "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip" });
    expect(archived[0]!.meta).toMatchObject({ bookings: 5, dateFrom: "2025-01-01", dateTo: "2025-12-31" });
  });

  it("legt beim zweiten Lauf nichts doppelt an (GUID und sha256)", async () => {
    accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    await accountable.startAccountableImport(actor, { wait: true });
    accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    const id = await accountable.startAccountableImport(actor, { wait: true });
    const run = await accountable.accountableImportStatus(id);
    expect(run!.progress).toMatchObject({ listed: 3, imported: 0, skipped: 3, files: 0, failed: [] });
    // Die Analyse ist wieder da, der Export lag schon im Archiv
    expect(run!.accountable).toMatchObject({ withFile: 2, withoutFile: 1, archivedAlready: true });

    const counts = await sql`select
      (select count(*)::int from lexoffice_vouchers where source = 'accountable') as vouchers,
      (select count(*)::int from lexoffice_voucher_files) as files,
      (select count(*)::int from documents) as documents,
      (select count(*)::int from document_amounts) as amounts,
      (select count(*)::int from archive_files) as archived`;
    expect(counts[0]).toEqual({ vouchers: 2, files: 1, documents: 0, amounts: 0, archived: 1 });

    // Accountable bucht zahlungsbasiert: alles ist bezahlt, es gibt keine offenen Posten.
    // Übernommene Belege mit Restbetrag 0 gehören nicht in die Liste (`open > 0 || issue`).
    const open = await accountable.accountableOpenItems(id);
    expect(open).toEqual([]);
  });
  it("bereits bezahlte Accountable-Belege warten nicht im Bankabgleich (Review #579)", async () => {
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03') on conflict (id) do nothing`;
    const bank = await import("../bank/bank.ts");
    accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    await accountable.startAccountableImport(actor, { wait: true });
    // Accountable bucht zahlungsbasiert: Der Beleg ist dort bezahlt. Als offener Posten in Haben zöge er die nächste
    // Abbuchung über 92,81 € auf sich und buchte gegen eine Verbindlichkeit, die es nie gab.
    expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([]);
  });
  it("Abgleich: Erlös- und Privatzeilen aus dem Accountable-Stapel brauchen keinen Beleg (Review #579)", async () => {
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03') on conflict (id) do nothing`;
    const lexoffice = await import("./lexoffice.ts");
    accountable.analyseAccountableUpload(export_("3f2b8c1e-7d4a-4e9b-9c2f-1a6d5e8b0c47"), "Accountable_Max_Mustermann_skr03_2025-01-01_test.zip");
    await accountable.startAccountableImport(actor, { wait: true });
    const { years } = await lexoffice.reconciliation();
    // Hosting über Nummer und GUID, Software über die Nummer; Privatzeile 1801 und Ausgangsrechnung 8400 ohne Beleg
    expect(years.find((y) => y.year === 2025)!.bookings).toMatchObject({ total: 5, unmatched: 0 });
  });
  it("übernimmt die Buchungen eines Jahres nicht zweimal, wenn das Jahr schon einen Stapel hat (Review #579, Runde 2)", async () => {
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03') on conflict (id) do nothing`;
    const lexoffice = await import("./lexoffice.ts");
    accountable.analyseAccountableUpload(export_(), "Accountable_Max_Mustermann_skr03_2026-11-10_a.zip");
    await accountable.startAccountableImport(actor, { wait: true });
    // Ein zweiter Export desselben Jahres (in Accountable neu erstellt): andere Bytes, dieselben Buchungen
    accountable.analyseAccountableUpload(export_("guid-hosting", "datev_skr03_11112026"), "Accountable_Max_Mustermann_skr03_2026-11-11_b.zip");
    await accountable.startAccountableImport(actor, { wait: true });
    const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
    // Die Ausgangsrechnung über 833,00 € steht einmal im Jahr, nicht zweimal
    expect(year.einnahmen.gross).toBe(83300);
    expect(year.bookings!.total).toBe(5);
  });
});
