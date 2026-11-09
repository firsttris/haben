import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const SAMMELKONTEN = { SKR03: { forderungen: "1400", verbindlichkeiten: "1600" }, SKR04: { forderungen: "1200", verbindlichkeiten: "3300" } } as const;

describe.skipIf(!testDatabaseUrl)("DATEV-Export mit Personenkonten (Postgres, #327)", () => {
  let datev: typeof import("./datev-export.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/bank.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const inhaber = { id: actor, role: "inhaber" as const };
  const steuerberatung = { id: "steuerberatung-user", role: "steuerberatung" as const };
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/bank.ts");
    ledger = await import("../buchhaltung/ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate datev_personenkonten, document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions,
      contacts, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              datev_berater_nr, datev_mandant_nr)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, '29098', '55003')`;
  }

  const contactInput = (name: string, extra: Record<string, unknown> = {}) => ({
    kundennummer: "",
    name,
    strasse: "Hafenstraße 5",
    plz: "20457",
    ort: "Hamburg",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
    ...extra,
  });

  async function invoice(contactId: string, net: number, issueDate = "2026-05-02") {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function beleg(supplierContactId: string | null, gross: number, date = "2026-05-10") {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 9, 27]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    const net = Math.round(gross / 1.19);
    await documents.updateDocument(actor, id, {
      supplierName: "Musterpartner GmbH",
      supplierUstId: "",
      supplierContactId,
      invoiceNumber: `ER-${fileSeq}`,
      documentDate: date,
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      reverseCharge: null,
      asset: null,
      amounts: [{ taxRate: 1900, net, tax: gross - net }],
    } as Parameters<typeof documents.updateDocument>[2]);
    await documents.bookDocument(actor, id);
    return id;
  }

  async function pay(target: { invoiceId: string } | { documentId: string }, amount: number, date: string) {
    const label = `Zahlung ${Object.values(target)[0]!.slice(0, 8)} ${amount}`;
    const euros = (Math.abs(amount) / 100).toFixed(2).replace(".", ",");
    const row = [
      date,
      date,
      "Gebucht",
      "Musterpartner",
      "Testfirma",
      label,
      amount < 0 ? "Ausgang" : "Eingang",
      "DE02100100100006820101",
      `${amount < 0 ? "-" : ""}${euros}`,
      "",
      "",
      "",
    ];
    await bank.importStatement(actor, { bytes: dkbCsv([row]), filename: `${label}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${label}`;
    if ("invoiceId" in target) await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: target.invoiceId, amount });
    else await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: target.documentId, amount });
  }

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "%s, %s: Rechnung, Zahlung, Skonto und Storno beim Debitor, Beleg und Zahlung beim Kreditor; Salden wie das Sammelkonto",
    async (kr, versteuerung) => {
      await reset(kr, versteuerung);
      const s = SAMMELKONTEN[kr];
      await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
      const partner = await contacts.createContact(
        actor,
        contactInput("Musterpartner GmbH", { kundennummer: "K-42", isSupplier: true, debitorNr: 10042, kreditorNr: 70087 }),
      );

      const bezahlt = await invoice(partner.id, 100_00);
      await pay({ invoiceId: bezahlt.id }, 116_62, "2026-05-10");
      await bank.writeOff(actor, { kind: "skonto", invoiceId: bezahlt.id, date: "2026-05-10" });
      const storniert = await invoice(partner.id, 50_00);
      await invoices.cancelInvoice(actor, storniert.id, "2026-05-12");
      const eingang = await beleg(partner.id, 119_00);
      await pay({ documentId: eingang }, -119_00, "2026-05-20");

      const { bytes } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
      const stack = parseDatevBuchungsstapel(bytes);
      const konten = new Set(stack.bookings.flatMap((b) => [b.account, b.contraAccount]));
      expect(konten.has("10042")).toBe(true);
      expect(konten.has("70087")).toBe(true);
      expect(konten.has(s.forderungen)).toBe(false);
      expect(konten.has(s.verbindlichkeiten)).toBe(false);

      const saldo = new Map<string, number>();
      for (const b of stack.bookings) {
        saldo.set(b.account, (saldo.get(b.account) ?? 0) + b.amount);
        saldo.set(b.contraAccount, (saldo.get(b.contraAccount) ?? 0) - b.amount);
      }
      const liste = await ledger.saldenliste(ledger.ledgerRange(2026));
      for (const zeile of liste) {
        const konto = zeile.account === s.forderungen ? "10042" : zeile.account === s.verbindlichkeiten ? "70087" : zeile.account;
        expect(saldo.get(konto) ?? 0, zeile.account).toBe(zeile.saldo);
      }

      // Ab dem ersten Export sind die Nummern fest; der Name darf sich ändern
      expect((await sql`select rolle, nummer, jahr from datev_personenkonten order by rolle`).map((r) => ({ ...r }))).toEqual([
        { rolle: "debitor", nummer: 10042, jahr: 2026 },
        { rolle: "kreditor", nummer: 70087, jahr: 2026 },
      ]);
      const felder = contactInput("Musterpartner GmbH & Co. KG", { kundennummer: "K-42", isSupplier: true, debitorNr: 10042, kreditorNr: 70087 });
      await contacts.updateContact(actor, partner.id, felder);
      await expect(contacts.updateContact(actor, partner.id, { ...felder, debitorNr: 10043 })).rejects.toMatchObject({
        cause: { message: "Debitor 10042 steht schon in einem DATEV-Export und bleibt fest." },
      });
      await expect(contacts.updateContact(actor, partner.id, { ...felder, kreditorNr: null })).rejects.toMatchObject({
        cause: { message: "Kreditor 70087 steht schon in einem DATEV-Export und bleibt fest." },
      });
      // Ein zweiter Export legt nichts doppelt an
      await datev.datevExport(2026, new Date(2026, 9, 5), inhaber);
      expect(await sql`select count(*)::int as n from datev_personenkonten`).toEqual([{ n: 2 }]);
    },
  );

  it("bleibt ohne Schalter und vor dem Jahr des Schalters bei den Sammelkonten und merkt sich nichts", async () => {
    await reset("SKR03", "ist");
    const partner = await contacts.createContact(actor, contactInput("Musterpartner GmbH", { debitorNr: 10042 }));
    await invoice(partner.id, 100_00);
    const konten = async () =>
      new Set(parseDatevBuchungsstapel((await datev.datevExport(2026, new Date(2027, 0, 4), inhaber)).bytes).bookings.map((b) => b.account));
    expect(await konten()).toEqual(new Set(["1400"]));
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2027 }, new Date(2026, 6, 1));
    expect(await konten()).toEqual(new Set(["1400"]));
    expect(await sql`select count(*)::int as n from datev_personenkonten`).toEqual([{ n: 0 }]);
  });

  it("lehnt ab, wenn einem Vorgang der Kontakt oder die Nummer fehlt, mit Liste der Vorgänge, und merkt sich dann nichts", async () => {
    await reset("SKR03", "soll");
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
    const kunde = await contacts.createContact(actor, contactInput("Nordwerk GmbH", { debitorNr: 10001 }));
    const ohneKreditor = await contacts.createContact(actor, contactInput("Papierwerk Süd AG", { isCustomer: false, isSupplier: true }));
    const r = await invoice(kunde.id, 100_00);
    await beleg(null, 119_00);
    await beleg(ohneKreditor.id, 238_00);
    const error = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber).catch((e: Error) => e);
    expect(error).toBeInstanceOf(datev.DatevExportError);
    expect((error as Error).message).toBe(
      [
        "Für die Personenkonten fehlen Angaben. Ordne den Vorgängen einen Kontakt zu bzw. trage am Kontakt die Nummer ein:",
        `- Beleg ER-${fileSeq - 1}: ohne Lieferanten aus den Kontakten`,
        `- Beleg ER-${fileSeq}: „Papierwerk Süd AG“ hat keinen Kreditor`,
      ].join("\n"),
    );
    expect(r.number).toBeTruthy();
    expect(await sql`select count(*)::int as n from datev_personenkonten`).toEqual([{ n: 0 }]);
  });

  it("lässt nach Storno und Neuerfassung eines gebuchten Belegs ohne Lieferanten den Export zu, wie die Doku es verspricht", async () => {
    // docs/auswertungen.md, Personenkonten: „Für einen gebuchten Beleg ohne Lieferanten hilft nur Storno und neu erfassen“
    await reset("SKR03", "soll");
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
    const lieferant = await contacts.createContact(actor, contactInput("Papierwerk Süd AG", { isCustomer: false, isSupplier: true, kreditorNr: 70001 }));
    const ohneLieferant = await beleg(null, 119_00);
    const { cancelDocument } = await import("../belege/cancellation.ts");
    await cancelDocument(actor, ohneLieferant, { reason: "Lieferant fehlte" }, "2026-05-11");
    await beleg(lieferant.id, 119_00);

    const { bytes } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
    const stack = parseDatevBuchungsstapel(bytes);
    const saldo = (konto: string) =>
      stack.bookings.reduce((sum, b) => sum + (b.account === konto ? b.amount : 0) - (b.contraAccount === konto ? b.amount : 0), 0);
    // Der stornierte Beleg hebt sich auf dem Sammelkonto auf; der neu erfasste steht beim Kreditor
    expect(saldo("1600")).toBe(0);
    expect(saldo("70001")).toBe(-119_00);
  });

  it("Storno im Folgejahr (Zeitraum schon gemeldet): Storno und Neuerfassung geben beide Jahre frei, wie docs/auswertungen.md es beschreibt", async () => {
    await reset("SKR03", "soll");
    await sql`delete from vat_returns`;
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
    const lieferant = await contacts.createContact(actor, contactInput("Papierwerk Süd AG", { isCustomer: false, isSupplier: true, kreditorNr: 70001 }));
    const ohneLieferant = await beleg(null, 119_00, "2026-11-20");
    // Die Voranmeldung November ist gesendet: Der Storno bekommt den Tag des Stornos, hier im Januar 2027
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 11, 'sent', 0, 0, 0, 0, now())`;
    const { cancelDocument } = await import("../belege/cancellation.ts");
    const storno = await cancelDocument(actor, ohneLieferant, { reason: "Lieferant fehlte" }, "2027-01-12");
    expect(storno.date).toBe("2027-01-12");
    await beleg(lieferant.id, 119_00, "2026-11-20");

    const fehler = async (jahr: number) =>
      datev.datevExport(jahr, new Date(2027, 0, 13), inhaber).then(
        () => null,
        (e: Error) => e.message,
      );
    expect({ 2026: await fehler(2026), 2027: await fehler(2027) }).toEqual({ 2026: null, 2027: null });
    await sql`delete from vat_returns`;
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: Eröffnungsbuchung bleibt auf dem Sammelkonto und sperrt den Export nicht (#452)", async (kr, versteuerung) => {
    await reset(kr, versteuerung);
    const s = SAMMELKONTEN[kr];
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
    const kunde = await contacts.createContact(actor, contactInput("Nordwerk GmbH", { debitorNr: 10001 }));
    const { withActor } = await import("../../db/actor.ts");
    // Restsalden aus der Vorgänger-Buchhaltung, wie sie eine Eröffnung aus dem DATEV-Stapel bucht (source_type eroeffnung)
    await withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date: "2026-01-01",
        description: "Eröffnung aus der Schlussbilanz 2025 (DATEV-Stapel)",
        sourceType: "eroeffnung",
        sourceId: crypto.randomUUID(),
        lines: [
          { account: s.forderungen, debit: 500_00, credit: 0, taxCode: null },
          { account: s.verbindlichkeiten, debit: 0, credit: 300_00, taxCode: null },
          { account: "9000", debit: 0, credit: 200_00, taxCode: null },
        ],
      }),
    );
    await invoice(kunde.id, 100_00);
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026, new Date(2026, 9, 4), inhaber)).bytes);
    const saldo = (konto: string) =>
      stack.bookings.reduce((sum, b) => sum + (b.account === konto ? b.amount : 0) - (b.contraAccount === konto ? b.amount : 0), 0);
    // Die Eröffnung steht auf den Sammelkonten, die Rechnung beim Debitor
    expect(saldo(s.forderungen)).toBe(500_00);
    expect(saldo(s.verbindlichkeiten)).toBe(-300_00);
    expect(saldo("10001")).toBe(119_00);
  });

  it("Recht „lesen“: exportiert nur mit schon festgeschriebenen Nummern; neue schreibt nur der Inhaber fest (#452)", async () => {
    await reset("SKR04", "ist");
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
    const kunde = await contacts.createContact(actor, contactInput("Nordwerk GmbH", { debitorNr: 10001 }));
    await invoice(kunde.id, 100_00);
    // Der erste Export mit dem neuen Debitor: nicht durch die Steuerberatung, und dann wird nichts festgeschrieben
    const fehler = await datev.datevExport(2026, new Date(2026, 9, 4), steuerberatung).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(datev.DatevExportError);
    expect((fehler as Error).message).toBe(
      "Der erste Export mit neuen Personenkonten muss vom Inhaber kommen, weil er die Nummern festschreibt. Noch nicht festgeschrieben: Debitor 10001 (Nordwerk GmbH).",
    );
    expect(await sql`select count(*)::int as n from datev_personenkonten`).toEqual([{ n: 0 }]);

    // Nach dem Export des Inhabers kann die Steuerberatung denselben Stapel holen, ohne etwas zu schreiben
    const vomInhaber = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
    const audit = async () => (await sql`select count(*)::int as n from audit_log`)[0]!.n as number;
    const vorher = await audit();
    const vonDerSteuerberatung = await datev.datevExport(2026, new Date(2026, 9, 4), steuerberatung);
    expect(Buffer.from(vonDerSteuerberatung.bytes).equals(Buffer.from(vomInhaber.bytes))).toBe(true);
    expect(await audit()).toBe(vorher);

    // Kommt ein neuer Kunde mit Nummer dazu, braucht es wieder den Inhaber
    const neu = await contacts.createContact(actor, contactInput("Alpenblick AG", { debitorNr: 10002 }));
    await invoice(neu.id, 50_00);
    await expect(datev.datevExport(2026, new Date(2026, 9, 4), steuerberatung)).rejects.toThrow("Noch nicht festgeschrieben: Debitor 10002 (Alpenblick AG).");
    // Ohne Schalter bleibt der Export auch für die Steuerberatung wie bisher
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2027, bestaetigt: true }, new Date(2026, 9, 4));
    await expect(datev.datevExport(2026, new Date(2026, 9, 4), steuerberatung)).resolves.toMatchObject({ bookings: expect.any(Number) });
  });

  it("ändert den Schalter für Jahre mit Buchungen bis heute nur mit Bestätigung, nie still rückwirkend", async () => {
    await reset("SKR04", "ist");
    const kunde = await contacts.createContact(actor, contactInput("Nordwerk GmbH", { debitorNr: 10001 }));
    await invoice(kunde.id, 100_00, "2025-11-03");
    const settings = (personenkontenAb: number | null, bestaetigt?: boolean) => ({ beraterNr: "29098", mandantNr: "55003", personenkontenAb, bestaetigt });
    // Ab dem nächsten Jahr: kein schon gebuchtes Jahr betroffen
    await datev.saveDatevNumbers(actor, settings(2027), new Date(2026, 5, 1));
    // Ab 2025 träfe das gebuchte Jahr 2025; ab 2026 das laufende Jahr ohne Buchungen geht ohne Bestätigung
    await expect(datev.saveDatevNumbers(actor, settings(2025), new Date(2026, 5, 1))).rejects.toThrow(
      "Die Änderung betrifft den Buchungsstapel für 2025, der schon Buchungen hat. Ein schon an die Steuerberatung gegebener Stapel sieht danach anders aus; bestätige das ausdrücklich.",
    );
    await datev.saveDatevNumbers(actor, settings(2026), new Date(2026, 5, 1));
    await datev.saveDatevNumbers(actor, settings(2025, true), new Date(2026, 5, 1));
    expect((await sql`select datev_personenkonten_ab from company`)[0]!.datev_personenkonten_ab).toBe(2025);
    // Abschalten träfe 2025 ebenso
    await expect(datev.saveDatevNumbers(actor, settings(null), new Date(2026, 5, 1))).rejects.toThrow(/betrifft den Buchungsstapel für 2025/);
    await expect(datev.saveDatevNumbers(actor, settings(1999), new Date(2026, 5, 1))).rejects.toThrow(/Jahr/);
  });
});
