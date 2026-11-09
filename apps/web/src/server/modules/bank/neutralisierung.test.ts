import type postgres from "postgres";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gegenläufige Bankumsätze verrechnen (#457): +1,00 € und −1,00 € einer Kartenprüfung bei PayPal heben sich auf. Sie
 * werden miteinander verrechnet und gelten als erledigt, ohne Buchung und ohne Wirkung auf Voranmeldung und EÜR. Die
 * Umsätze bleiben unverändert; die Verrechnung ist eine nur anhängbare Zeile mit Notiz und Eintrag im Änderungsprotokoll,
 * aufgehoben wird sie mit einer Gegenzeile. SKR03 und SKR04, Ist und Soll.
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

const GIRO = "DE12 1203 0000 1234 5678 90";
const ZWEITKONTO = "DE89 3704 0044 0532 0130 00";

describe.skipIf(!testDatabaseUrl)("Gegenläufige Bankumsätze verrechnen (Postgres, #457)", () => {
  let bank: typeof import("./index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let exporter: typeof import("../archiv/export.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    reports = await import("../auswertungen/reports.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    exporter = await import("../archiv/export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate bank_neutralizations, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung})`;
  }

  /** Kartenprüfung bei PayPal: −1,00 € und am Tag darauf +1,00 € zurück, dazu eine Bankgebühr, die offen bleibt */
  async function kartenpruefung() {
    await bank.importStatement(
      actor,
      dkbCsv(GIRO, [
        ["14.10.26", "PAYPAL *EBAY DE", "Kartenpruefung", "-1,00"],
        ["15.10.26", "PAYPAL *EBAY DE", "Rueckbuchung Kartenpruefung", "1,00"],
        ["16.10.26", "Sparkasse", "Kontofuehrung", "-9,90"],
      ]),
      null,
    );
    return { minus: await umsatz(-1_00), plus: await umsatz(1_00), gebuehr: await umsatz(-9_90) };
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;
  const kontoId = async () => (await sql<{ id: string }[]>`select id from bank_accounts where iban = ${GIRO.replace(/\s/g, "")}`)[0]!.id;
  const offeneIds = async () => (await bank.listTransactions(await kontoId(), "offen", "")).map((t) => t.id).sort();

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: verrechnet ohne Buchung und ohne Wirkung auf Voranmeldung und EÜR; Aufheben macht beide wieder offen", async (kr, versteuerung) => {
    await firma(kr, versteuerung);
    const { minus, plus, gebuehr } = await kartenpruefung();
    const oktober = { year: 2026, month: 10 } as const;
    const vorher = await figures.computeVatFigures(oktober);
    const euerVorher = await reports.euerForYear(2026);
    expect((await figures.preflight(oktober, vorher)).map((i) => i.text)).toEqual([
      "2 Ausgaben im Zeitraum ohne Beleg oder Zuordnung. Ohne Beleg wird keine Vorsteuer angesetzt.",
      expect.stringMatching(/^1 Zahlungseingang im Zeitraum noch nicht zugeordnet/),
    ]);

    await bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: plus, note: "PayPal-Autorisierung mit automatischer Rückbuchung" });

    // Beide erledigt, die Gebühr bleibt offen
    expect(await offeneIds()).toEqual([gebuehr]);
    const zugeordnet = await bank.listTransactions(await kontoId(), "zugeordnet", "");
    expect(zugeordnet.map((t) => [t.amount, t.open, t.neutralized]).sort()).toEqual([
      [-1_00, 0, true],
      [1_00, 0, true],
    ]);
    expect((await bank.listAccounts()).find((a) => a.iban === GIRO.replace(/\s/g, ""))?.openCount).toBe(1);
    expect((await bank.transactionDetail(plus))?.transaction.open).toBe(0);

    // Keine Buchung, keine Zuordnung: Voranmeldung und EÜR wie vorher, die Vorprüfung nennt nur noch die Gebühr
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from allocations`).toEqual([{ n: 0 }]);
    const nachher = await figures.computeVatFigures(oktober);
    expect(nachher).toEqual(vorher);
    expect(await reports.euerForYear(2026)).toEqual(euerVorher);
    expect((await figures.preflight(oktober, nachher)).map((i) => i.text)).toEqual([
      "1 Ausgabe im Zeitraum ohne Beleg oder Zuordnung. Ohne Beleg wird keine Vorsteuer angesetzt.",
    ]);

    // Die Umsätze selbst bleiben unverändert; die Verrechnung steht mit Notiz und Gegenumsatz an beiden
    expect(await sql`select amount, purpose from bank_transactions where id in ${sql([minus, plus])} order by amount`).toEqual([
      { amount: -1_00, purpose: "Kartenpruefung" },
      { amount: 1_00, purpose: "Rueckbuchung Kartenpruefung" },
    ]);
    const ansicht = await bank.neutralizationView(plus);
    expect(ansicht.active).toMatchObject({
      note: "PayPal-Autorisierung mit automatischer Rückbuchung",
      counterpart: { id: minus, amount: -1_00, bookingDate: "2026-10-14", counterpartyName: "PAYPAL *EBAY DE" },
    });
    expect(ansicht.candidates).toEqual([]);
    expect((await bank.neutralizationView(minus)).active?.counterpart.id).toBe(plus);

    // Nachweis im Änderungsprotokoll, nur anhängbar
    const [row] = await sql`select id from bank_neutralizations`;
    // Das Audit-Log wird zwischen den Tests nicht geleert: nur die Zeilen dieses Tests
    const log = await sql`select actor, action, new_value from audit_log where table_name = 'bank_neutralizations' and row_id = ${row!.id}::text`;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor, action: "INSERT", new_value: { note: "PayPal-Autorisierung mit automatischer Rückbuchung" } });
    await expect(sql`update bank_neutralizations set note = 'anders' where id = ${row!.id}`).rejects.toThrow();
    await expect(sql`delete from bank_neutralizations where id = ${row!.id}`).rejects.toThrow();

    // Ein verrechneter Umsatz lässt sich nicht zusätzlich zuordnen
    await expect(bank.allocate(actor, { kind: "gebuehren", transactionId: minus, amount: -1_00 })).rejects.toThrow(/offene Teil/);
    await expect(
      bank.allocateSplit(actor, {
        transactionId: plus,
        parts: [
          { kind: "privat", amount: 2_00 },
          { kind: "gebuehren", amount: -1_00 },
        ],
      }),
    ).rejects.toThrow(/ganz zugeordnet/);

    // Aufheben: Gegenzeile, beide wieder offen, Vorprüfung wie vorher; die aufgehobene bleibt sichtbar
    await bank.reverseNeutralization(actor, row!.id);
    expect(await offeneIds()).toEqual([gebuehr, minus, plus].sort());
    expect(await sql`select count(*)::int as n from bank_neutralizations`).toEqual([{ n: 2 }]);
    expect(
      await sql`select count(*)::int as n from audit_log where table_name = 'bank_neutralizations' and row_id in (select id::text from bank_neutralizations)`,
    ).toEqual([{ n: 2 }]);
    expect((await figures.preflight(oktober, await figures.computeVatFigures(oktober))).length).toBe(2);
    const aufgehoben = await bank.neutralizationView(plus);
    expect(aufgehoben.active).toBeNull();
    expect(aufgehoben.reversed).toMatchObject([{ note: "PayPal-Autorisierung mit automatischer Rückbuchung", counterpart: { id: minus } }]);
    expect(aufgehoben.candidates.map((c) => c.id)).toEqual([minus]);
    await expect(bank.reverseNeutralization(actor, row!.id)).rejects.toThrow(/bereits aufgehoben/);

    // Danach wieder verrechenbar oder zuordenbar
    await bank.allocate(actor, { kind: "gebuehren", transactionId: minus, amount: -1_00 });
    expect((await bank.transactionDetail(minus))?.transaction.open).toBe(0);
  });

  it("lehnt ab, was sich nicht aufhebt oder schon erledigt ist", async () => {
    await firma("SKR03", "ist");
    const { minus, plus, gebuehr } = await kartenpruefung();
    await bank.importStatement(
      actor,
      dkbCsv(ZWEITKONTO, [
        ["15.10.26", "PAYPAL *EBAY DE", "Rueckbuchung", "1,00"],
        ["17.10.26", "Kunde", "Eingang", "9,90"],
      ]),
      null,
    );
    const anderesKonto = (
      await sql<{ id: string }[]>`select t.id from bank_transactions t join bank_accounts a on a.id = t.bank_account_id
      where a.iban = ${ZWEITKONTO.replace(/\s/g, "")} and t.amount = 100`
    )[0]!.id;
    const note = "Kartenprüfung";

    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: minus, note })).rejects.toThrow(/zwei verschiedene/);
    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: gebuehr, note })).rejects.toThrow(/heben sich nicht auf/);
    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: anderesKonto, note })).rejects.toThrow(/selben Konto/);
    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: plus, note: "  " })).rejects.toThrow(/Notiz/);

    // Teilweise oder ganz zugeordnet: erst die Zuordnung aufheben
    await bank.allocate(actor, { kind: "privat", transactionId: plus, amount: 50 });
    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: plus, note })).rejects.toThrow(/zugeordnet/);
    const [teil] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, teil!.id);
    // Nach dem Aufheben der Zuordnung geht es
    await bank.neutralizeTransactions(actor, { transactionId: plus, counterTransactionId: minus, note });

    // Ein Umsatz steckt höchstens in einer gültigen Verrechnung
    await bank.importStatement(actor, dkbCsv(GIRO, [["20.10.26", "PAYPAL *EBAY DE", "Kartenpruefung 2", "1,00"]]), null);
    const zweite = (await sql<{ id: string }[]>`select id from bank_transactions where purpose = 'Kartenpruefung 2'`)[0]!.id;
    await expect(bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: zweite, note })).rejects.toThrow(/schon verrechnet/);
    expect(await sql`select count(*)::int as n from bank_neutralizations`).toEqual([{ n: 1 }]);
  });

  it("der Datenbank-Trigger prüft ein zweites Mal: Summe null, ein Konto, offen, höchstens einmal gültig", async () => {
    await firma("SKR04", "soll");
    const { minus, plus, gebuehr } = await kartenpruefung();
    const insert = (a: string, b: string) => sql`insert into bank_neutralizations (transaction_id, counter_transaction_id, note, created_by)
      values (${a}, ${b}, 'direkt', ${actor})`;
    await expect(insert(minus, gebuehr)).rejects.toThrow(/heben sich nicht auf/);
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', ${actor}, true)`;
      await tx`insert into bank_neutralizations (transaction_id, counter_transaction_id, note, created_by) values (${minus}, ${plus}, 'direkt', ${actor})`;
    });
    await expect(insert(plus, minus)).rejects.toThrow(/schon verrechnet/);
    const [row] = await sql`select id from bank_neutralizations`;
    // Gegenzeile nur mit denselben Umsätzen und nur einmal
    const reverse = (a: string, b: string) => sql`insert into bank_neutralizations (transaction_id, counter_transaction_id, note, reverses_id, created_by)
      values (${a}, ${b}, '', ${row!.id}, ${actor})`;
    await expect(reverse(minus, gebuehr)).rejects.toThrow(/dieselben Umsätze/);
    await reverse(minus, plus);
    await expect(reverse(minus, plus)).rejects.toThrow();
  });

  it("Datenexport: verrechnete Umsätze sind nicht offen, die Verrechnungen stehen in einer eigenen Datei", async () => {
    await firma("SKR03", "soll");
    const { minus, plus } = await kartenpruefung();
    await bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: plus, note: "Kartenprüfung" });
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-10-20T10:00:00Z"))) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const text = (name: string) => new TextDecoder().decode(files[name]);
    const umsaetze = text(`bank/${GIRO.replace(/\s/g, "")}/umsaetze.csv`).split("\r\n");
    expect(umsaetze[0]).toContain(";Zugeordnet;Offen;Verrechnet;");
    expect(umsaetze.find((l) => l.includes(";-1,00;"))).toContain(";0,00;0,00;ja;");
    expect(umsaetze.find((l) => l.includes(";-9,90;"))).toContain(";0,00;-9,90;nein;");
    const verrechnungen = text("bank/verrechnungen.csv").split("\r\n");
    expect(verrechnungen[0]).toBe(
      "Konto;Buchungsdatum;Betrag;Gegenumsatz Buchungsdatum;Gegenumsatz Betrag;Notiz;Hebt auf;Angelegt;Umsatz-ID;Gegenumsatz-ID;Verrechnungs-ID",
    );
    expect(verrechnungen[1]).toMatch(/^DE12120300001234567890;2026-10-1[45];-?1,00;2026-10-1[45];-?1,00;Kartenprüfung;;/);
    expect(text("LIESMICH.txt")).toContain("bank/verrechnungen.csv");
  });

  it("Datenexport mit mehr als 32.767 Umsätzen im Jahr: die Verrechnungen sprengen nicht die Grenze von 65.535 Parametern", async () => {
    // Ein Zahlungsdienstleister bringt je Verkauf Brutto und Gebühr; 33.000 Umsätze sind ein Shop mit rund 16.500 Verkäufen im Jahr
    await firma("SKR04", "ist");
    const { minus, plus } = await kartenpruefung();
    await bank.neutralizeTransactions(actor, { transactionId: minus, counterTransactionId: plus, note: "Kartenprüfung" });
    await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
      select bank_account_id, import_id, booking_date, 100, 'Verkauf', 'masse-' || g from bank_transactions, generate_series(1, 33000) g where id = ${minus}`;
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-10-20T10:00:00Z"))) chunks.push(chunk);
    const verrechnungen = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["bank/verrechnungen.csv"]).split("\r\n");
    expect(verrechnungen[1]).toContain(";Kartenprüfung;");
  }, 120_000);
});
