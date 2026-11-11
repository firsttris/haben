import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const ACCOUNT_IBAN = "DE89370400440532013000";
const SUPPLIER_IBAN = "DE02120300000000202051";
const OTHER_IBAN = "DE75512108001245126199";

/** E-Rechnung (CII) mit Skonto nach XRechnung BR-DE-18: 2 % in 7 Tagen, 1 % in 14 Tagen; IBAN (BT-84) DE0212… */
const einvoice = () =>
  new TextEncoder().encode(
    readFileSync(new URL("../../../../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8").replace(
      "<a:SpecifiedTradePaymentTerms>",
      "<a:SpecifiedTradePaymentTerms><a:Description>#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\n</a:Description></a:SpecifiedTradePaymentTerms><a:SpecifiedTradePaymentTerms>",
    ),
  );

/** Kontoauszug als camt.053 mit einer Abbuchung; EndToEndId wie in der hochgeladenen pain.001 */
function camt(entries: { date: string; amount: string; name: string; iban: string; endToEndId: string; purpose: string }[]) {
  const ntry = entries
    .map(
      (e, i) => `<Ntry><Amt Ccy="EUR">${e.amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${e.date}</Dt></BookgDt>
      <AcctSvcrRef>BANK-${i}</AcctSvcrRef><NtryDtls><TxDtls><Refs><EndToEndId>${e.endToEndId}</EndToEndId></Refs>
      <RltdPties><Cdtr><Nm>${e.name}</Nm></Cdtr><CdtrAcct><Id><IBAN>${e.iban}</IBAN></Id></CdtrAcct></RltdPties>
      <RmtInf><Ustrd>${e.purpose}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`,
    )
    .join("");
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>T</MsgId><CreDtTm>2026-09-30T06:00:00+02:00</CreDtTm></GrpHdr>
<Stmt><Id>1</Id><CreDtTm>2026-09-30T06:00:00+02:00</CreDtTm><Acct><Id><IBAN>${ACCOUNT_IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>${ntry}</Stmt></BkToCstmrStmt></Document>`);
}

describe.skipIf(!testDatabaseUrl)("SEPA-Überweisungen (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  // Am Tag nach der Rechnung (15.09.2026): 2 % Skonto laufen bis 22.09.
  const now = new Date("2026-09-16T08:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate document_iban_decisions, sepa_transfer_items, sepa_transfers, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, journal_lines, journal_entries, document_amounts, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, bic, versteuerung, kontenrahmen)
      values (1, 'Müller & Söhne Design', 'Musterstraße 1', '93047', 'Regensburg', 'a@example.com', '198/113/10010', 'BY',
              ${ACCOUNT_IBAN}, 'COBADEFFXXX', ${versteuerung}, ${kontenrahmen})`;
  }

  beforeEach(() => company("SKR03", "ist"));

  async function supplier(name: string, iban: string) {
    return contacts.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "",
      plz: "",
      ort: "",
      land: "DE",
      email: "",
      ustId: "",
      iban,
      leitwegId: "",
      defaultFormat: null,
      isCustomer: false,
      isSupplier: true,
    });
  }

  let counter = 0;
  async function bookedDocument(fields: { supplierName: string; invoiceNumber: string; contactId?: string; net: number; currency?: string }) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ++counter]), filename: `beleg-${counter}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: fields.supplierName,
      supplierUstId: "",
      supplierContactId: fields.contactId ?? null,
      invoiceNumber: fields.invoiceNumber,
      documentDate: "2026-09-10",
      dueDate: "2026-09-24",
      category: "buero",
      payment: "bank",
      note: "",
      currency: fields.currency ?? "EUR",
      exchangeRate: fields.currency ? "1,0812" : null,
      // Fremdwährung: Originalbeträge, Euro rechnet Haben mit dem Kurs aus
      amounts: [
        fields.currency
          ? { taxRate: 1900, net: 0, tax: 0, originalNet: fields.net, originalTax: Math.round(fields.net * 0.19) }
          : { taxRate: 1900, net: fields.net, tax: Math.round(fields.net * 0.19) },
      ],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function bookedEInvoice() {
    const { id } = await documents.uploadDocument(actor, { bytes: einvoice(), filename: "RE-2026-0815.xml" });
    await documents.updateDocument(actor, id, {
      supplierName: "Netzwerk Hosting GmbH",
      supplierUstId: "DE987654321",
      invoiceNumber: "RE-2026/0815",
      documentDate: "2026-09-15",
      dueDate: "2026-09-29",
      category: "software",
      payment: "bank",
      note: "",
      amounts: [
        { taxRate: 1900, net: 15_432, tax: 2_932 },
        { taxRate: 700, net: 2_990, tax: 209 },
      ],
    });
    await documents.bookDocument(actor, id);
    // Ohne Kontakt mit IBAN gilt die der E-Rechnung erst nach ausdrücklicher Bestätigung am Beleg (#410)
    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: SUPPLIER_IBAN });
    return id;
  }

  async function account() {
    return bank.createAccount(actor, { name: "Geschäftskonto", iban: ACCOUNT_IBAN });
  }

  it("Auswahl: IBAN aus Kontakt oder E-Rechnung, Skonto nur mit Angabe; fehlende und ungültige IBAN klar gemeldet", async () => {
    const mueller = await supplier("Büro Müller", OTHER_IBAN);
    // Die Kontakte prüfen nur die Form der IBAN, nicht die Prüfziffer
    const typo = await supplier("Tippfehler GmbH", "DE00370400440532013000");
    const withContact = await bookedDocument({ supplierName: "Büro Müller", invoiceNumber: "BM-1", contactId: mueller.id, net: 10_000 });
    const withoutIban = await bookedDocument({ supplierName: "Ohne Konto KG", invoiceNumber: "OK-1", net: 5_000 });
    const invalid = await bookedDocument({ supplierName: "Tippfehler GmbH", invoiceNumber: "TF-1", contactId: typo.id, net: 2_000 });
    const foreign = await bookedDocument({ supplierName: "US Inc.", invoiceNumber: "US-1", net: 3_000, currency: "USD" });
    const swiss = await supplier("Zürich AG", "CH9300762011623852957");
    const outsideEwr = await bookedDocument({ supplierName: "Zürich AG", invoiceNumber: "ZH-1", contactId: swiss.id, net: 4_000 });
    const eRechnung = await bookedEInvoice();

    const byId = new Map((await bank.transferCandidates()).map((c) => [c.documentId, c]));
    expect(byId.get(withContact)).toMatchObject({ open: 11_900, iban: OTHER_IBAN, ibanSource: "kontakt", problem: null, skontoTerms: [] });
    expect(byId.get(withoutIban)).toMatchObject({ iban: null, problem: "IBAN fehlt: im Kontakt des Lieferanten eintragen" });
    expect(byId.get(invalid)?.problem).toBe("IBAN DE00370400440532013000 ist ungültig (Kontakt)");
    expect(byId.get(foreign)?.problem).toBe("Rechnung in USD: SEPA überweist nur Euro");
    expect(byId.get(outsideEwr)?.problem).toBe("IBAN CH9300762011623852957 liegt außerhalb des EWR: bitte direkt im Online-Banking überweisen");
    expect(byId.get(eRechnung)).toMatchObject({
      open: 21_563,
      iban: SUPPLIER_IBAN,
      ibanSource: "e-rechnung",
      problem: null,
      skontoTerms: [
        { days: 7, percent: 200 },
        { days: 14, percent: 100 },
      ],
    });

    // Fehlende IBAN verhindert die Datei, mit Name des Lieferanten in der Meldung
    const { id: accountId } = await account();
    await expect(
      bank.createSepaTransfer(actor, { bankAccountId: accountId, executionDate: "2026-09-17", items: [{ documentId: withoutIban, skonto: false }] }, now),
    ).rejects.toThrow("Ohne Konto KG: IBAN fehlt");
    await expect(
      bank.createSepaTransfer(actor, { bankAccountId: accountId, executionDate: "2026-09-15", items: [{ documentId: withContact, skonto: false }] }, now),
    ).rejects.toThrow("Das Ausführungsdatum liegt in der Vergangenheit.");
    // Skonto, das der Beleg nicht anbietet, gibt es nicht
    await expect(
      bank.createSepaTransfer(actor, { bankAccountId: accountId, executionDate: "2026-09-17", items: [{ documentId: withContact, skonto: true }] }, now),
    ).rejects.toThrow("Skonto ist zum Ausführungsdatum nicht mehr möglich");
    expect(await sql`select 1 from sepa_transfers`).toHaveLength(0);
  }, 60_000);

  it("Datei: pain.001 mit Summe und Skonto, Vermerk mit Audit, gebucht wird nichts; die Zeilen sind unveränderlich", async () => {
    const mueller = await supplier("Büro Müller", OTHER_IBAN);
    const withContact = await bookedDocument({ supplierName: "Büro Müller", invoiceNumber: "BM-1", contactId: mueller.id, net: 10_000 });
    const eRechnung = await bookedEInvoice();
    const { id: accountId } = await account();
    const journalBefore = await sql`select count(*)::int as n from journal_entries`;

    const { id, filename } = await bank.createSepaTransfer(
      actor,
      {
        bankAccountId: accountId,
        executionDate: "2026-09-17",
        items: [
          { documentId: withContact, skonto: false },
          { documentId: eRechnung, skonto: true },
        ],
      },
      now,
    );
    expect(filename).toMatch(/^HABEN-[0-9A-F]{16}\.xml$/);
    const file = await bank.sepaTransferFile(id);
    // 2 % von 215,63 € = 4,31 €
    expect(file?.xml).toContain("<NbOfTxs>2</NbOfTxs>");
    expect(file?.xml).toContain(`<CtrlSum>${(11_900 + 21_563 - 431) / 100}</CtrlSum>`);
    expect(file?.xml).toContain("<Nm>Mueller + Soehne Design</Nm>");
    expect(file?.xml).toContain("<BICFI>COBADEFFXXX</BICFI>");
    expect(file?.xml).toContain("<CreDtTm>2026-09-16T10:00:00</CreDtTm>");
    expect(file?.xml).toContain("<Ustrd>RE-2026/0815 abzgl. 2,00 Prozent Skonto 4,31 EUR</Ustrd>");
    expect(file?.xml).toContain("<Ustrd>BM-1</Ustrd>");
    expect(file?.xml).toContain(`<IBAN>${SUPPLIER_IBAN}</IBAN>`);

    // Vermerk am Beleg, nicht bezahlt
    const [vermerk] = await bank.documentSepaTransfers(eRechnung);
    expect(vermerk).toMatchObject({ executionDate: "2026-09-17", amount: 21_132, skonto: 431 });
    expect(file?.xml).toContain(`<EndToEndId>${vermerk!.endToEndId}</EndToEndId>`);
    expect((await bank.transferCandidates()).find((c) => c.documentId === eRechnung)?.transfers).toHaveLength(1);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual(journalBefore);
    expect(await sql`select 1 from allocations`).toHaveLength(0);
    expect((await bank.openItems()).map((i) => i.id).sort()).toEqual([withContact, eRechnung].sort());

    const audit = await sql`select table_name, action from audit_log where table_name like 'sepa_%' order by seq`;
    expect(audit.map((a) => [a.table_name, a.action])).toEqual([
      ["sepa_transfers", "INSERT"],
      ["sepa_transfer_items", "INSERT"],
      ["sepa_transfer_items", "INSERT"],
    ]);
    await expect(sql`update sepa_transfer_items set amount = 1`).rejects.toThrow();
    await expect(sql`delete from sepa_transfers`).rejects.toThrow();
    expect((await bank.listSepaTransfers())[0]).toMatchObject({ id, numberOfTransactions: 2, controlSum: 33_032, accountName: "Geschäftskonto" });
  }, 60_000);

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`Bankabgleich (${kontenrahmen}, ${versteuerung}): Abbuchung mit Skonto über die EndToEndId dem Beleg zugeordnet, Rest als erhaltenes Skonto`, async () => {
      await company(kontenrahmen, versteuerung);
      const eRechnung = await bookedEInvoice();
      // Ein zweiter offener Beleg desselben Lieferanten, damit Name und IBAN allein nicht entscheiden
      const other = await bookedDocument({ supplierName: "Netzwerk Hosting GmbH", invoiceNumber: "RE-2026/0900", net: 17_758 });
      const { id: accountId } = await account();
      await bank.createSepaTransfer(actor, { bankAccountId: accountId, executionDate: "2026-09-17", items: [{ documentId: eRechnung, skonto: true }] }, now);
      const [vermerk] = await bank.documentSepaTransfers(eRechnung);

      // Der Bank-Export kürzt den Verwendungszweck und nennt den Empfänger anders
      await bank.importStatement(
        actor,
        {
          bytes: camt([
            { date: "2026-09-17", amount: "211.32", name: "NETZWERK HOSTING", iban: SUPPLIER_IBAN, endToEndId: vermerk!.endToEndId, purpose: "Skonto" },
          ]),
          filename: "auszug.xml",
        },
        null,
      );
      const [tx] = await sql`select id, end_to_end_id from bank_transactions`;
      expect(tx!.end_to_end_id).toBe(vermerk!.endToEndId);
      const detail = await bank.transactionDetail(tx!.id);
      expect(detail?.suggestions[0]?.item.id).toBe(eRechnung);
      expect(detail?.suggestions[0]?.reasons).toContain(`Überweisung aus Haben (${vermerk!.endToEndId})`);
      expect(detail?.suggestions.find((s) => s.item.id === other)?.score ?? 0).toBeLessThan(detail!.suggestions[0]!.score);

      await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "document", documentId: eRechnung }, rest: "skontoErhalten" });
      expect((await bank.openItems()).map((i) => i.id)).toEqual([other]);
      const [writeOff] = await sql`select kind, amount from write_offs where document_id = ${eRechnung}`;
      expect(writeOff).toMatchObject({ kind: "skontoErhalten" });
      expect(Math.abs(Number(writeOff!.amount))).toBe(431);
      expect((await bank.transferCandidates()).map((c) => c.documentId)).toEqual([other]);
    }, 60_000);
  }
});
