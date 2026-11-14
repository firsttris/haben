import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const FORDERUNGEN = "Bilanzierte Forderungen aus neuen Anzahlungs-/Schlussketten";
const ANZAHLUNGEN = "Erhaltene Anzahlungen netto, neues Verfahren";

/** #782: Die Gegenzeile einer Aufhebung wirkt am Tag der Aufhebung, im Journal wie im OPOS-Nebenbuch. */
describe.skipIf(!testDatabaseUrl)("OPOS-Gegenprobe bei Aufhebung in einem späteren Monat (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/index.ts");
  let bank: typeof import("../bank/index.ts");
  let abgleich: typeof import("./abgleich.ts");
  let oposAbgleich: typeof import("./opos-abgleich.ts")["oposAbgleich"];
  let contactId: string;
  const actor = "opos-aufhebung-test";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/index.ts");
    bank = await import("../bank/index.ts");
    abgleich = await import("./abgleich.ts");
    ({ oposAbgleich } = await import("./opos-abgleich.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries, bank_accounts, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,telefon,steuernummer,bundesland,iban,kontenrahmen,versteuerung,rechtsform,journal_ab)
      values (1,'Muster GmbH','Musterstraße 1','93047','Regensburg','rechnung@example.com','0941 1','198/113/10010','BY',
        'DE89370400440532013000','SKR03','soll','gmbh',2025)`;
    const contacts = await import("../stammdaten/index.ts");
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Musterkunde GmbH",
        strasse: "Musterweg 7",
        plz: "12345",
        ort: "Musterstadt",
        land: "DE",
        email: "kunde@example.org",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function advance() {
    return invoices.finalizeInvoice(
      actor,
      (
        await invoices.createDraft(actor, {
          contactId,
          issueDate: "2025-12-01",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd",
          note: "",
          variant: "abschlag",
          advanceType: "anzahlung",
          lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
        })
      ).id,
    );
  }
  async function bankPayment(invoiceId: string, date: string, amount: number) {
    const dateDkb = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
    const text = `Zahlung ${invoiceId}`;
    const csv =
      `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      [
        dateDkb,
        dateDkb,
        "Gebucht",
        "Musterkunde",
        "Muster GmbH",
        text,
        "Eingang",
        "DE02100100100006820101",
        (amount / 100).toFixed(2).replace(".", ","),
        "",
        "",
        "",
      ]
        .map((v) => `"${v}"`)
        .join(";");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "zahlung.csv" }, null);
    const [transaction] = await sql`select id from bank_transactions where purpose=${text}`;
    await bank.allocate(actor, { kind: "invoice", transactionId: transaction!.id, invoiceId, amount });
  }
  function expected(cutoff: string, receivables: number, advances: number) {
    return [
      { bereich: "opos", zeitraum: cutoff, posten: FORDERUNGEN, journal: receivables, quelle: receivables },
      { bereich: "opos", zeitraum: cutoff, posten: ANZAHLUNGEN, journal: advances, quelle: advances },
    ];
  }

  it.each([
    ["SKR03", "soll"],
    ["SKR04", "ist"],
  ] as const)("%s/%s: Anzahlung im Dezember, Aufhebung im Februar – Januar zeigt die Anzahlung in Journal und Nebenbuch", async (frame, mode) => {
    await sql`update company set kontenrahmen=${frame}, versteuerung=${mode}`;
    const a = await advance();
    await bankPayment(a.id, "2025-12-12", 35_700);
    const [allocation] = await sql`select id from allocations where invoice_id=${a.id}`;
    await bank.reverseAllocation(actor, allocation!.id, "2026-02-10");
    // Bis zum Tag der Aufhebung steht die erhaltene Anzahlung im Journal; das Nebenbuch muss dasselbe zeigen
    expect((await oposAbgleich("2026-01-31")).zeilen).toEqual(expected("2026-01-31", 0, 30_000));
    expect((await oposAbgleich("2026-02-28")).zeilen).toEqual(expected("2026-02-28", 0, 0));
    expect(abgleich.abweichungen((await abgleich.abgleichJahr(2026, "2026-02-28")).zeilen.filter((z) => z.bereich === "opos"))).toEqual([]);
  });
});
