import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abgleich vor dem Stichjahr: Eine Gutschrift „erstattet bereits Bezahltes“ (#786) steht mit ihrer Vorsteuer auf dem
 * Zwischenkonto (SKR03 1548, SKR04 1434). Die Voranmeldung aus den Belegen kennt dieses Konto nicht; sie zieht die
 * Vorsteuer im Belegmonat, das Journal erst beim Ausgleich. Der Abgleich zeigt deshalb eine Abweichung in Kz 66 — und
 * muss sie benennen: mit Betrag, Konto und Ursache, statt nur „Buchungen und Voranmeldung weichen ab“.
 *
 * Die Rechnung aus den Nebenbüchern liest das Zwischenkonto bewusst nicht mit; ob sie es künftig soll, ist eine eigene
 * Entscheidung (Bericht zu Etappe 4). Bis dahin trägt der Hinweis die Erklärung.
 */

const ZWISCHEN: Record<"SKR03" | "SKR04", string> = { SKR03: "1548", SKR04: "1434" };

describe.skipIf(!testDatabaseUrl)("Abgleich: Zwischenkonto der Gutschrift „erstattet bereits Bezahltes“ (Postgres, #786)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("../bank/bank.ts");
  let documents: typeof import("../belege/documents.ts");
  let core: typeof import("@haben/core");
  let sql: postgres.Sql;
  const actor = "abgleich-zwischenkonto";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 42]);
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    bank = await import("../bank/bank.ts");
    documents = await import("../belege/documents.ts");
    core = await import("@haben/core");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma mit Stichjahr 2027: 2026 rechnet die Voranmeldung damit aus den Nebenbüchern */
  async function firma(kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', ${kontenrahmen}, 'einzelunternehmen', 14, 2027)`;
  }

  /** Gebuchte Gutschrift des Lieferanten über 100,00 € netto zu 19 %; negativ, wie eine Gutschrift einzugeben ist */
  async function gutschrift(datum: string) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `gutschrift-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `GS-${lauf}`,
      documentDate: datum,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes: true,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Erstattung über einen echten Bankumsatz; `betrag` in Cent, positiv wie auf dem Konto */
  async function erstattung(documentId: string, betrag: number, datum: string) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Erstattung";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `erstattung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by booking_date limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  const zeile = (a: Awaited<ReturnType<typeof abgleich.vatAbgleich>>, posten: string) => a.zeilen.find((z) => z.posten === posten)!;

  it("im Belegmonat nennt der Abgleich die geparkte Vorsteuer mit Betrag und Konto", async () => {
    await firma("SKR03");
    await gutschrift("2026-09-15");

    const a = await abgleich.vatAbgleich({ year: 2026, month: 9 });
    const kz66 = zeile(a, "Vorsteuer (Kz 66)");
    // Journal: nichts auf der Vorsteuer; Nebenbücher: die Gutschrift mindert sie im Belegmonat
    expect(kz66).toMatchObject({ journal: 0, quelle: -1_900 });
    expect(a.hinweise).toEqual([
      `Gutschrift „erstattet bereits Bezahltes“: Vorsteuer von ${core.formatEuro(1_900)} ist in diesem Zeitraum auf 1548 (SKR04 1434) geparkt. ` +
        `Die Voranmeldung aus den Belegen zieht sie im Belegmonat, das Journal erst beim Ausgleich; deshalb weicht „Vorsteuer (Kz 66)“ ab: ` +
        `Buchungen ${core.formatEuro(0)}, Belege ${core.formatEuro(-1_900)}.`,
    ]);
  }, 30_000);

  it("im Monat der Erstattung nennt er die Umbuchung, und die Abweichung dreht sich", async () => {
    await firma("SKR03");
    const id = await gutschrift("2026-09-15");
    await erstattung(id, 11_900, "2026-10-05");

    const a = await abgleich.vatAbgleich({ year: 2026, month: 10 });
    expect(zeile(a, "Vorsteuer (Kz 66)")).toMatchObject({ journal: -1_900, quelle: 0 });
    expect(a.hinweise).toHaveLength(1);
    expect(a.hinweise[0]).toContain(`Vorsteuer von ${core.formatEuro(1_900)} ist in diesem Zeitraum vom Zwischenkonto`);
    expect(a.hinweise[0]).toContain("auf die Vorsteuer umgebucht");
  }, 30_000);

  it("SKR04 bucht auf 1434 und meldet dasselbe", async () => {
    await firma("SKR04");
    await gutschrift("2026-09-15");

    const a = await abgleich.vatAbgleich({ year: 2026, month: 9 });
    expect(zeile(a, "Vorsteuer (Kz 66)")).toMatchObject({ journal: 0, quelle: -1_900 });
    expect(a.hinweise[0]).toContain(ZWISCHEN.SKR04);
  }, 30_000);

  it("der Jahresabgleich trägt die Hinweise, und die Vorprüfung zeigt Abweichung und Ursache", async () => {
    await firma("SKR03");
    const id = await gutschrift("2026-09-15");
    await erstattung(id, 5_950, "2026-11-10");

    const jahr = await abgleich.abgleichJahr(2026, "2026-12-31");
    const geparkt = jahr.hinweise.filter((h) => h.includes("geparkt"));
    expect(geparkt.length).toBeGreaterThan(0);

    const issues = abgleich.abgleichIssues(jahr);
    // Zwei Abweichungen: September (geparkt) und November (Umbuchung der Teilzahlung)
    const abweichungen = issues.filter((i) => i.tone === "warn" && i.text.includes("Vorsteuer (Kz 66)"));
    expect(abweichungen).toHaveLength(2);
    const texte = abweichungen.map((i) => i.text).join(" ");
    expect(texte).toContain(core.formatEuro(-1_900));
    expect(texte).toContain(core.formatEuro(-950));
    // Und je Abweichung die Ursache
    const ursachen = issues.filter((i) => i.tone === "info" && i.text.includes("erstattet bereits Bezahltes"));
    expect(ursachen).toHaveLength(2);
    expect(ursachen.map((i) => i.text).join(" ")).toContain("auf die Vorsteuer umgebucht");
  }, 30_000);
});
