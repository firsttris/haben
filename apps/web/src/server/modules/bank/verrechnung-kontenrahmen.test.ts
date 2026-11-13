import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Verrechnung offener Posten in der ganzen Matrix (#274, Kriterium 6): SKR03 und SKR04, Ist- und Soll-Versteuerung.
 * Der Verrechnungspfad selbst kennt weder Konten noch Versteuerung — er rechnet mit den offenen Resten der Belege.
 * Diese Datei hält das fest: Reste, offene Posten, Zahlungsübersicht, Journal und EÜR müssen in jeder Kombination
 * denselben Ausgleich zeigen. Die bestehenden Fälle in verrechnung.test.ts bleiben unverändert.
 *
 * Warum die Erwartungen in allen vier Kombinationen gleich sind: Bei Eingangsbelegen hängt der Vorsteuerabzug an der
 * Rechnung, nicht an der Zahlung (§ 15 Abs. 1 Satz 1 Nr. 1 UStG); die Ist-Versteuerung betrifft nur die eigenen Umsätze
 * (§ 20 Satz 1 UStG). Die Versteuerung darf hier also nichts ändern. Die Konten dagegen unterscheiden sich je
 * Kontenrahmen (DATEV SKR03/SKR04 2026, Konten in packages/core/src/posting.ts, ACCOUNTS); der erste Fall prüft sie, damit ein
 * Fehler im Kontenrahmen nicht von den gleichen Beträgen verdeckt wird. In der EÜR zählt die Verrechnung wie eine
 * Zahlung am Tag der Aufrechnung: Die Aufrechnung mit einer fälligen Gegenforderung ist eine Leistung im Sinne des
 * § 11 Abs. 2 EStG (H 11 EStH „Aufrechnung“, BFH vom 19.04.1977, BStBl II S. 601; docs/belege-bezahlen.md).
 */
type Profil = { kr: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" };

/** Konten des Belegs je Kontenrahmen: Telefonaufwand, Vorsteuer 19 %, Verbindlichkeiten */
const KONTEN = {
  SKR03: { telefon: "4920", vorsteuer: "1576", verbindlichkeiten: "1600" },
  SKR04: { telefon: "6805", vorsteuer: "1406", verbindlichkeiten: "3300" },
} as const;

const profile: Profil[] = [
  { kr: "SKR03", versteuerung: "ist" },
  { kr: "SKR03", versteuerung: "soll" },
  { kr: "SKR04", versteuerung: "ist" },
  { kr: "SKR04", versteuerung: "soll" },
];

describe.skipIf(!testDatabaseUrl)("Verrechnung in beiden Kontenrahmen und Versteuerungen (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let bank: typeof import("./index.ts");
  let euerJournal: typeof import("../auswertungen/euer-journal.ts");
  let sql: postgres.Sql;
  const actor = "test-matrix";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    verrechnung = await import("./verrechnung.ts");
    reports = await import("../auswertungen/reports.ts");
    bank = await import("./index.ts");
    euerJournal = await import("../auswertungen/euer-journal.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma im gewünschten Profil; alles andere wird geleert, damit jeder Fall bei null beginnt */
  async function firma(profil: Profil) {
    await leeren(sql)`truncate document_settlements, year_closings, write_offs, allocations, cash_entries, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, documents, document_amounts, document_splits,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', ${profil.versteuerung}, ${profil.kr},
              'einzelunternehmen', 14)`;
  }

  /** Gebuchter Beleg über die Bank; negativ ergibt eine Gutschrift des Lieferanten */
  async function beleg(datum: string, netto: number, steuer: number, kategorie: "software" | "telefon" = "telefon", lieferant = "Telekom Deutschland GmbH") {
    // Eigene Bytes je Beleg: gleiche Datei erkennt Haben als Dublette und gibt den ersten Beleg zurück
    const bytes = new Uint8Array([...JPEG, ++lauf % 251, Math.abs(netto) % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `matrix-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: lieferant,
      supplierUstId: "",
      invoiceNumber: `R-${datum}-${netto}`,
      documentDate: datum,
      dueDate: null,
      category: kategorie,
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: netto, tax: steuer }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Teilzahlung über einen echten Bankumsatz; `betrag` in Cent, negativ wie auf dem Konto */
  async function zahlung(documentId: string, betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Testfirma";"Telekom Deutschland GmbH";"Teilzahlung";"Ausgang";"DE02100100100006820101";"${betrag < 0 ? "-" : ""}${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by booking_date limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  /** Anzahl der Journal-Zeilen: eine Verrechnung darf keine eigene Buchung erzeugen */
  async function buchungen() {
    const [row] = await sql`select count(*)::int as n from journal_entries`;
    return row!.n as number;
  }

  for (const profil of profile) {
    describe(`${profil.kr}, ${profil.versteuerung === "ist" ? "Ist" : "Soll"}-Versteuerung`, () => {
      it("gleicht vollständig aus: beide Reste 0, keine Buchung, nichts mehr offen", async () => {
        await firma(profil);
        const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
        // Journal in den Konten des eingestellten Kontenrahmens; Ist und Soll ändern daran nichts
        const zeilen = await sql`select l.account, l.debit, l.credit from journal_lines l
            join journal_entries e on e.id = l.entry_id where e.source_id = ${rechnung} order by l.account`;
        expect(zeilen.map((z) => [z.account, z.debit, z.credit])).toEqual([
          [KONTEN[profil.kr].vorsteuer, 1_900, 0],
          [KONTEN[profil.kr].verbindlichkeiten, 0, 11_900],
          [KONTEN[profil.kr].telefon, 10_000, 0],
        ]);
        const gutschrift = await beleg("2026-02-16", -10_000, -1_900); // -119,00 EUR
        const journalVorher = await buchungen();

        await verrechnung.settleDocuments(actor, {
          documentId: rechnung,
          counterDocumentId: gutschrift,
          amount: 11_900,
          date: "2026-02-16",
          note: "Vollausgleich",
        });

        expect(await verrechnung.openAmount(rechnung)).toBe(0);
        expect(await verrechnung.openAmount(gutschrift)).toBe(0);
        // Die Entscheidung im Code: keine Buchung, weil kein Geld fließt
        expect(await buchungen()).toBe(journalVorher);
        const offen = await reports.openPositions("2026-02-20");
        expect(offen.payables).toEqual([]);
        expect(await bank.transferCandidates()).toEqual([]);
      }, 30_000);

      it("lässt bei Teilverrechnung den Rest in richtiger Höhe offen — offene Posten und Zahlungsübersicht zeigen ihn", async () => {
        await firma(profil);
        const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
        const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR

        await verrechnung.settleDocuments(actor, {
          documentId: rechnung,
          counterDocumentId: gutschrift,
          amount: 2_000,
          date: "2026-02-16",
          note: "Teilverrechnung",
        });

        expect(await verrechnung.openAmount(rechnung)).toBe(9_900);
        expect(await verrechnung.openAmount(gutschrift)).toBe(-1_570);
        const offen = await reports.openPositions("2026-02-20");
        expect(offen.payables.map((p) => [p.id, p.open])).toEqual(
          expect.arrayContaining([
            [rechnung, 9_900],
            [gutschrift, -1_570],
          ]),
        );
        // Zahlungsübersicht (SEPA-Vorschläge) führt nur positive Reste: die Rechnung mit 99,00 EUR
        const vorschlag = (await bank.transferCandidates()).find((c) => c.documentId === rechnung);
        expect(vorschlag?.open).toBe(9_900);
        expect((await bank.transferCandidates()).some((c) => c.documentId === gutschrift)).toBe(false);
      }, 30_000);

      it("verrechnet den Rest eines bereits teilweise bezahlten Belegs", async () => {
        await firma(profil);
        const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
        const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR
        await zahlung(rechnung, -3_000, "2026-02-11"); // 30,00 EUR bezahlt, 89,00 EUR offen
        expect(await verrechnung.openAmount(rechnung)).toBe(8_900);

        await verrechnung.settleDocuments(actor, {
          documentId: rechnung,
          counterDocumentId: gutschrift,
          amount: 3_570,
          date: "2026-02-16",
          note: "Rest aus Gutschrift",
        });

        // Gutschrift vollständig verbraucht, die Rechnung behält den Rest nach Zahlung und Verrechnung
        expect(await verrechnung.openAmount(gutschrift)).toBe(0);
        expect(await verrechnung.openAmount(rechnung)).toBe(5_330);
        const vorschlag = (await bank.transferCandidates()).find((c) => c.documentId === rechnung);
        expect(vorschlag?.open).toBe(5_330);
        const offen = await reports.openPositions("2026-02-20");
        expect(offen.payables.map((p) => [p.id, p.open])).toEqual([[rechnung, 5_330]]);
      }, 30_000);

      it("hebt auf: die Reste kehren zurück, die Historie bleibt, die Belege sind wieder offen", async () => {
        await firma(profil);
        const rechnung = await beleg("2026-03-10", 5_000, 950); // 59,50 EUR
        const gutschrift = await beleg("2026-03-12", -3_000, -570); // -35,70 EUR
        const { ids } = await verrechnung.settleDocuments(actor, {
          documentId: rechnung,
          counterDocumentId: gutschrift,
          amount: 3_570,
          date: "2026-03-12",
          note: "Gutschrift",
        });
        expect(await verrechnung.openAmount(rechnung)).toBe(2_380);
        expect(await verrechnung.openAmount(gutschrift)).toBe(0);

        await verrechnung.reverseSettlement(actor, ids[0]!, "2026-03-20", "Korrektur");

        expect(await verrechnung.openAmount(rechnung)).toBe(5_950);
        expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);
        const zeilen = await verrechnung.listSettlements(rechnung);
        expect(zeilen).toHaveLength(2);
        expect(zeilen[1]).toMatchObject({ amount: 3_570, date: "2026-03-20", note: "Aufhebung: Gutschrift (Korrektur)" });
        expect(zeilen[1]!.reversesId).toBe(ids[0]);
        const offen = await reports.openPositions("2026-03-21");
        expect(offen.payables.map((p) => [p.id, p.open])).toEqual(
          expect.arrayContaining([
            [rechnung, 5_950],
            [gutschrift, -3_570],
          ]),
        );
        expect((await bank.transferCandidates()).find((c) => c.documentId === rechnung)?.open).toBe(5_950);
      }, 30_000);

      it("wirkt in der EÜR wie eine Zahlung: Aufwand der Rechnung und Minderung der Gutschrift heben sich", async () => {
        await firma(profil);
        const rechnung = await beleg("2026-05-10", 10_000, 1_900, "software");
        const gutschrift = await beleg("2026-05-12", -10_000, -1_900, "telefon");
        await verrechnung.settleDocuments(actor, {
          documentId: rechnung,
          counterDocumentId: gutschrift,
          amount: 11_900,
          date: "2026-05-12",
          note: "Vollausgleich",
        });

        const zeilen = (await euerJournal.euerAusJournal(2026)).summe.zeilen;
        expect(zeilen["ausgabe:software"]).toBe(10_000);
        expect(zeilen["ausgabe:telefon"]).toBe(-10_000);
        // Vorsteuer aus Rechnung und Gutschrift hebt sich auf
        expect(zeilen.vorsteuer ?? 0).toBe(0);
      }, 60_000);
    });
  }
});
