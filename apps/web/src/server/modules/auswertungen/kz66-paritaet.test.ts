import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Kz 66 je Monat (#786, #1116). Die Buchung legt die Vorsteuer einer Gutschrift „erstattet bereits Bezahltes“ beim Buchen
 * auf das Zwischenkonto (SKR03 1548, SKR04 1434) und zieht sie erst beim Ausgleich auf die Vorsteuer; die Voranmeldung
 * rechnet Kz 66 aus dem Journal.
 *
 * Geprüft wird je Monat Kz 66 gegen feste Werte (KZ66), über alle Wege, die den Ausgleich herstellen (Bankerstattung,
 * Verrechnung, Teilerstattung, ausgebuchtes Skonto, Kursdifferenz), über die Jahresgrenze und in beiden Kontenrahmen mit
 * beiden Versteuerungsarten. Die Werte lieferte bis #1116 die Voranmeldung aus den Nebenbüchern (gutschrift.ts) als
 * Gegenprobe; ein Cent Abweichung ist ein Befund, keine Rundung.
 */

describe.skipIf(!testDatabaseUrl)("Kz 66 je Monat aus dem Journal (Postgres, #786)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let bank: typeof import("../bank/index.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "kz66-paritaet";
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    vat = await import("../umsatzsteuer/index.ts");
    bank = await import("../bank/index.ts");
    verrechnung = await import("../bank/verrechnung.ts");
    documents = await import("../belege/documents.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma, Einzelunternehmen */
  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, invoice_lines, invoices, invoice_number_counters, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 'einzelunternehmen', 14)`;
  }

  type Betrag = { taxRate: 1900 | 700; net: number; tax: number; originalNet?: number; originalTax?: number };

  /** Gebuchter Beleg; negativ ist eine Gutschrift, `erstattetBezahltes` setzt die Angabe wie im Formular */
  async function beleg(
    datum: string,
    amounts: Betrag[],
    extra: { nummer?: string; lieferant?: string; erstattetBezahltes?: boolean; currency?: string; exchangeRate?: string } = {},
  ) {
    lauf++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: extra.lieferant ?? "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: extra.nummer ?? `B-${lauf}`,
      documentDate: datum,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      ...(extra.erstattetBezahltes ? { erstattetBezahltes: true } : {}),
      ...(extra.currency ? { currency: extra.currency, exchangeRate: extra.exchangeRate } : {}),
      amounts,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Bankumsatz und Zuordnung auf einen Beleg; `betrag` in Cent, positiv wie auf dem Konto */
  async function zahle(datum: string, zweck: string, betrag: number, documentId: string) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const kurz = `${tag}.${monat}.${jahr!.slice(2)}`;
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${kurz}";"${kurz}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"${zweck}";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `${zweck}-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions where purpose = ${zweck}`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
    return umsatz!.id as string;
  }

  /** Alle Wege, die eine Gutschrift ausgleichen, in einem Jahr */
  async function jahr2026() {
    // Februar-Gutschrift, Bankerstattung im März
    const stadtwerke = await beleg("2026-02-16", [{ taxRate: 1900, net: -36_938, tax: -7_018 }], {
      erstattetBezahltes: true,
      nummer: "GS-STW-1",
    });
    await zahle("2026-03-15", "Erstattung Stadtwerke", 43_956, stadtwerke);

    // Teilerstattung im August, Rest per Skonto im September (Skonto ändert die Vorsteuer nicht)
    const teilstueck = await beleg(
      "2026-07-10",
      [
        { taxRate: 1900, net: -100_000, tax: -19_000 },
        { taxRate: 700, net: -10_000, tax: -700 },
      ],
      { erstattetBezahltes: true, nummer: "GS-STW-2" },
    );
    await zahle("2026-08-12", "Teilerstattung Stadtwerke", 64_850, teilstueck);
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: teilstueck, date: "2026-09-30" });

    // Verrechnung gegen eine Rechnung im Juni
    const verrechnungsGutschrift = await beleg("2026-04-14", [{ taxRate: 1900, net: -3_000, tax: -570 }], {
      erstattetBezahltes: true,
      nummer: "GS-STW-3",
    });
    const rechnung = await beleg("2026-04-20", [{ taxRate: 1900, net: 5_000, tax: 950 }], { nummer: "RE-1" });
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: verrechnungsGutschrift,
      amount: 3_570,
      date: "2026-06-18",
      note: "Gutschrift verrechnet",
    });

    // Fremdwährung: 100,00 € erstattet, 10,06 € Kursdifferenz im November
    const acme = await beleg("2026-10-05", [{ taxRate: 1900, net: 0, tax: 0, originalNet: -10_000, originalTax: -1_900 }], {
      currency: "USD",
      exchangeRate: "1,0812",
      erstattetBezahltes: true,
      nummer: "GS-ACME-1",
    });
    await bank.importStatement(
      actor,
      {
        bytes: new TextEncoder().encode(
          `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
            `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
            `"12.11.26";"12.11.26";"Gebucht";"Acme Inc";"Testfirma";"Erstattung Acme";"Eingang";"DE02100100100006820101";"100,00";"";"";""\n`,
        ),
        filename: `acme-${++lauf}.csv`,
      },
      null,
    );
    const [acmeUmsatz] = await sql`select id from bank_transactions where purpose = ${"Erstattung Acme"}`;
    await bank.allocateWithRest(actor, {
      transactionId: acmeUmsatz!.id as string,
      target: { kind: "document", documentId: acme },
      rest: "kursdifferenz",
    });

    // Dezember-Gutschrift, Erstattung im Januar 2027: die Minderung gehört in den Januar
    const dezember = await beleg("2026-12-08", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], {
      erstattetBezahltes: true,
      nummer: "GS-STW-4",
    });
    await zahle("2027-01-09", "Erstattung Dezember", 11_900, dezember);
  }

  const kz66 = async (year: number, month: number) => (await vat.computeVatFigures({ year, month })).kz66;

  /** Kz 66 aller Monate eines Jahres gegen die festen Werte (KZ66) */
  async function pruefeJahr(jahr: number, monate = 12) {
    const werte: { monat: number; journal: number }[] = [];
    for (let monat = 1; monat <= monate; monat++) werte.push({ monat, journal: await kz66(jahr, monat) });
    const key = `${expect.getState().currentTestName!.split(" > ").at(-1)}|${jahr}`;
    expect(
      werte.map((w) => w.journal),
      key,
    ).toEqual(KZ66[key]);
    return werte;
  }

  const summe = (werte: { journal: number }[]) => werte.reduce((s, w) => s + w.journal, 0);

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}, ${versteuerung}: alle Ausgleichswege stimmen je Monat überein`, async () => {
        await firma(kontenrahmen, versteuerung);
        await jahr2026();

        const werte = await pruefeJahr(2026);
        const je = (monat: number) => werte.find((w) => w.monat === monat)!.journal;

        // Februar: die Gutschrift ist gebucht, aber noch nicht ausgeglichen — nichts abgezogen
        expect(je(2)).toBe(0);
        // März: Bankerstattung 439,56 € brutto, 70,18 € Vorsteuer
        expect(je(3)).toBe(-7_018);
        // Juni: Verrechnung 35,70 € brutto, 5,70 € Vorsteuer
        expect(je(6)).toBe(-570);
        // August: Teilerstattung 648,50 € brutto, 98,50 € Vorsteuer
        expect(je(8)).toBe(-9_850);
        // September: Skonto erlässt den Rest, ohne die Vorsteuer zu ziehen — 0 bleibt 0
        expect(je(9)).toBe(0);
        // Oktober: gebucht, noch nichts ausgeglichen
        expect(je(10)).toBe(0);
        // November: 100,00 € Erstattung plus Kursdifferenz, zusammen 17,57 € Vorsteuer
        expect(je(11)).toBe(-1_757);
        // Dezember: gebucht, die Erstattung kommt erst im Januar
        expect(je(12)).toBe(0);
        const januar = await pruefeJahr(2027, 1);
        expect(januar[0]!.journal).toBe(-1_900);

        // Über das Jahr abgezogen ist genau das, was erstattet oder verrechnet wurde; die Rechnung im April bringt
        // ihre eigene Vorsteuer von 9,50 € mit und bleibt dabei unberührt
        expect(summe(werte) + summe(januar)).toBe(-(7_018 + 570 + 9_850 + 1_757 + 1_900) + 950);
      }, 120_000);
    }
  }

  it("eine Gutschrift ohne die Angabe zählt im Belegmonat", async () => {
    await firma("SKR03", "ist");
    await beleg("2026-05-11", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], { nummer: "GS-OHNE-1" });

    expect(await kz66(2026, 5)).toBe(-1_900);
    expect(await kz66(2026, 6)).toBe(0);
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 5 })).zeilen)).toEqual([]);
  }, 60_000);

  it("der Jahresabgleich nennt keine Abweichung, auch nicht in der Verprobung der Vorsteuer", async () => {
    await firma("SKR03", "soll");
    await jahr2026();

    // Dieselben Monatswerte wie im Durchlauf aller Ausgleichswege
    const werte = [];
    for (let monat = 1; monat <= 12; monat++) werte.push(await kz66(2026, monat));
    expect(werte).toEqual(KZ66["SKR03, soll: alle Ausgleichswege stimmen je Monat überein|2026"]);
    const jahr = await abgleich.abgleichJahr(2026, "2026-12-31");
    expect(abgleich.abweichungen(jahr.zeilen)).toEqual([]);
    expect(abgleich.abgleichIssues(jahr).filter((i) => i.tone === "warn")).toEqual([]);
  }, 120_000);
  it("eine später zugeordnete, frühere Teilerstattung verschiebt keinen Cent zwischen den Monaten", async () => {
    await firma("SKR03", "ist");
    const id = await beleg("2026-01-15", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], { erstattetBezahltes: true, nummer: "GS-REIHE-1" });
    // Erst der Auszug vom April, dann ein älterer vom Februar nachgereicht
    await zahle("2026-04-20", "Teil April", 5_000, id);
    await zahle("2026-02-20", "Teil Februar", 3_967, id);
    await zahle("2026-05-20", "Rest Mai", 2_933, id);
    const werte = await pruefeJahr(2026, 5);
    expect(summe(werte)).toBe(-1_900);
  }, 60_000);
  it("eine aufgehobene frühere Teilerstattung nimmt genau ihren eigenen Anteil zurück", async () => {
    await firma("SKR03", "ist");
    const id = await beleg("2026-01-15", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], { erstattetBezahltes: true, nummer: "GS-AUF-1" });
    const februar = await zahle("2026-02-20", "Drittel Februar", 3_967, id);
    await zahle("2026-03-20", "Drittel März", 3_967, id);
    // Die Februar-Zuordnung war falsch und wird aufgehoben; der Rest kommt im Mai
    const [zuordnung] = await sql`select id from allocations where transaction_id = ${februar} and reverses_id is null`;
    // Die Aufhebung trägt ihr eigenes Datum (#782): ohne Datum bucht sie heute, und der Test hinge am Kalender des Laufs
    await bank.reverseAllocation(actor, zuordnung!.id as string, "2026-06-20");
    await zahle("2026-05-20", "Rest Mai", 7_933, id);
    const werte = await pruefeJahr(2026);
    expect(summe(werte)).toBe(-1_900);
  }, 60_000);

  it("eine Aufhebung wirkt auch bei der Gutschrift am Tag der Aufhebung", async () => {
    await firma("SKR03", "ist");
    const gutschrift = await beleg("2026-01-20", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], {
      erstattetBezahltes: true,
      nummer: "GS-AUFHEBUNG-TAG",
    });
    const februar = await zahle("2026-02-20", "Erstattung Februar", 3_967, gutschrift);
    await zahle("2026-03-20", "Erstattung März", 3_966, gutschrift);

    // Die Februar-Erstattung war falsch und wird erst im Mai aufgehoben: Die Gegenzeile mindert die Vorsteuer im Mai,
    // nicht rückwirkend im Februar
    const [zuordnung] = await sql`select id from allocations where transaction_id = ${februar} and reverses_id is null`;
    await bank.reverseAllocation(actor, zuordnung!.id as string, "2026-05-20");

    const werte = await pruefeJahr(2026, 5);
    const je = (monat: number) => werte.find((w) => w.monat === monat)!.journal;
    expect(je(2)).toBe(-633);
    expect(je(3)).toBe(-634);
    expect(je(5)).toBe(633);
    expect(summe(werte)).toBe(-634);
  }, 60_000);
});

/** Kz 66 je Monat und Test, wie sie bis #1116 die Voranmeldung aus den Nebenbüchern als Gegenprobe ergab */
const KZ66: Record<string, number[]> = {
  "SKR03, ist: alle Ausgleichswege stimmen je Monat überein|2026": [0, 0, -7018, 950, 0, -570, 0, -9850, 0, 0, -1757, 0],
  "SKR03, ist: alle Ausgleichswege stimmen je Monat überein|2027": [-1900],
  "SKR03, soll: alle Ausgleichswege stimmen je Monat überein|2026": [0, 0, -7018, 950, 0, -570, 0, -9850, 0, 0, -1757, 0],
  "SKR03, soll: alle Ausgleichswege stimmen je Monat überein|2027": [-1900],
  "SKR04, ist: alle Ausgleichswege stimmen je Monat überein|2026": [0, 0, -7018, 950, 0, -570, 0, -9850, 0, 0, -1757, 0],
  "SKR04, ist: alle Ausgleichswege stimmen je Monat überein|2027": [-1900],
  "SKR04, soll: alle Ausgleichswege stimmen je Monat überein|2026": [0, 0, -7018, 950, 0, -570, 0, -9850, 0, 0, -1757, 0],
  "SKR04, soll: alle Ausgleichswege stimmen je Monat überein|2027": [-1900],
  "eine später zugeordnete, frühere Teilerstattung verschiebt keinen Cent zwischen den Monaten|2026": [0, -634, 0, -798, -468],
  "eine aufgehobene frühere Teilerstattung nimmt genau ihren eigenen Anteil zurück|2026": [0, -633, -634, 0, -1266, 633, 0, 0, 0, 0, 0, 0],
  "eine Aufhebung wirkt auch bei der Gutschrift am Tag der Aufhebung|2026": [0, -633, -634, 0, 633],
};
