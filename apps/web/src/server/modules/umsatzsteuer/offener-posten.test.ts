import type { ElsterClient } from "@haben/elster";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/*
 * Voranmeldung als offener Posten (Roadmap Platz 5): Abgabe außerhalb von Haben vermerken, Zahllast bzw. Erstattung
 * je abgegebener Voranmeldung als Posten, Zuordnung im Bankabgleich mit Bezug, Teilzahlung, Säumniszuschlag,
 * Berichtigung, Dauerfristverlängerung und Protokoll im Jahresarchiv. SKR03 und SKR04, Ist und Soll, Zahllast und Überschuss.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

/** Umsatz auf dem Geschäftskonto; Datum TT.MM.JJ, Betrag mit Komma und Vorzeichen */
const row = (date: string, name: string, purpose: string, amount: string, iban = "DE76750000000075001007") => [
  date,
  date,
  "Gebucht",
  amount.startsWith("-") ? "Testfirma" : name,
  amount.startsWith("-") ? name : "Testfirma",
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  iban,
  amount,
  "",
  "",
  "",
];

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

describe.skipIf(!testDatabaseUrl)("Voranmeldung als offener Posten (Postgres)", () => {
  let vat: typeof import("./vat.ts");
  let vermerk: typeof import("./vermerk.ts");
  let zahlung: typeof import("./zahlung.ts");
  let dauerfrist: typeof import("./dauerfrist.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let exporter: typeof import("../archiv/export.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const oktober = { year: 2026, month: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    vat = await import("./vat.ts");
    vermerk = await import("./vermerk.ts");
    zahlung = await import("./zahlung.ts");
    dauerfrist = await import("./dauerfrist.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    fristen = await import("../finanzamt/fristen.ts");
    reports = await import("../auswertungen/reports.ts");
    exporter = await import("../archiv/export.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate vat_return_filings, vat_extensions, vat_extension_submissions, vat_frequencies, vat_return_submissions, vat_returns,
      elster_certificates, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  }

  async function rechnung(net: number, issueDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function beleg(date: string, net: number, tax: number) {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, net % 256, tax % 256, 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "b.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Hetzner Online GmbH",
      supplierUstId: "",
      invoiceNumber: `R${net}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
    });
    await documents.bookDocument(actor, id);
  }

  async function umsatz(rows: string[][], name: string) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${name}.csv` }, null);
  }

  const txId = async (purpose: string) => (await sql`select id from bank_transactions where purpose = ${purpose}`)[0]!.id as string;

  /** Wie ERiC: kein simulierter Client, damit die Echtübermittlung durchgeht */
  const liveClient = (): ElsterClient => {
    const fake = new EricGeprueftClient();
    return {
      validate: (xml) => fake.validate(xml),
      send: (...args) => fake.send(...args),
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  };

  const abgabe = (kz83: number, overrides: Partial<import("./vermerk.ts").VermerkInput> = {}) => ({
    filedOn: "2026-11-09",
    transferTicket: "et9k3m2x7q4w8z1a",
    kz83,
    file: { bytes: pdf("Übermittlungsprotokoll Oktober"), filename: "UStVA_2026-10_Protokoll.pdf" },
    ...overrides,
  });

  const konten = { SKR03: { bank: "1200", ust: "1780" }, SKR04: { bank: "1800", ust: "3820" } } as const;

  it.each([
    ["SKR03", "ist", "zahllast"],
    ["SKR03", "soll", "zahllast"],
    ["SKR04", "ist", "zahllast"],
    ["SKR04", "soll", "zahllast"],
    ["SKR03", "ist", "ueberschuss"],
    ["SKR03", "soll", "ueberschuss"],
    ["SKR04", "ist", "ueberschuss"],
    ["SKR04", "soll", "ueberschuss"],
  ] as const)(
    "%s, %s, %s: vermerken, Posten, Vorschlag im Bankabgleich, Buchung wie bisher mit Bezug, ausgeglichen",
    async (kontenrahmen, versteuerung, fall) => {
      await firma(kontenrahmen, versteuerung);
      if (fall === "zahllast") {
        const inv = await rechnung(100_000, "2026-10-05");
        if (versteuerung === "ist") {
          await umsatz([row("20.10.26", "Nordwerk Software GmbH", "Rechnung", "1.190,00", "DE02100100100006820101")], "kunde");
          await bank.allocate(actor, { kind: "invoice", transactionId: await txId("Rechnung"), invoiceId: inv.id, amount: 119_000 });
        }
      } else {
        await beleg("2026-10-10", 100_000, 19_000);
      }
      const kz83 = fall === "zahllast" ? 19_000 : -19_000;
      const draft = await vat.saveDraft(actor, oktober, { mode: "berechnet" });
      expect(draft.kz83).toBe(kz83);
      expect((await fristen.listFristen("2026-11-05")).find((f) => f.id === "ustva-2026-10")?.status).toBe("offen");

      // Kz 83 laut Protokoll weicht ab: abgelehnt, die Anmeldung bleibt Entwurf
      await expect(vermerk.vermerkeAbgabe(actor, draft.id, abgabe(kz83 + 100), "2026-11-09")).rejects.toThrow(/weicht von der Voranmeldung/);
      expect((await sql`select status from vat_returns where id = ${draft.id}`)[0]!.status).toBe("draft");

      const sent = await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(kz83), "2026-11-09");
      expect(sent).toMatchObject({ status: "sent", transferTicket: "et9k3m2x7q4w8z1a" });
      expect(sent.lockedAt).not.toBeNull();
      expect((await fristen.listFristen("2026-11-05")).find((f) => f.id === "ustva-2026-10")?.status).toBe("erledigt");
      await expect(sql`update vat_returns set kz81 = 0 where id = ${draft.id}`).rejects.toThrow(/festgeschrieben/);
      await expect(sql`update vat_return_filings set kz83 = 0`).rejects.toThrow(/nur ergänzt/);
      await expect(sql`delete from vat_return_filings`).rejects.toThrow(/nur ergänzt/);
      const audit = await sql`select actor from audit_log where table_name = 'vat_return_filings' and new_value ->> 'vat_return_id' = ${draft.id}`;
      expect(audit.map((a) => a.actor)).toEqual([actor]);

      const [posten] = (await zahlung.ustvaPosten()).posten;
      expect(posten).toMatchObject({ vatReturnId: draft.id, betrag: kz83, faellig: "2026-11-10", offen: kz83 });

      // Lastschrift bzw. Erstattung des Finanzamts mit Zeitraum im Verwendungszweck
      const betrag = fall === "zahllast" ? "-190,00" : "190,00";
      await umsatz([row("10.11.26", "Finanzamt Regensburg", "USt 10/26 StNr 198/113/10010", betrag)], "finanzamt");
      const finanzamt = await txId("USt 10/26 StNr 198/113/10010");
      const detail = await bank.transactionDetail(finanzamt);
      expect(detail!.suggestions[0]).toMatchObject({
        item: { type: "ustva", id: draft.id, number: "USt 10/2026" },
        amount: -kz83,
        reasons: ["Betrag stimmt exakt", "Zeitraum im Verwendungszweck", "Finanzamt als Gegenpartei"],
      });
      // In Gegenrichtung nicht zuordenbar
      await expect(bank.allocate(actor, { kind: "ustva", transactionId: finanzamt, vatReturnId: draft.id, amount: kz83 })).rejects.toThrow(/Vorzeichen/);
      await bank.allocate(actor, { kind: "ustva", transactionId: finanzamt, vatReturnId: draft.id, amount: -kz83 });

      const [allocation] = await sql`select kind, vat_return_id from allocations where transaction_id = ${finanzamt}`;
      expect(allocation).toMatchObject({ kind: "ustVorauszahlung", vat_return_id: draft.id });
      const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_type = 'allocation' and e.source_id = (select id from allocations where transaction_id = ${finanzamt}) order by l.account`;
      const { bank: bankKonto, ust } = konten[kontenrahmen];
      const expected =
        fall === "zahllast"
          ? [
              { account: bankKonto, debit: 0, credit: 19_000 },
              { account: ust, debit: 19_000, credit: 0 },
            ]
          : [
              { account: bankKonto, debit: 19_000, credit: 0 },
              { account: ust, debit: 0, credit: 19_000 },
            ];
      expect(
        lines.map((l) => ({ account: l.account, debit: Number(l.debit), credit: Number(l.credit) })).sort((a, b) => a.account.localeCompare(b.account)),
      ).toEqual(expected.sort((a, b) => a.account.localeCompare(b.account)));

      expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ bezahlt: kz83, offen: 0 });
      expect(await zahlung.ustvaOpenItems()).toEqual([]);
      const euer = await reports.euerForYear(2026);
      const key = fall === "zahllast" ? "gezahlteUst" : "erstatteteUst";
      expect(euer[fall === "zahllast" ? "ausgaben" : "einnahmen"].find((l) => l.key === key)?.amount).toBe(19_000);
      expect((await reports.openPositions("2026-11-20")).vat).toEqual([]);
    },
    60_000,
  );

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: Schonfrist endet am Feiertag im Bundesland des Finanzamts erst am nächsten Werktag", async (kontenrahmen, versteuerung) => {
    // Firma in Bayern; April 2026 verspätet am Montag, 01.06., abgegeben: fällig mit dem Eingang (AEAO zu § 240 Nr. 1).
    // Der dritte Tag danach ist Fronleichnam (Donnerstag, 04.06.), in Bayern ein Feiertag: Die Schonfrist endet erst am
    // Freitag, 05.06. (§ 240 Abs. 3 AO mit § 108 Abs. 3 AO)
    await firma(kontenrahmen, versteuerung);
    const april = await vat.saveDraft(actor, { year: 2026, month: 4 }, { mode: "manuell", kz81: 650_000, kz86: 0, kz66: 45, reason: "Werte des Steuerbüros" });
    await vermerk.vermerkeAbgabe(actor, april.id, abgabe(123_455, { filedOn: "2026-06-01" }), "2026-06-01");
    expect(await zahlung.ustvaOpenItems()).toEqual([expect.objectContaining({ dueDate: "2026-06-01", schonfristEnde: "2026-06-05" })]);

    // 1.234,55 € rückständig, abgerundet 1.200 €: 12 € je angefangenem Monat
    await umsatz(
      [row("05.06.26", "Finanzamt Regensburg", "Finanzkasse Freitag", "-1.246,55"), row("08.06.26", "Finanzamt Regensburg", "Finanzkasse Montag", "-1.246,55")],
      "schonfrist",
    );
    const freitag = (await bank.transactionDetail(await txId("Finanzkasse Freitag")))!.suggestions;
    expect(freitag.flatMap((v) => v.reasons).filter((r) => r.includes("Säumniszuschlag"))).toEqual([]);
    const [montag] = (await bank.transactionDetail(await txId("Finanzkasse Montag")))!.suggestions;
    expect(montag).toMatchObject({
      amount: -123_455,
      reasons: expect.arrayContaining([expect.stringMatching(/^Zahllast und 12,00\s€ Säumniszuschlag \(§ 240 AO, 1 Monat\)$/)]),
    });
  });

  it("Teilzahlung, Überzahlung abgelehnt, Lastschrift mit Säumniszuschlag, offene Posten, Aufheben", async () => {
    await firma("SKR03", "soll");
    const draft = await vat.saveDraft(actor, oktober, {
      mode: "manuell",
      kz81: 650_000,
      kz86: 0,
      kz66: 45,
      reason: "Werte aus der Buchhaltung des Steuerbüros",
    });
    expect(draft.kz83).toBe(123_455);
    await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(123_455), "2026-11-09");
    expect((await reports.openPositions("2026-11-20")).vat).toEqual([
      expect.objectContaining({ id: "2026-10", number: "USt 10/2026", open: 123_455, dueDate: "2026-11-10", daysOverdue: 10 }),
    ]);

    await umsatz(
      [
        row("10.11.26", "Finanzamt Regensburg", "USt 10/26 Teil", "-1.000,00"),
        row("10.11.26", "Finanzamt Regensburg", "USt 10/26 zu viel", "-300,00"),
        row("21.12.26", "Finanzamt Regensburg", "USt 10/26 Rest", "-238,55"),
      ],
      "raten",
    );
    const teil = await txId("USt 10/26 Teil");
    expect((await bank.transactionDetail(teil))!.suggestions[0]).toMatchObject({
      amount: -100_000,
      reasons: expect.arrayContaining(["Teilbetrag des offenen Betrags"]),
    });
    await bank.allocate(actor, { kind: "ustva", transactionId: teil, vatReturnId: draft.id, amount: -100_000 });
    expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ bezahlt: 100_000, offen: 23_455 });
    await expect(
      bank.allocate(actor, { kind: "ustva", transactionId: await txId("USt 10/26 zu viel"), vatReturnId: draft.id, amount: -30_000 }),
    ).rejects.toThrow(/nur noch über 234,55/);

    // 234,55 € rückständig, abgerundet 200 €: 2 € je angefangenem Monat, am 21.12. zwei Monate (§ 240 AO)
    const rest = await txId("USt 10/26 Rest");
    const [vorschlag] = (await bank.transactionDetail(rest))!.suggestions;
    expect(vorschlag).toMatchObject({ amount: -23_455, reasons: expect.arrayContaining([expect.stringMatching(/Säumniszuschlag \(§ 240 AO, 2 Monate\)/)]) });
    await bank.allocate(actor, { kind: "ustva", transactionId: rest, vatReturnId: draft.id, amount: -23_455 });
    expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ offen: 0 });
    // Der Säumniszuschlag bleibt offen für den Beleg (Betriebsausgabe, nicht Umsatzsteuer)
    expect((await bank.transactionDetail(rest))!.transaction.open).toBe(-400);

    // Aufheben: der Posten ist wieder offen; die Gegenzeile trägt den Bezug mit
    const [allocation] = await sql`select id from allocations where transaction_id = ${rest}`;
    await bank.reverseAllocation(actor, allocation!.id as string);
    expect((await sql`select vat_return_id from allocations where reverses_id = ${allocation!.id}`)[0]!.vat_return_id).toBe(draft.id);
    expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ offen: 23_455 });
  }, 60_000);

  it("Berichtigung über ERiC: eigener Posten über die Differenz, fällig frühestens mit der Abgabe; nach unten verrechnet", async () => {
    await firma("SKR04", "soll");
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    const first = await vat.submitReturn(actor, draft.id, liveClient(), { kind: "send", pin: "1", herstellerId: "12345" });
    expect(first.ok).toBe(true);
    // Über ERiC gesendet: ebenso ein Posten, fällig am 10.11. (oder am Tag der Übermittlung, wenn der später liegt)
    const sentDay = (await sql`select to_char(sent_at at time zone 'Europe/Berlin', 'YYYY-MM-DD') as d from vat_returns where id = ${draft.id}`)[0]!
      .d as string;
    const faellig = sentDay > "2026-11-10" ? sentDay : "2026-11-10";
    expect((await zahlung.ustvaPosten()).posten).toEqual([expect.objectContaining({ vatReturnId: draft.id, betrag: 19_000, faellig })]);

    const correction = await vat.createCorrection(actor, oktober);
    await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 150_000, kz86: 0, kz66: 0, reason: "Rechnung nachträglich gefunden" });
    await vermerk.vermerkeAbgabe(actor, correction.id, abgabe(28_500, { filedOn: "2026-12-01", transferTicket: "etBERICHTIGUNG1" }), "2026-12-01");
    const posten = (await zahlung.ustvaPosten()).posten;
    expect(posten.map((p) => [p.vatReturnId, p.betrag, p.berichtigt, p.faellig])).toEqual([
      [draft.id, 19_000, false, faellig],
      [correction.id, 9_500, true, "2026-12-01"],
    ]);
    // Dasselbe Transferticket ein zweites Mal: abgelehnt
    const second = await vat.createCorrection(actor, oktober);
    await expect(vermerk.vermerkeAbgabe(actor, second.id, abgabe(28_500, { transferTicket: "etBERICHTIGUNG1" }), "2026-12-02")).rejects.toThrow(
      /schon bei der Voranmeldung 2026-10/,
    );

    // Zweite Berichtigung nach unten, bevor etwas gezahlt ist: offen bleibt nur der neue Betrag
    await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 50_000, kz86: 0, kz66: 0, reason: "Rechnung doch im November" });
    await vermerk.vermerkeAbgabe(actor, second.id, abgabe(9_500, { filedOn: "2026-12-02", transferTicket: "etBERICHTIGUNG2" }), "2026-12-02");
    const stand = (await zahlung.ustvaPosten()).posten;
    expect(stand.reduce((s, p) => s + p.offen, 0)).toBe(9_500);
    expect(stand.find((p) => p.vatReturnId === second.id)).toMatchObject({ betrag: -19_000, offen: 0 });
  }, 60_000);

  it("Vermerk nur zusammen mit der Festschreibung: nicht nachträglich zu einer gesendeten oder vermerkten Anmeldung", async () => {
    await firma("SKR03", "soll");
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    expect((await vat.submitReturn(actor, draft.id, liveClient(), { kind: "send", pin: "1", herstellerId: "12345" })).ok).toBe(true);
    const faelligVorher = (await zahlung.ustvaPosten()).posten[0]!.faellig;
    // Ein späterer Vermerk würde den Tag der Abgabe (und damit die Fälligkeit) der festgeschriebenen Anmeldung verschieben
    await expect(
      sql`insert into vat_return_filings (vat_return_id, filed_on, transfer_ticket, kz83, filename, sha256, size)
        values (${draft.id}, '2026-12-20', 'etNACHTRAEGLICH', 19000, 'p.pdf', 'abc', 1)`,
    ).rejects.toThrow(/ohne festgeschriebene Voranmeldung/);
    expect((await zahlung.ustvaPosten()).posten[0]!.faellig).toBe(faelligVorher);
  }, 60_000);

  it("Altbestand: vor dem Update gesendete Voranmeldung ohne Zahlung mit Bezug ist kein Posten, keine Aufgabe, Übersicht wie vorher", async () => {
    await firma("SKR03", "ist");
    // Über ERiC gesendet, bevor es offene Posten gab (vor der Migration 0137/0138); bezahlt außerhalb der Konten in Haben
    const [alt] = await sql`insert into vat_returns (year, month, status, source, kz81, kz83, transfer_ticket, sent_at, locked_at)
      values (2025, 10, 'sent', 'manuell', 100000, 19000, 'etALTBESTAND1', '2025-11-09T10:00:00Z', '2025-11-09T10:00:00Z') returning id`;
    // Dazu eine alte Lastschrift „Umsatzsteuer an das Finanzamt“ ohne Bezug, die nicht genau passt
    await umsatz([row("10.12.25", "Finanzamt Regensburg", "USt 11/25", "-50,00")], "alt");
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: await txId("USt 11/25"), amount: -5_000 });

    const stand = await zahlung.ustvaPosten();
    expect(stand.posten).toEqual([]);
    // Die Lastschrift zählt wie vor dem Update für die Deckung der Zahllast (vatPaid in der Übersicht)
    expect(stand.ohneBezug.map((z) => z.amount)).toEqual([-5_000]);
    expect(await zahlung.ustvaOpenItems()).toEqual([]);
    expect((await reports.openPositions("2026-11-20")).vat).toEqual([]);

    // Ordnet jemand ihr ausdrücklich eine Zahlung mit Bezug zu, zeigt sie Stand und Rest wie eine neue
    await umsatz([row("12.11.26", "Finanzamt Regensburg", "USt 10/25 Teil", "-100,00")], "teil");
    await bank.allocate(actor, { kind: "ustva", transactionId: await txId("USt 10/25 Teil"), vatReturnId: alt!.id, amount: -10_000 });
    expect((await zahlung.ustvaPosten()).posten).toEqual([expect.objectContaining({ vatReturnId: alt!.id, bezahlt: 10_000, offen: 9_000 })]);

    // Neu abgegebene Voranmeldungen sind Posten wie bisher
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(19_000), "2026-11-09");
    expect((await zahlung.ustvaPosten()).posten.map((p) => p.vatReturnId)).toEqual([alt!.id, draft.id]);
  }, 60_000);

  it("Integritätsprüfung erkennt einen geänderten Vermerk (Tag der Abgabe, Protokoll) wie einen Rechnungsanhang", async () => {
    await firma("SKR04", "ist");
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(19_000), "2026-11-09");
    const problems = async () => (await sql`select * from haben_integrity_problems()`).filter((p) => p.zeile === draft.id);
    expect(await problems()).toEqual([]);
    // Wer an den Triggern vorbei schreibt (Superuser), verschiebt den Tag der Abgabe und tauscht das Protokoll
    await sql.begin(async (tx) => {
      await tx`alter table vat_return_filings disable trigger vat_return_filings_append_only`;
      await tx`update vat_return_filings set filed_on = '2026-11-25', sha256 = ${"0".repeat(64)} where vat_return_id = ${draft.id}`;
      await tx`alter table vat_return_filings enable trigger vat_return_filings_append_only`;
    });
    expect(await problems()).toEqual([expect.objectContaining({ tabelle: "vat_returns", zeile: draft.id, befund: "Inhalt passt nicht zum Siegel" })]);
  }, 60_000);

  it("Zahlung ohne Bezug gleicht genau passende Posten aus; Bezug nur auf abgegebene Voranmeldungen", async () => {
    await firma("SKR03", "ist");
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    await umsatz([row("10.11.26", "Finanzamt Regensburg", "USt 10/26", "-190,00")], "alt");
    const tx = await txId("USt 10/26");
    // Entwurf: kein Posten, Zuordnung mit Bezug abgelehnt (Modul und Trigger)
    await expect(bank.allocate(actor, { kind: "ustva", transactionId: tx, vatReturnId: draft.id, amount: -19_000 })).rejects.toThrow(/nicht abgegeben/);
    await expect(
      sql`insert into allocations (transaction_id, kind, amount, vat_return_id) values (${tx}, 'ustVorauszahlung', -19000, ${draft.id})`,
    ).rejects.toThrow(/nicht abgegeben/);

    // Wie vor dieser Version: „Umsatzsteuer an das Finanzamt“ ohne Bezug
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: tx, amount: -19_000 });
    await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(19_000), "2026-11-09");
    expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ offen: 0, zahlungen: [expect.objectContaining({ ohneBezug: true })] });
    // Bezug nur bei „Umsatzsteuer an das Finanzamt“
    await expect(sql`insert into allocations (transaction_id, kind, amount, vat_return_id) values (${tx}, 'privat', -19000, ${draft.id})`).rejects.toThrow(
      /allocations_vat_return_kind/,
    );
  }, 60_000);

  it("Dauerfristverlängerung: Posten einen Monat später fällig; Dezember mit Kz 39 als Erstattung", async () => {
    await firma("SKR04", "ist");
    await dauerfrist.saveDauerfrist(actor, { year: 2026, active: true, sondervorauszahlung: 300_00 });
    const okt = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    await vermerk.vermerkeAbgabe(actor, okt.id, abgabe(19_000, { filedOn: "2026-12-07" }), "2026-12-07");
    expect((await zahlung.ustvaPosten()).posten[0]).toMatchObject({ faellig: "2026-12-10" });

    // Dezember: 190 € Steuer abzüglich 300 € Sondervorauszahlung (Kz 39) = 110 € Erstattung, fällig frühestens am 10.02.
    const dezember = { year: 2026, month: 12 };
    const dez = await vat.saveDraft(actor, dezember, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, kz39: 300_00, reason: "Werte laut Steuerberatung" });
    expect(dez.kz83).toBe(-11_000);
    await vermerk.vermerkeAbgabe(actor, dez.id, abgabe(-11_000, { filedOn: "2027-02-05", transferTicket: "etDEZEMBER2026" }), "2027-02-05");
    expect((await zahlung.ustvaPosten()).posten.find((p) => p.vatReturnId === dez.id)).toMatchObject({ betrag: -11_000, faellig: "2027-02-10" });
    // Die Sondervorauszahlung selbst ist kein Posten der Voranmeldung
    await umsatz([row("10.02.27", "Finanzamt Regensburg", "USt Sondervorauszahlung 2027", "-300,00")], "svz");
    const svz = await txId("USt Sondervorauszahlung 2027");
    expect((await bank.transactionDetail(svz))!.suggestions).toEqual([]);
  }, 60_000);

  it("Vermerk: Prüfungen ohne Datenbank, Protokoll im Jahresarchiv und zum Abruf", async () => {
    await firma("SKR03", "soll");
    const draft = await vat.saveDraft(actor, oktober, { mode: "manuell", kz81: 100_000, kz86: 0, kz66: 0, reason: "Werte laut Steuerberatung" });
    const bad = (overrides: Partial<import("./vermerk.ts").VermerkInput>, heute = "2026-11-09") =>
      vermerk.vermerkeAbgabe(actor, draft.id, abgabe(19_000, overrides), heute);
    await expect(bad({ filedOn: "2026-11-10" })).rejects.toThrow(/Zukunft/);
    await expect(bad({ filedOn: "2026-09-30" })).rejects.toThrow(/vor Beginn/);
    await expect(bad({ transferTicket: "x" })).rejects.toThrow(/Transferticket/);
    await expect(bad({ file: { bytes: new Uint8Array([0xff, 0xd8, 0xff]), filename: "foto.jpg" } })).rejects.toThrow(/PDF/);

    const sent = await vermerk.vermerkeAbgabe(actor, draft.id, abgabe(19_000), "2026-11-09");
    await expect(vermerk.vermerkeAbgabe(actor, sent.id, abgabe(19_000), "2026-11-09")).rejects.toThrow(/bereits gesendet/);
    const [filing] = await vermerk.filingsFor([draft.id]);
    expect(filing).toMatchObject({ filedOn: "2026-11-09", transferTicket: "et9k3m2x7q4w8z1a", kz83: 19_000, filename: "UStVA_2026-10_Protokoll.pdf" });
    const protokoll = await vermerk.loadFilingProtocol(filing!.id);
    expect(new TextDecoder().decode(protokoll!.pdf)).toContain("Übermittlungsprotokoll Oktober");
    // Ohne Festschreibung derselben Transaktion gibt es keinen Vermerk (Trigger beim Commit)
    const other = await vat.saveDraft(actor, { year: 2026, month: 9 }, { mode: "manuell", kz81: 0, kz86: 0, kz66: 0, reason: "Nullmeldung September" });
    await expect(
      sql`insert into vat_return_filings (vat_return_id, filed_on, transfer_ticket, kz83, filename, sha256, size) values (${other.id}, '2026-10-09', 'etX1234', 0, 'p.pdf', 'abc', 1)`,
    ).rejects.toThrow(/ohne festgeschriebene Voranmeldung/);

    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026, new Date("2026-11-10T10:00:00Z"))) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const name = Object.keys(files).find((n) => n.startsWith("umsatzsteuer/2026-10/") && n.endsWith("_protokoll.pdf"));
    expect(name).toMatch(/2026-11-09_vermerk_.*_protokoll\.pdf$/);
    expect(new TextDecoder().decode(files[name!])).toContain("Übermittlungsprotokoll Oktober");
    expect(new TextDecoder().decode(files["umsatzsteuer/2026-10/übermittlungen.csv"])).toContain("Abgabe vermerkt");
  }, 60_000);
});
