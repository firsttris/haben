import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Fremdes Bankkonto ausschließen (#462): Ein Konto, das nicht zu dieser Firma gehört (etwa das Konto einer zweiten Firma
 * aus demselben Bankzugang), lässt sich ausschließen, solange keiner seiner Umsätze zugeordnet, verrechnet oder ausgebucht
 * ist. Danach ist es ausgeblendet; Import und Abruf nehmen es nicht mehr an. Gelöscht wird nichts, der Schritt steht im
 * Änderungsprotokoll. Eine Zuordnung, die gleichzeitig läuft, und die Ausschluss-Regel selbst sichert die Datenbank ab.
 */

function dkbCsv(iban: string, rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"${iban}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [
        date,
        date,
        "Gebucht",
        amount.startsWith("-") ? "Nordlicht" : name,
        amount.startsWith("-") ? name : "Nordlicht",
        purpose,
        amount.startsWith("-") ? "Ausgang" : "Eingang",
        "",
        amount,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

const EIGENES = "DE12 1203 0000 1234 5678 90";
const FREMDES = "DE89 3704 0044 0532 0130 00";

describe.skipIf(!testDatabaseUrl)("Fremdes Bankkonto ausschließen (Postgres, #462)", () => {
  let bank: typeof import("./index.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let exporter: typeof import("../archiv/export.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    exporter = await import("../archiv/export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate bank_neutralizations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR03', 'ist')`;
  });

  async function konto(iban: string, rows: [string, string, string, string][]) {
    return bank.importStatement(actor, dkbCsv(iban, rows), null);
  }

  const umsatz = async (cents: number, accountId: string) => {
    const [row] = await sql`select id from bank_transactions where amount = ${cents} and bank_account_id = ${accountId}`;
    return row!.id as string;
  };

  it("schließt ein Konto ohne Zuordnung aus: ausgeblendet, nichts gelöscht, im Änderungsprotokoll", async () => {
    const eigenes = await konto(EIGENES, [["01.10.26", "Kunde A", "Rechnung", "100,00"]]);
    const fremdes = await konto(FREMDES, [["02.10.26", "Kunde B", "Rechnung", "200,00"]]);
    expect((await bank.listAccounts()).map((a) => a.id).sort()).toEqual([eigenes.accountId, fremdes.accountId].sort());

    await bank.excludeAccount(actor, fremdes.accountId);

    expect((await bank.listAccounts()).map((a) => a.id)).toEqual([eigenes.accountId]);
    expect((await bank.listExcludedAccounts()).map((a) => [a.id, a.transactionCount])).toEqual([[fremdes.accountId, 1]]);
    expect((await bank.ownAccounts()).map((a) => a.id)).toEqual([eigenes.accountId]);
    // Nichts wurde gelöscht
    const [n] = await sql`select count(*)::int as n from bank_transactions where bank_account_id = ${fremdes.accountId}`;
    expect(n?.n).toBe(1);
    const [audit] =
      await sql`select actor, old_value, new_value from audit_log where table_name = 'bank_accounts' and action = 'UPDATE' order by id desc limit 1`;
    expect(audit?.actor).toBe(actor);
    expect(audit?.old_value.excluded_at).toBeNull();
    expect(audit?.new_value.excluded_at).not.toBeNull();
  });

  it("lehnt ab, wenn ein Umsatz des Kontos zugeordnet ist", async () => {
    const fremdes = await konto(FREMDES, [["02.10.26", "Sparkasse", "Gebühr", "-5,00"]]);
    await bank.allocate(actor, { kind: "gebuehren", transactionId: await umsatz(-500, fremdes.accountId), amount: -500 });
    await expect(bank.excludeAccount(actor, fremdes.accountId)).rejects.toThrow(/zugeordnet/);
    expect((await bank.listAccounts()).map((a) => a.id)).toEqual([fremdes.accountId]);
  });

  it("lehnt ab, wenn ein Umsatz des Kontos verrechnet ist", async () => {
    const fremdes = await konto(FREMDES, [
      ["14.10.26", "PAYPAL *EBAY DE", "Kartenpruefung", "-1,00"],
      ["15.10.26", "PAYPAL *EBAY DE", "Rueckbuchung", "1,00"],
    ]);
    await bank.neutralizeTransactions(actor, {
      transactionId: await umsatz(-100, fremdes.accountId),
      counterTransactionId: await umsatz(100, fremdes.accountId),
      note: "Kartenprüfung",
    });
    await expect(bank.excludeAccount(actor, fremdes.accountId)).rejects.toThrow(/verrechnet/);
  });

  it("lehnt ab, wenn der Umsatz eine aufgehobene Zuordnung hatte: die Zeilen bleiben im Protokoll", async () => {
    const fremdes = await konto(FREMDES, [["02.10.26", "Sparkasse", "Gebühr", "-5,00"]]);
    const id = await umsatz(-500, fremdes.accountId);
    await bank.allocate(actor, { kind: "gebuehren", transactionId: id, amount: -500 });
    const [zeile] = await sql`select id from allocations where transaction_id = ${id}`;
    await bank.reverseAllocation(actor, zeile!.id);
    // Zuordnung und Gegenzeile stehen im Protokoll, auch wenn der Umsatz wieder offen ist
    await expect(bank.excludeAccount(actor, fremdes.accountId)).rejects.toThrow(/zugeordnet/);
  });

  it("lehnt einen Zahlungsdienstleister und ein unbekanntes Konto ab", async () => {
    await sql`insert into bank_accounts (id, name, purpose, provider, ledger_index) values ('11111111-1111-4111-8111-111111111111', 'PayPal', 'zahlungsdienstleister', 'paypal', 1)`;
    await expect(bank.excludeAccount(actor, "11111111-1111-4111-8111-111111111111")).rejects.toThrow(/Zahlungsdienstleister/);
    await expect(bank.excludeAccount(actor, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/nicht gefunden/);
    // Auch die Datenbank lehnt es ab, wenn jemand am Server vorbei schreibt
    await expect(sql`update bank_accounts set excluded_at = now() where id = '11111111-1111-4111-8111-111111111111'`).rejects.toThrow(/Zahlungsdienstleister/);
  });

  it("nimmt auf einem ausgeschlossenen Konto keinen Import an, weder über die IBAN noch mit gewähltem Konto", async () => {
    const fremdes = await konto(FREMDES, [["02.10.26", "Kunde B", "Rechnung", "200,00"]]);
    await bank.excludeAccount(actor, fremdes.accountId);
    const neu = dkbCsv(FREMDES, [["03.10.26", "Kunde C", "Rechnung", "50,00"]]);
    await expect(bank.importStatement(actor, neu, null)).rejects.toThrow(/ausgeschlossen/);
    await expect(bank.importStatement(actor, neu, fremdes.accountId)).rejects.toThrow(/ausgeschlossen/);
    await expect(bank.createAccount(actor, { name: "Fremd", iban: FREMDES.replace(/ /g, ""), purpose: "geschaeft" })).rejects.toThrow(
      /ausgeschlossen|gibt es schon/,
    );
    const [n] = await sql`select count(*)::int as n from bank_transactions where bank_account_id = ${fremdes.accountId}`;
    expect(n?.n).toBe(1);
  });

  it("ordnet einen Umsatz eines ausgeschlossenen Kontos auch am Server vorbei nicht mehr zu", async () => {
    const fremdes = await konto(FREMDES, [["02.10.26", "Sparkasse", "Gebühr", "-5,00"]]);
    const id = await umsatz(-500, fremdes.accountId);
    await bank.excludeAccount(actor, fremdes.accountId);
    // Die Meldung der Datenbank steckt in der Ursache des Fehlers der Abfrage
    const fehler = await bank.allocate(actor, { kind: "gebuehren", transactionId: id, amount: -500 }).then(
      () => null,
      (e: Error & { cause?: Error }) => `${e.message} ${e.cause?.message ?? ""}`,
    );
    expect(fehler).toMatch(/ausgeschlossen/);
    const [n] = await sql`select count(*)::int as n from allocations`;
    expect(n?.n).toBe(0);
  });

  it("nimmt ein Konto wieder auf: sichtbar, der Import geht weiter in dasselbe Konto", async () => {
    const fremdes = await konto(FREMDES, [["02.10.26", "Kunde B", "Rechnung", "200,00"]]);
    await bank.excludeAccount(actor, fremdes.accountId);
    await bank.includeAccount(actor, fremdes.accountId);
    expect((await bank.listAccounts()).map((a) => a.id)).toEqual([fremdes.accountId]);
    expect(await bank.listExcludedAccounts()).toEqual([]);
    const again = await bank.importStatement(actor, dkbCsv(FREMDES, [["03.10.26", "Kunde C", "Rechnung", "50,00"]]), null);
    expect(again).toMatchObject({ accountId: fremdes.accountId, added: 1 });
  });

  it("schließt ein Konto nicht zweimal aus und nimmt eines, das nicht ausgeschlossen ist, nicht auf", async () => {
    const eigenes = await konto(EIGENES, [["01.10.26", "Kunde A", "Rechnung", "100,00"]]);
    await expect(bank.includeAccount(actor, eigenes.accountId)).rejects.toThrow(/nicht ausgeschlossen/);
    await bank.excludeAccount(actor, eigenes.accountId);
    await expect(bank.excludeAccount(actor, eigenes.accountId)).rejects.toThrow(/schon ausgeschlossen/);
  });

  it("fehlt nach dem Ausschluss in der Vorprüfung der Voranmeldung, in der Jahresauswahl und im Archiv; das eigene Konto bleibt", async () => {
    const oktober = { year: 2026, month: 10 } as const;
    await konto(EIGENES, [["05.10.26", "Telekom", "Telefon", "-20,00"]]);
    const fremdes = await konto(FREMDES, [
      ["06.10.26", "Zweitfirma GmbH", "Material", "-300,00"],
      ["07.10.26", "Kunde der Zweitfirma", "Rechnung", "900,00"],
    ]);
    const preflight = async () => (await figures.preflight(oktober, await figures.computeVatFigures(oktober))).map((i) => i.text);
    expect(await preflight()).toEqual([
      expect.stringContaining("2 Ausgaben im Zeitraum ohne Beleg"),
      expect.stringContaining("1 Zahlungseingang im Zeitraum noch nicht zugeordnet"),
    ]);

    await bank.excludeAccount(actor, fremdes.accountId);

    expect(await preflight()).toEqual([expect.stringContaining("1 Ausgabe im Zeitraum ohne Beleg")]);
    expect(await reports.reportYears()).toContain(2026);
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-10-20T10:00:00Z"))) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const paths = Object.keys(files).filter((p) => p.startsWith("bank/") && p.endsWith("umsaetze.csv"));
    expect(paths).toEqual([`bank/${EIGENES.replace(/ /g, "")}/umsaetze.csv`]);
    expect(Object.keys(files).some((p) => p.includes(FREMDES.replace(/ /g, "")))).toBe(false);
    expect(new TextDecoder().decode(files["bank/importe.csv"])).not.toContain(FREMDES.replace(/ /g, ""));

    // Wieder aufgenommen, ist alles wie vorher da
    await bank.includeAccount(actor, fremdes.accountId);
    expect(await preflight()).toEqual([
      expect.stringContaining("2 Ausgaben im Zeitraum ohne Beleg"),
      expect.stringContaining("1 Zahlungseingang im Zeitraum noch nicht zugeordnet"),
    ]);
  });

  it("Ausschluss und gleichzeitige Zuordnung: höchstens eines von beiden gelingt", async () => {
    for (let i = 0; i < 6; i++) {
      await sql`truncate bank_neutralizations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries cascade`;
      const fremdes = await konto(FREMDES, [["02.10.26", "Sparkasse", "Gebühr", "-5,00"]]);
      const id = await umsatz(-500, fremdes.accountId);
      const [ausschluss, zuordnung] = await Promise.allSettled([
        bank.excludeAccount(actor, fremdes.accountId),
        bank.allocate(actor, { kind: "gebuehren", transactionId: id, amount: -500 }),
      ]);
      expect([ausschluss.status, zuordnung.status].filter((s) => s === "fulfilled").length, `Durchlauf ${i}`).toBeLessThanOrEqual(1);
      const [a] = await sql`select excluded_at from bank_accounts where id = ${fremdes.accountId}`;
      const [z] = await sql`select count(*)::int as n from allocations`;
      // Nie beides: ausgeschlossen und zugeordnet
      expect(a?.excluded_at !== null && (z?.n ?? 0) > 0, `Durchlauf ${i}: ausgeschlossen und zugeordnet`).toBe(false);
    }
  });
});
