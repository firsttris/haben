import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Kz 66 muss in beiden Quellen dasselbe sagen (#786). Die Buchung legt die Vorsteuer einer Gutschrift „erstattet
 * bereits Bezahltes“ beim Buchen auf das Zwischenkonto (SKR03 1548, SKR04 1434) und zieht sie erst beim Ausgleich auf
 * die Vorsteuer; die Voranmeldung aus den Nebenbüchern verteilt sie über gutschrift.ts nach derselben Regel.
 *
 * Geprüft wird je Monat die Zeile „Vorsteuer (Kz 66)“ des Abgleichs: Journal gegen Nebenbücher, über alle Wege, die
 * den Ausgleich herstellen (Bankerstattung, Verrechnung, Teilerstattung, ausgebuchtes Skonto, Kursdifferenz), über die
 * Jahresgrenze und in beiden Kontenrahmen mit beiden Versteuerungsarten. Weichen die beiden Seiten um einen Cent ab,
 * ist das ein Befund, keine Rundung.
 */

describe.skipIf(!testDatabaseUrl)("Kz 66: Journal und Nebenbücher je Monat gleich (Postgres, #786)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("../bank/bank.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "kz66-paritaet";
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    bank = await import("../bank/bank.ts");
    verrechnung = await import("../bank/verrechnung.ts");
    documents = await import("../belege/documents.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma mit Stichjahr 2027: 2026 und Januar 2027 rechnet die Voranmeldung aus den Nebenbüchern */
  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, invoice_lines, invoices, invoice_number_counters, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 'einzelunternehmen', 14, 2027)`;
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

  const zeile = (a: Awaited<ReturnType<typeof abgleich.vatAbgleich>>, posten: string) => a.zeilen.find((z) => z.posten === posten)!;

  /** Prüft die Kz-66-Zeile aller Monate eines Jahres auf Übereinstimmung und gibt die Werte zurück */
  async function pruefeJahr(jahr: number, monate = 12) {
    const werte: { monat: number; journal: number; quelle: number }[] = [];
    for (let monat = 1; monat <= monate; monat++) {
      const a = await abgleich.vatAbgleich({ year: jahr, month: monat });
      const kz66 = zeile(a, "Vorsteuer (Kz 66)");
      expect({ monat, journal: kz66.journal, quelle: kz66.quelle }).toEqual({ monat, journal: kz66.quelle, quelle: kz66.quelle });
      werte.push({ monat, journal: kz66.journal, quelle: kz66.quelle });
    }
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

  it("eine Gutschrift ohne die Angabe zählt im Belegmonat — in beiden Quellen", async () => {
    await firma("SKR03", "ist");
    await beleg("2026-05-11", [{ taxRate: 1900, net: -10_000, tax: -1_900 }], { nummer: "GS-OHNE-1" });

    const a = await abgleich.vatAbgleich({ year: 2026, month: 5 });
    const kz66 = zeile(a, "Vorsteuer (Kz 66)");
    expect({ journal: kz66.journal, quelle: kz66.quelle }).toEqual({ journal: -1_900, quelle: -1_900 });
    expect(zeile(await abgleich.vatAbgleich({ year: 2026, month: 6 }), "Vorsteuer (Kz 66)")).toMatchObject({ journal: 0, quelle: 0 });
  }, 60_000);

  it("der Jahresabgleich nennt keine Abweichung mehr in Kz 66", async () => {
    await firma("SKR03", "soll");
    await jahr2026();

    const jahr = await abgleich.abgleichJahr(2026, "2026-12-31");
    const kz66 = jahr.zeilen.filter((z) => z.posten === "Vorsteuer (Kz 66)");
    expect(kz66.length).toBeGreaterThan(0);
    for (const z of kz66) expect(z).toEqual({ ...z, journal: z.quelle });
    const abweichungen = abgleich.abgleichIssues(jahr).filter((i) => i.tone === "warn" && i.text.includes("Vorsteuer (Kz 66)"));
    expect(abweichungen).toEqual([]);
  }, 120_000);
});
