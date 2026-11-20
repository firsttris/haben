import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { ACTOR, dkbCsv, firma, kunde } from "./test-liquiditaet.ts";

/*
 * Kontostände und offene Posten in der Liquiditätsvorschau (#1381) gegen Postgres: welche Konten zählen, Forderungen mit
 * Teilzahlung und Storno, Steuer zum Zahlungseingang nur bei Istversteuerung, überfällige Forderungen, Verbindlichkeiten
 * nur mit Zahlung „Bank“. SKR03 mit Ist, SKR04 mit Soll.
 */

describe.skipIf(!testDatabaseUrl)("Liquiditätsvorschau: Konten und offene Posten (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let konten: typeof import("./konten.ts");
  let offene: typeof import("./offene-posten.ts");
  let kontext: typeof import("./kontext.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    konten = await import("./konten.ts");
    offene = await import("./offene-posten.ts");
    kontext = await import("./kontext.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("Bestand aus Geschäfts-, Steuer- und Dienstleisterkonten, Rücklage daneben, private und ausgeschlossene Konten nicht", async () => {
    await firma(sql, { kontenrahmen: "SKR03", versteuerung: "ist" });
    const konto = async (name: string, purpose: string, iban: string | null, stand: number | null, bis: string | null, ausgeschlossen = false) => {
      const [row] = await sql<{ id: string }[]>`insert into bank_accounts (name, purpose, iban, provider, ledger_index, excluded_at)
        values (${name}, ${purpose}, ${iban}, ${purpose === "zahlungsdienstleister" ? "paypal" : null}, ${purpose === "zahlungsdienstleister" ? 1 : null},
                ${ausgeschlossen ? "2026-11-01T00:00:00Z" : null}) returning id`;
      if (bis)
        await sql`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, closing_balance, added, skipped)
          values (${row!.id}, 'a.csv', ${name.padEnd(64, "0")}, 'camt', '2026-11-01', ${bis}, ${stand}, 1, 0)`;
    };
    await konto("Giro", "geschaeft", "DE02100100100006820101", 1_200_000, "2026-11-19");
    // Älter als drei Tage: Hinweis mit Datum
    await konto("Steuer", "steuer", "DE02120300000000202051", 300_000, "2026-11-10");
    await konto("Rücklage", "ruecklage", "DE02500105170137075030", 500_000, "2026-11-19");
    await konto("Privat", "privat", "DE02370501980001802057", 9_000_000, "2026-11-19");
    await konto("Fremd", "geschaeft", "DE02300209000106531065", null, null, true);
    // Datei ohne Saldo: Stand fehlt
    await konto("N26", "geschaeft", "DE02100110012620392050", null, "2026-11-19");
    await konto("PayPal", "zahlungsdienstleister", null, null, null);

    const stand = await konten.kontostaende("2026-11-20");
    expect(stand.konten.map((k) => [k.name, k.zweck, k.stand, k.alt])).toEqual([
      ["Giro", "geschaeft", 1_200_000, false],
      ["N26", "geschaeft", null, false],
      ["PayPal", "zahlungsdienstleister", 0, false],
      ["Rücklage", "ruecklage", 500_000, false],
      ["Steuer", "steuer", 300_000, true],
    ]);
    expect(stand).toMatchObject({ bestand: 1_500_000, ruecklage: 500_000 });
  });

  async function rechnung(contactId: string, net: number, issueDate: string) {
    const draft = await invoices.createDraft(ACTOR, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(ACTOR, draft.id, kleinunternehmerStand);
  }

  async function beleg(marker: number, payment: "bank" | "privat", dueDate: string) {
    const { id } = await documents.uploadDocument(ACTOR, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]), filename: `beleg-${marker}.jpg` });
    await documents.updateDocument(ACTOR, id, {
      supplierName: "Telekom",
      supplierUstId: "",
      invoiceNumber: `B-${marker}`,
      documentDate: "2026-11-02",
      dueDate,
      category: "telefon",
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(ACTOR, id);
    return id;
  }

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "Forderungen, Verbindlichkeiten und überfällige Forderungen (%s, %s)",
    async (kontenrahmen, versteuerung) => {
      await firma(sql, { kontenrahmen, versteuerung });
      const contactId = await kunde(contacts);
      // 1.190 €, fällig 16.11. (02.11. + 14 Tage): überfällig
      const ueberfaellig = await rechnung(contactId, 100_000, "2026-11-02");
      // 2.380 €, zur Hälfte bezahlt, fällig 30.11. (16.11. + 14)
      const teilweise = await rechnung(contactId, 200_000, "2026-11-16");
      await bank.importStatement(ACTOR, dkbCsv([["18.11.26", "Nordwerk", "Abschlag", "1.190,00"]]), null);
      const [tx] = await sql<{ id: string }[]>`select id from bank_transactions`;
      await bank.allocate(ACTOR, { kind: "invoice", transactionId: tx!.id, invoiceId: teilweise.id, amount: 119_000 });
      // Storniert: nichts mehr offen
      const storniert = await rechnung(contactId, 50_000, "2026-11-16");
      await invoices.cancelInvoice(ACTOR, storniert.id, "2026-11-17");
      const telekom = await beleg(1, "bank", "2026-11-25");
      await beleg(2, "privat", "2026-11-25");

      const k = await kontext.ladeKontext("2026-11-20", "13w");
      const posten = await offene.offenePostenPosten(k, { ueberfaellige: true });
      const ist = versteuerung === "ist";
      expect(posten).toEqual([
        {
          // Freitag, 20.11.: nächster Werktag ist Montag, der 23.
          datum: "2026-11-23",
          betrag: 119_000,
          richtung: "ein",
          text: `${ueberfaellig.number} · Nordwerk Software GmbH`,
          quelle: { art: "rechnung", id: ueberfaellig.id },
          sicherheit: "geschaetzt",
          ueberfaellig: true,
          ...(ist ? { steuer: { betrag: 19_000, datum: "2026-11-23" } } : {}),
        },
        {
          datum: "2026-11-30",
          betrag: 119_000,
          richtung: "ein",
          text: `${teilweise.number} · Nordwerk Software GmbH`,
          quelle: { art: "rechnung", id: teilweise.id },
          sicherheit: "erwartet",
          ...(ist ? { steuer: { betrag: 19_000, datum: "2026-11-30" } } : {}),
        },
        { datum: "2026-11-25", betrag: 11_900, richtung: "aus", text: "B-1 · Telekom", quelle: { art: "beleg", id: telekom }, sicherheit: "fest" },
      ]);

      const ohne = await offene.offenePostenPosten(k, { ueberfaellige: false });
      expect(ohne.map((p) => p.quelle.id)).toEqual([teilweise.id, telekom]);
    },
    30_000,
  );
});
