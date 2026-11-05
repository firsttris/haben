import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Dauerbelege (Roadmap Platz 8): Büromiete mit Mietvertrag als Beleg, 1.000 € netto zuzüglich 19 % (der Vermieter hat
 * nach § 9 UStG zur Umsatzsteuer optiert, der Vertrag weist sie aus), monatlich zum Monatsletzten. Der Lauf legt Belege
 * „Zu prüfen“ an, gebucht wird erst auf Klick; je Vorlage und Monat höchstens einer.
 */

const KONTEN = {
  SKR03: { aufwand: "4900", vorsteuer: "1576", verbindlichkeiten: "1600", bank: "1200" },
  SKR04: { aufwand: "6300", vorsteuer: "1406", verbindlichkeiten: "3300", bank: "1800" },
} as const;

const vertrag = (text = "Mietvertrag Büro Hafenstraße") => ({ bytes: new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`), filename: "mietvertrag.pdf" });

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("Dauerbelege (Postgres)", () => {
  let dauer: typeof import("./dauerbelege.ts");
  let lauf: typeof import("./dauerbelege-lauf.ts");
  let documents: typeof import("./documents.ts");
  let bank: typeof import("../bank/bank.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    dauer = await import("./dauerbelege.ts");
    lauf = await import("./dauerbelege-lauf.ts");
    documents = await import("./documents.ts");
    bank = await import("../bank/bank.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04" = "SKR03", versteuerung: "ist" | "soll" = "ist", kleinunternehmer = false) {
    await sql`truncate document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      journal_lines, journal_entries, document_splits, document_amounts, documents, recurring_documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  const miete = (overrides: Partial<import("./dauerbelege.ts").DauerbelegInput> = {}) => ({
    name: "Büromiete Hafenstraße",
    supplierName: "Hafen Immobilien GmbH",
    supplierUstId: "DE 811 907 980",
    reference: "MV-2026-17",
    category: "sonstiges" as const,
    payment: "bank" as const,
    amounts: [{ taxRate: 1900 as const, net: 100_000, tax: 19_000 }],
    taxShown: true,
    note: "",
    intervalMonths: 1 as const,
    nextDate: "2026-08-31",
    endDate: null,
    dueDays: 3,
    ...overrides,
  });

  const belege = (vorlageId: string) =>
    sql`select id, document_date::text, due_date::text, recurring_period::text, status, gross, sha256, invoice_number, supplier_ust_id
      from documents where recurring_document_id = ${vorlageId} order by recurring_period`;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      const k = KONTEN[kontenrahmen];
      it(`${kontenrahmen}, ${versteuerung}: legt verpasste Termine „Zu prüfen“ an, im Bankabgleich gebucht und zugeordnet`, async () => {
        await reset(kontenrahmen, versteuerung);
        const vorlage = await dauer.createDauerbeleg(actor, miete(), vertrag());
        expect(await lauf.runDueDauerbelege("2026-11-05")).toEqual({ created: 3, errors: [] });

        const rows = await belege(vorlage.id);
        // Monatsletzter: 31.08., 30.09., 31.10.; fällig drei Tage später
        expect(rows.map((r) => [r.document_date, r.due_date, r.recurring_period, r.status, r.gross])).toEqual([
          ["2026-08-31", "2026-09-03", "2026-08-01", "neu", 119_000],
          ["2026-09-30", "2026-10-03", "2026-09-01", "neu", 119_000],
          ["2026-10-31", "2026-11-03", "2026-10-01", "neu", 119_000],
        ]);
        // Der Vertrag ist die Datei jedes Belegs; Vertragsnummer als Rechnungsnummer
        expect(new Set(rows.map((r) => r.sha256))).toEqual(new Set([vorlage.sha256]));
        expect(rows[0]!.invoice_number).toBe("MV-2026-17");
        expect(rows[0]!.supplier_ust_id).toBe("DE811907980");
        const [stand] = await sql`select next_date::text, status from recurring_documents where id = ${vorlage.id}`;
        expect({ ...stand }).toEqual({ next_date: "2026-11-30", status: "aktiv" });

        // Nichts gebucht: keine Vorsteuer, kein offener Posten
        expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
        expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([]);

        // Abbuchung der Septembermiete: Haben schlägt die ungebuchten Belege vor, ein Klick bucht und ordnet zu
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([
              [
                "01.10.26",
                "01.10.26",
                "Gebucht",
                "Testfirma",
                "Hafen Immobilien GmbH",
                "Miete MV-2026-17",
                "Ausgang",
                "DE02100100100006820101",
                "-1.190,00",
                "",
                "",
                "",
              ],
            ]),
            filename: "konto.csv",
          },
          null,
        );
        const [transaction] = await sql`select id from bank_transactions`;
        const detail = (await bank.transactionDetail(transaction!.id as string))!;
        expect(detail.dauerbelege.map((s) => s.item.id).sort()).toEqual(rows.map((r) => r.id).sort());
        const september = rows[1]!.id as string;
        await lauf.bookAndAllocateDauerbeleg(actor, { documentId: september, transactionId: transaction!.id as string });

        const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
          where e.source_type = 'document' and e.source_id = ${september} order by l.account`;
        expect(lines.map((l) => ({ ...l }))).toEqual(
          [
            { account: k.aufwand, debit: 100_000, credit: 0 },
            { account: k.vorsteuer, debit: 19_000, credit: 0 },
            { account: k.verbindlichkeiten, debit: 0, credit: 119_000 },
          ].sort((a, b) => a.account.localeCompare(b.account)),
        );
        // Vorsteuer im Monat des Belegdatums, bei Ist und Soll
        expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(19_000);
        const allocations = await sql`select document_id, amount from allocations`;
        expect(allocations.map((a) => ({ ...a }))).toEqual([{ document_id: september, amount: -119_000 }]);
        expect((await bank.transactionDetail(transaction!.id as string))!.dauerbelege).toEqual([]);

        // Gebucht ist gesperrt wie jeder Beleg
        await expect(sql`update documents set recurring_period = '2026-12-01' where id = ${september}`).rejects.toThrow();
      });
    }
  }

  it("Kleinunternehmer: Steuer wird Teil des Aufwands, keine Vorsteuer", async () => {
    await reset("SKR03", "ist", true);
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-10-31" }), vertrag());
    await lauf.runDueDauerbelege("2026-11-05");
    const [beleg] = await belege(vorlage.id);
    await documents.bookDocument(actor, beleg!.id as string);
    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l order by l.account`;
    expect(lines.map((l) => ({ ...l }))).toEqual([
      { account: "1600", debit: 0, credit: 119_000 },
      { account: "4900", debit: 119_000, credit: 0 },
    ]);
  });

  it("je Vorlage und Monat höchstens ein Beleg, auch bei gleichzeitigen Läufen und nach einem Neustart", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-01-31" }), vertrag());
    const results = await Promise.all([lauf.runDueDauerbelege("2026-11-05"), lauf.runDueDauerbelege("2026-11-05"), lauf.runDueDauerbelege("2026-11-05")]);
    expect(results.reduce((s, r) => s + r.created, 0)).toBe(10);
    expect(await belege(vorlage.id)).toHaveLength(10);
    // Wer den nächsten Termin zurücksetzt (anderer Tag im selben Monat), bekommt keinen zweiten Beleg für den Monat
    await dauer.updateDauerbeleg(actor, vorlage.id, miete({ nextDate: "2026-10-15" }), null);
    expect(await lauf.runDueDauerbelege("2026-11-05")).toEqual({ created: 0, errors: [] });
    expect(await belege(vorlage.id)).toHaveLength(10);
    const [stand] = await sql`select next_date::text from recurring_documents where id = ${vorlage.id}`;
    expect(stand!.next_date).toBe("2026-11-15");
  });

  it("Änderungen gelten nur für künftige Belege; ein neuer Vertrag nur für die künftigen", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-09-30" }), vertrag());
    await lauf.runDueDauerbelege("2026-10-05");
    const vorher = await belege(vorlage.id);
    await dauer.updateDauerbeleg(
      actor,
      vorlage.id,
      miete({ nextDate: "2026-10-31", amounts: [{ taxRate: 1900, net: 110_000, tax: 20_900 }] }),
      vertrag("Nachtrag Mieterhöhung"),
    );
    await lauf.runDueDauerbelege("2026-11-05");
    const nachher = await belege(vorlage.id);
    expect(nachher.map((r) => [r.document_date, r.gross])).toEqual([
      ["2026-09-30", 119_000],
      ["2026-10-31", 130_900],
    ]);
    expect(nachher[0]!.sha256).toBe(vorher[0]!.sha256);
    expect(nachher[1]!.sha256).not.toBe(vorher[0]!.sha256);
    const [amount] = await sql`select net, tax from document_amounts where document_id = ${nachher[0]!.id}`;
    expect({ ...amount }).toEqual({ net: 100_000, tax: 19_000 });
  });

  it("Pausieren, Fortsetzen ohne die Termine der Pause, Beenden; Ende per Datum", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-06-01" }), vertrag());
    await lauf.runDueDauerbelege("2026-06-02");
    await dauer.setDauerbelegStatus(actor, vorlage.id, "pausieren", "2026-06-10");
    expect(await lauf.runDueDauerbelege("2026-09-15")).toEqual({ created: 0, errors: [] });
    const fortgesetzt = await dauer.setDauerbelegStatus(actor, vorlage.id, "fortsetzen", "2026-09-15");
    expect(fortgesetzt.nextDate).toBe("2026-10-01");
    await lauf.runDueDauerbelege("2026-10-01");
    expect((await belege(vorlage.id)).map((r) => r.document_date)).toEqual(["2026-06-01", "2026-10-01"]);
    await expect(dauer.setDauerbelegStatus(actor, vorlage.id, "fortsetzen", "2026-10-02")).rejects.toThrow("läuft schon");

    await dauer.setDauerbelegStatus(actor, vorlage.id, "beenden", "2026-10-02");
    expect(await lauf.runDueDauerbelege("2026-12-15")).toEqual({ created: 0, errors: [] });
    await expect(dauer.updateDauerbeleg(actor, vorlage.id, miete(), null)).rejects.toThrow("beendet");

    // Mit Enddatum: der letzte Termin am Ende, danach beendet
    const befristet = await dauer.createDauerbeleg(actor, miete({ name: "Leasing", nextDate: "2026-09-15", endDate: "2026-10-15" }), vertrag("Leasing"));
    await lauf.runDueDauerbelege("2026-12-01");
    expect((await belege(befristet.id)).map((r) => r.document_date)).toEqual(["2026-09-15", "2026-10-15"]);
    const [stand] = await sql`select status from recurring_documents where id = ${befristet.id}`;
    expect(stand!.status).toBe("beendet");
  });

  it("Vorsteuer nur mit Dokument mit Steuerausweis, sonst 0 %", async () => {
    await reset();
    await expect(dauer.createDauerbeleg(actor, miete({ taxShown: false }), vertrag())).rejects.toThrow(/gesondert ausweist/);
    const versicherung = await dauer.createDauerbeleg(
      actor,
      miete({ name: "Betriebshaftpflicht", category: "versicherung", taxShown: false, intervalMonths: 12, amounts: [{ taxRate: 0, net: 45_000, tax: 0 }] }),
      vertrag("Police"),
    );
    await lauf.runDueDauerbelege("2026-09-01");
    const [beleg] = await belege(versicherung.id);
    expect(beleg!.gross).toBe(45_000);
    const [{ note }] = (await sql`select note from documents where id = ${beleg!.id}`) as unknown as [{ note: string }];
    expect(note).toMatch(/keine Umsatzsteuer aus/);
  });

  it("ohne Dokument kein Dauerbeleg; nur leere Vorlagen lassen sich löschen, der Vertrag bleibt für die Belege", async () => {
    await reset();
    await expect(dauer.createDauerbeleg(actor, miete(), { bytes: new Uint8Array(), filename: "leer.pdf" })).rejects.toThrow("leer");
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-10-31" }), vertrag());
    // Derselbe Vertrag lässt sich trotzdem als gewöhnlicher Beleg hochladen
    expect((await documents.uploadDocument(actor, vertrag())).duplicate).toBe(false);
    await lauf.runDueDauerbelege("2026-11-05");
    await expect(dauer.deleteDauerbeleg(actor, vorlage.id)).rejects.toThrow("Beende ihn");

    // Einen ungebuchten Beleg löschen: der Monat wird nicht neu angelegt, die Datei bleibt für die Vorlage
    const [beleg] = await belege(vorlage.id);
    await documents.deleteDocument(actor, beleg!.id as string);
    await lauf.runDueDauerbelege("2026-11-05");
    expect(await belege(vorlage.id)).toHaveLength(0);
    const { loadFile } = await import("../../storage.ts");
    expect((await loadFile(vorlage.sha256)).byteLength).toBeGreaterThan(0);

    const leer = await dauer.createDauerbeleg(actor, miete({ name: "Abo", nextDate: "2027-01-01" }), vertrag("Abo"));
    await dauer.deleteDauerbeleg(actor, leer.id);
    expect(await sql`select id from recurring_documents where id = ${leer.id}`).toHaveLength(0);
  });

  it("Monatsende bleibt Monatsende, auch wenn die Vorlage im Februar geändert wird", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2027-01-31" }), vertrag());
    await lauf.runDueDauerbelege("2027-02-01");
    const [stand] = await sql`select next_date::text from recurring_documents where id = ${vorlage.id}`;
    expect(stand!.next_date).toBe("2027-02-28");
    // Nur der Betrag ändert sich; das Formular schickt den nächsten Termin unverändert mit
    await dauer.updateDauerbeleg(actor, vorlage.id, miete({ nextDate: "2027-02-28", amounts: [{ taxRate: 1900, net: 110_000, tax: 20_900 }] }), null);
    await lauf.runDueDauerbelege("2027-04-01");
    expect((await belege(vorlage.id)).map((r) => r.document_date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("Buchen und zuordnen: scheitert die Zuordnung, bleibt der Beleg ungebucht", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete({ nextDate: "2026-10-31" }), vertrag());
    await lauf.runDueDauerbelege("2026-11-05");
    // Abbuchung über einen anderen Betrag (etwa nur die Nebenkosten); der Vorschlag war veraltet
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([["03.11.26", "03.11.26", "Gebucht", "Testfirma", "Hafen Immobilien GmbH", "Nebenkosten", "Ausgang", "DE02100100100006820101", "-300,00", "", "", ""]]),
        filename: "konto.csv",
      },
      null,
    );
    const [transaction] = await sql`select id from bank_transactions`;
    const [beleg] = await belege(vorlage.id);
    await expect(lauf.bookAndAllocateDauerbeleg(actor, { documentId: beleg!.id as string, transactionId: transaction!.id as string })).rejects.toThrow();
    const [nachher] = await sql`select status from documents where id = ${beleg!.id}`;
    expect(nachher!.status).toBe("neu");
    expect(await sql`select id from journal_entries`).toHaveLength(0);
  });

  it("jede Änderung an der Vorlage steht im Audit-Log", async () => {
    await reset();
    const vorlage = await dauer.createDauerbeleg(actor, miete(), vertrag());
    await dauer.setDauerbelegStatus(actor, vorlage.id, "pausieren", "2026-09-01");
    const log = await sql`select action, actor from audit_log where table_name = 'recurring_documents' and row_id = ${vorlage.id} order by id`;
    expect(log.map((l) => [l.action, l.actor])).toEqual([
      ["INSERT", actor],
      ["UPDATE", actor],
    ]);
  });
});
