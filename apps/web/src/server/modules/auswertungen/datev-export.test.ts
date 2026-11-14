import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("DATEV-Export (Postgres)", () => {
  let datev: typeof import("./datev-export.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    ledger = await import("../buchhaltung/ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  it("exportiert das Journal mit Rechnungsnummern; Salden wie in der Saldenliste", async () => {
    await expect(datev.datevExport(2026)).rejects.toThrow(/Berater- und Mandantennummer/);
    await expect(datev.saveDatevNumbers(actor, { beraterNr: "12", mandantNr: "1" })).rejects.toThrow(/4 bis 7 Ziffern/);
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });

    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const input = {
      contactId: contact.id,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd" as const,
      note: "",
      lines: [
        { description: "Beratung", quantity: 10_000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const },
        { description: "Fachbuch", quantity: 1000, unit: "Stk." as const, unitPrice: 5_000, taxRate: 700 as const },
      ],
    };
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);

    const { bytes, filename, bookings } = await datev.datevExport(2026, new Date(2026, 9, 4, 8, 0, 0));
    expect(filename).toBe("EXTF_Buchungsstapel_2026.csv");
    const stack = parseDatevBuchungsstapel(bytes);
    expect(stack.header).toMatchObject({ beraterNr: "29098", mandantNr: "55003", kontenrahmen: "SKR03", dateFrom: "2026-01-01", dateTo: "2026-12-31" });
    expect(stack.bookings).toHaveLength(bookings);
    expect(stack.bookings.every((b) => b.voucherField1 === invoice.number && b.side === "S")).toBe(true);
    // Erlöse 19 % und 7 % auf Automatikkonten mit BU 40, die Steuer auf Umsatzsteuer nicht fällig ohne Schlüssel
    expect(stack.bookings.map((b) => `${b.account}/${b.contraAccount}/${b.buKey}/${b.amount}`).sort()).toEqual(
      ["1400/8400/40/100000", "1400/1766//19000", "1400/8300/40/5000", "1400/1761//350"].sort(),
    );

    const saldo = new Map<string, number>();
    for (const b of stack.bookings) {
      saldo.set(b.account, (saldo.get(b.account) ?? 0) + b.amount);
      saldo.set(b.contraAccount, (saldo.get(b.contraAccount) ?? 0) - b.amount);
    }
    const liste = await ledger.saldenliste(ledger.ledgerRange(2026));
    expect(liste.length).toBeGreaterThan(0);
    for (const zeile of liste) expect(saldo.get(zeile.account) ?? 0, zeile.account).toBe(zeile.saldo);

    // Nach einem Wechsel des Kontenrahmens bleibt das Jahr im Rahmen seiner Buchungen exportierbar. Mitten im Jahr
    // lehnt die Datenbank den Wechsel ab (0065); gemischte Rahmen gibt es nur in Daten von vorher oder an Haben vorbei.
    await expect(sql`update company set kontenrahmen = 'SKR04'`).rejects.toThrow(/schon Buchungen/);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update company set kontenrahmen = 'SKR04'`;
    });
    expect(parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes).header.kontenrahmen).toBe("SKR03");
    // Haben bucht in das Jahr nichts mehr im neuen Rahmen (ledger.post)
    await expect(invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id)).rejects.toThrow(
      /Das Jahr 2026 ist im Kontenrahmen SKR03 gebucht/,
    );
    // Gemischte Rahmen in einem Jahr aus Daten von vorher: klare Meldung statt eines falschen Stapels
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update company set kontenrahmen = 'SKR03'`;
    });
    await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, input)).id);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update journal_entries set kontenrahmen = 'SKR04' where id = (select id from journal_entries order by created_at desc limit 1)`;
    });
    await expect(datev.datevExport(2026)).rejects.toThrow(/Buchungen in SKR03 und SKR04/);
  });

  it("exportiert einen Monat oder ein Quartal; zwölf Monatsexporte ergeben den Jahresexport", async () => {
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Südwind GmbH",
      strasse: "Talstraße 2",
      plz: "80331",
      ort: "München",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });

    const buche = async (issueDate: string, unitPrice: number) =>
      invoices.finalizeInvoice(
        actor,
        (
          await invoices.createDraft(actor, {
            contactId: contact.id,
            issueDate,
            serviceFrom: null,
            serviceTo: null,
            paymentTermDays: 14,
            format: "zugferd" as const,
            note: "",
            lines: [{ description: `Leistung ${issueDate}`, quantity: 1000, unit: "Stk." as const, unitPrice, taxRate: 1900 as const }],
          })
        ).id,
      );

    const jan = await buche("2026-01-15", 10_000);
    const feb = await buche("2026-02-28", 20_000);
    const mar1 = await buche("2026-03-01", 30_000);
    const mar2 = await buche("2026-03-31", 40_000);
    const apr = await buche("2026-04-01", 50_000);
    const jul = await buche("2026-07-10", 60_000);
    const nov = await buche("2026-11-20", 70_000);

    // Monat März 2026: genau 01.03. bis 31.03.2026, Kopf 20260301/20260331
    const maerz = await datev.datevExport(2026, new Date(2026, 11, 1), undefined, { kind: "monat", monat: 3 });
    expect(maerz.filename).toBe("EXTF_Buchungsstapel_2026-03.csv");
    const [kopfMaerz] = new TextDecoder("windows-1252").decode(maerz.bytes).split("\r\n");
    expect(kopfMaerz).toContain(";20260101;4;20260301;20260331;");
    const maerzStack = parseDatevBuchungsstapel(maerz.bytes);
    expect(maerzStack.header).toMatchObject({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect([...new Set(maerzStack.bookings.map((b) => b.voucherField1))].sort()).toEqual([mar1.number, mar2.number].sort());

    // 1. Quartal 2026: 01.01. bis 31.03.2026
    const q1 = await datev.datevExport(2026, new Date(2026, 11, 1), undefined, { kind: "quartal", quartal: 1 });
    expect(q1.filename).toBe("EXTF_Buchungsstapel_2026-Q1.csv");
    const q1Stack = parseDatevBuchungsstapel(q1.bytes);
    expect(q1Stack.header).toMatchObject({ dateFrom: "2026-01-01", dateTo: "2026-03-31" });
    expect([...new Set(q1Stack.bookings.map((b) => b.voucherField1))].sort()).toEqual([jan.number, feb.number, mar1.number, mar2.number].sort());

    // Leerer Monat: gültige Datei ohne Buchungen
    const mai = await datev.datevExport(2026, new Date(2026, 11, 1), undefined, { kind: "monat", monat: 5 });
    expect(mai.bookings).toBe(0);
    expect(parseDatevBuchungsstapel(mai.bytes).header).toMatchObject({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });

    // Summe der zwölf Monatsexporte ergibt den Jahresexport
    const jahr = await datev.datevExport(2026, new Date(2026, 11, 1));
    const jahrStack = parseDatevBuchungsstapel(jahr.bytes);
    expect([...new Set(jahrStack.bookings.map((b) => b.voucherField1))].sort()).toEqual(
      [jan.number, feb.number, mar1.number, mar2.number, apr.number, jul.number, nov.number].sort(),
    );

    const monatsBuchungen = [];
    for (let monat = 1; monat <= 12; monat++) {
      const m = await datev.datevExport(2026, new Date(2026, 11, 1), undefined, { kind: "monat", monat });
      monatsBuchungen.push(...parseDatevBuchungsstapel(m.bytes).bookings);
    }
    expect(monatsBuchungen).toHaveLength(jahrStack.bookings.length);

    const summen = (list: typeof jahrStack.bookings) => {
      const map = new Map<string, number>();
      for (const b of list) {
        map.set(b.account, (map.get(b.account) ?? 0) + b.amount);
        map.set(b.contraAccount, (map.get(b.contraAccount) ?? 0) - b.amount);
      }
      return map;
    };
    expect(summen(monatsBuchungen)).toEqual(summen(jahrStack.bookings));
  });
});
