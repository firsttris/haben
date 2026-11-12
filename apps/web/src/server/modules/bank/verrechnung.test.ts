import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274). Anlass: eine Telekom-Gutschrift von 489,95 EUR,
 * die nie abgebucht, sondern mit den Folgeabbuchungen verrechnet wurde. Bis dahin blieben Rechnung und
 * Gutschrift offen, weil Haben für einen Ausgleich einen Bankumsatz verlangte.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung zweier Belege ohne Zahlung (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let euerJournal: typeof import("../auswertungen/euer-journal.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    verrechnung = await import("./verrechnung.ts");
    euerJournal = await import("../auswertungen/euer-journal.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma() {
    await leeren(sql)`truncate document_settlements, year_closings, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, documents, document_amounts, document_splits, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 14)`;
  }

  /** Gebuchter Beleg über die Bank; net negativ ergibt eine Gutschrift des Lieferanten */
  async function beleg(
    datum: string,
    netto: number,
    steuer: number,
    kategorie: "software" | "hardware" | "telefon" = "telefon",
    lieferant = "Telekom Deutschland GmbH",
  ) {
    // Eigene Bytes je Beleg: gleiche Datei erkennt Haben als Dublette und gibt den ersten Beleg zurueck
    const bytes = new Uint8Array([...JPEG, datum.charCodeAt(9), Math.abs(netto) % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `${datum}-${netto}.jpg` });
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

  it("gleicht Rechnung und Gutschrift aus und lässt bei Teilverrechnung den Rest offen", async () => {
    await firma();
    const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR
    expect(await verrechnung.openAmount(rechnung)).toBe(11_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);

    await verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount: 2_000, date: "2026-02-16", note: "Gutschrift" });

    expect(await verrechnung.openAmount(rechnung)).toBe(9_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-1_570);
    const zeilen = await verrechnung.listSettlements(rechnung);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ amount: -2_000 });

    // Mehr als der offene Rest der Gutschrift geht nicht
    await expect(
      verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount: 5_000, date: "2026-02-16", note: "Gutschrift" }),
    ).rejects.toThrow(/nicht verrechnen/);
  }, 30_000);

  it("verrechnet auch, wenn die Gutschrift der geoeffnete Beleg ist", async () => {
    await firma();
    const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR

    // Rolle vertauscht: der geoeffnete Beleg ist die Gutschrift, nicht die Rechnung.
    // Das Vorzeichen der Zeilen muss aus dem offenen Rest kommen, nicht aus der Rolle.
    await verrechnung.settleDocuments(actor, {
      documentId: gutschrift,
      counterDocumentId: rechnung,
      amount: 2_000,
      date: "2026-02-16",
      note: "Gutschrift",
    });

    expect(await verrechnung.openAmount(gutschrift)).toBe(-1_570);
    expect(await verrechnung.openAmount(rechnung)).toBe(9_900);
    const zeilen = await verrechnung.listSettlements(gutschrift);
    expect(zeilen).toHaveLength(1);
    // Auf der Gutschrift (negativer Rest) muss die Zeile positiv sein, damit der Rest gegen Null geht
    expect(zeilen[0]).toMatchObject({ amount: 2_000 });
  }, 30_000);

  it("hebt eine Verrechnung per Gegenzeile auf", async () => {
    await firma();
    const rechnung = await beleg("2026-03-10", 5_000, 950);
    const gutschrift = await beleg("2026-03-12", -3_000, -570);
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-03-12",
      note: "Gutschrift",
    });
    expect(await verrechnung.openAmount(rechnung)).toBe(2_380);
    expect(await verrechnung.openAmount(gutschrift)).toBe(0);

    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-03-12");

    expect(await verrechnung.openAmount(rechnung)).toBe(5_950);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-3_570);
    await expect(verrechnung.reverseSettlement(actor, ids[0]!, "2026-03-12")).rejects.toThrow(/bereits/);
  }, 30_000);

  it("bucht die Verrechnung ins Journal: je Belegseite Verbindlichkeiten gegen das Zwischenkonto", async () => {
    await firma();
    const rechnung = await beleg("2026-02-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-02-16", -3_000, -570); // -35,70 EUR
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 2_000,
      date: "2026-02-16",
      note: "Gutschrift 4711",
    });

    // Eine Buchung je Verrechnung, mit der Kennung des Paars als Quelle
    const eintraege = await sql`select * from journal_entries where source_type = 'verrechnung'`;
    expect(eintraege).toHaveLength(1);
    const eintrag = eintraege[0]!;
    const paare = await sql`select settlement_id from document_settlements where id = ${ids[0]!}`;
    const settlement_id = String(paare[0]!.settlement_id);
    expect(eintrag).toMatchObject({ date: "2026-02-16", source_type: "verrechnung", source_id: settlement_id, reverses_id: null });
    expect(eintrag.description).toContain("Telekom Deutschland GmbH");
    expect(eintrag.description).toContain("Gutschrift 4711");
    expect(eintrag.locked_at).not.toBeNull();

    // Verbindlichkeiten (1600) und Zwischenkonto „Durchlaufende Posten“ (1590), je 20,00 EUR auf beiden Seiten
    const zeilen = await sql`select account, debit, credit, tax_code from journal_lines where entry_id = ${eintrag.id}`;
    expect(zeilen).toHaveLength(4);
    expect(zeilen.every((z) => z.tax_code === null)).toBe(true);
    for (const konto of ["1600", "1590"]) {
      expect(zeilen.filter((z) => z.account === konto && z.debit === 2_000)).toHaveLength(1);
      expect(zeilen.filter((z) => z.account === konto && z.credit === 2_000)).toHaveLength(1);
    }
    const saldo = (konto: string) => zeilen.filter((z) => z.account === konto).reduce((s, z) => s + z.debit - z.credit, 0);
    expect(saldo("1590")).toBe(0);
    expect(saldo("1600")).toBe(0);
    // Soll und Haben der Buchung sind gleich hoch
    expect(zeilen.reduce((s, z) => s + z.debit, 0)).toBe(zeilen.reduce((s, z) => s + z.credit, 0));
  }, 30_000);

  it("hebt im Journal mit einer Gegenbuchung am Aufhebungsdatum auf, die Historie bleibt", async () => {
    await firma();
    const rechnung = await beleg("2026-03-10", 5_000, 950);
    const gutschrift = await beleg("2026-03-12", -3_000, -570);
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-03-12",
      note: "Gutschrift",
    });
    const [original] = await sql`select * from journal_entries where source_type = 'verrechnung'`;
    const originalZeilen = await sql`select account, debit, credit from journal_lines where entry_id = ${original!.id}`;

    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-04-02", "Jahresabschluss");

    const eintraege = await sql`select * from journal_entries where source_type = 'verrechnung' order by created_at`;
    expect(eintraege).toHaveLength(2);
    const gegen = eintraege.find((e) => e.reverses_id === original!.id)!;
    expect(gegen).toMatchObject({ date: "2026-04-02", reverses_id: original!.id });
    expect(gegen.description).toBe(`Storno: ${original!.description}`);
    // Die Gegenbuchung gehört zum Gegenzeilen-Paar in document_settlements: dieselbe Kennung als Quelle
    const gegenPaare = await sql`select settlement_id from document_settlements where reverses_id = ${ids[0]!}`;
    const gegenPaar = String(gegenPaare[0]!.settlement_id);
    expect(gegen.source_id).toBe(gegenPaar);

    // Seiten getauscht, Beträge gleich: Zusammen steht das Zwischenkonto wieder auf null
    const gegenZeilen = await sql`select account, debit, credit from journal_lines where entry_id = ${gegen.id}`;
    const gedreht = (zeilen: { account: string; debit: number; credit: number }[]) =>
      [...zeilen].map((z) => ({ account: z.account, debit: z.credit, credit: z.debit })).sort((a, b) => a.account.localeCompare(b.account));
    expect([...gegenZeilen].sort((a, b) => a.account.localeCompare(b.account))).toEqual(
      gedreht([...originalZeilen] as { account: string; debit: number; credit: number }[]),
    );
    const alle = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'verrechnung'`;
    for (const konto of ["1600", "1590"]) {
      expect(alle.filter((z) => z.account === konto).reduce((s, z) => s + z.debit - z.credit, 0)).toBe(0);
    }

    // GoBD: Die ursprüngliche Buchung bleibt unverändert stehen
    const [nachher] = await sql`select * from journal_entries where id = ${original!.id}`;
    expect(nachher).toEqual(original);
  }, 30_000);

  it("lässt Voranmeldung und EÜR unverändert: die Buchung trägt keine Steuer und keinen Zahlungsfluss", async () => {
    await firma();
    // Beide Belege als Telefonkosten, damit die Verrechnung die EÜR nicht zwischen Kategorien verschiebt
    const rechnung = await beleg("2026-02-10", 10_000, 1_900, "telefon");
    const gutschrift = await beleg("2026-02-16", -3_000, -570, "telefon");
    const quartal = { year: 2026, month: 41 };
    const vorherVat = await vat.kennzahlenBeiderQuellen(quartal);
    const vorherEuer = (await euerJournal.euerAusJournal(2026)).summe;

    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 2_000,
      date: "2026-02-16",
      note: "Gutschrift",
    });

    const nachherVat = await vat.kennzahlenBeiderQuellen(quartal);
    expect(nachherVat.journal).toEqual(vorherVat.journal);
    expect(nachherVat.nebenbuecher).toEqual(vorherVat.nebenbuecher);
    // Journal und Nebenbücher stimmen weiter überein
    expect(nachherVat.journal).toEqual(nachherVat.nebenbuecher);

    // EÜR: die Verrechnung wirkt wie eine Zahlung, hier auf beiden Seiten mit gleichem Betrag und Satz — per Saldo null
    const nachherEuer = (await euerJournal.euerAusJournal(2026)).summe;
    const ohneNullen = (zeilen: object) => Object.fromEntries(Object.entries(zeilen).filter(([, betrag]) => betrag !== 0));
    expect(ohneNullen(nachherEuer.zeilen)).toEqual(ohneNullen(vorherEuer.zeilen));
    expect(nachherEuer.zeilen.vorsteuer ?? 0).toBe(0);
  }, 30_000);

  it("hebt bei zwei gleichen Verrechnungen nur das gewählte Paar auf", async () => {
    await firma();
    const rechnung = await beleg("2026-07-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-07-12", -4_000, -760); // -47,60 EUR
    const erste = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 2_000,
      date: "2026-07-12",
      note: "Teil 1",
    });
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 2_000,
      date: "2026-07-13",
      note: "Teil 2",
    });
    expect(await verrechnung.openAmount(rechnung)).toBe(7_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-760);

    await verrechnung.reverseSettlement(actor, erste.ids[0]!, "2026-07-14");

    // Nur die eine Verrechnung fällt weg: 99,00 EUR offen, die Gutschrift -27,60 EUR, nicht wieder -47,60
    expect(await verrechnung.openAmount(rechnung)).toBe(9_900);
    expect(await verrechnung.openAmount(gutschrift)).toBe(-2_760);
    // Zwei Verrechnungen, aber nur eine Gegenzeile
    const zeilen = await verrechnung.listSettlements(rechnung);
    expect(zeilen).toHaveLength(3);
    expect(zeilen.filter((z) => z.reversesId !== null)).toHaveLength(1);
  }, 30_000);

  it("sperrt beide Belege: eine gleichzeitige Verrechnung überzahlt den Rest nicht", async () => {
    await firma();
    const rechnung = await beleg("2026-08-10", 10_000, 1_900); // 119,00 EUR
    const gutschrift = await beleg("2026-08-12", -10_000, -1_900); // -119,00 EUR
    // Eigene Verbindung, weil der Testpool nur eine hat: sie hält die Zeile gesperrt und bucht, während die
    // Verrechnung schon läuft — wie ein zweiter Aufruf, der denselben Rest gelesen hat.
    const sperre = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      let haelt!: () => void;
      const haeltSperre = new Promise<void>((resolve) => {
        haelt = resolve;
      });
      let freigeben!: () => void;
      const weiter = new Promise<void>((resolve) => {
        freigeben = resolve;
      });
      const halter = sperre.begin(async (tx) => {
        // Wie settleDocuments beide Belege in fester Reihenfolge sperren, damit der Test nicht selbst einen Kreis baut
        const reihenfolge = [rechnung, gutschrift].sort();
        await tx`select id from documents where id = ${reihenfolge[0]!} for update`;
        await tx`select id from documents where id = ${reihenfolge[1]!} for update`;
        haelt();
        await weiter;
        // Die "parallele" Verrechnung: sie bucht 60,00 EUR und gibt die Sperre erst danach frei
        await tx`select set_config('haben.actor', ${actor}, true)`;
        const settlementId = randomUUID();
        await tx`insert into document_settlements (document_id, counter_document_id, settlement_id, date, amount, note, created_by)
                 values (${rechnung}, ${gutschrift}, ${settlementId}, '2026-08-12', -6000, 'Parallel', ${actor}),
                        (${gutschrift}, ${rechnung}, ${settlementId}, '2026-08-12', 6000, 'Parallel', ${actor})`;
      });
      await haeltSperre;

      const laeuft = verrechnung.settleDocuments(actor, {
        documentId: rechnung,
        counterDocumentId: gutschrift,
        amount: 10_000,
        date: "2026-08-12",
        note: "Gutschrift",
      });
      // Zeit, in der die Verrechnung ohne Sperre den alten Rest lesen und anschließend einfügen würde
      await new Promise((resolve) => setTimeout(resolve, 400));
      freigeben();
      await halter;

      // Mit Sperre liest sie erst nach der parallelen Buchung: 119,00 − 60,00 = 59,00, also zu wenig für 100,00
      await expect(laeuft).rejects.toThrow(/nicht verrechnen/);
      expect(await verrechnung.openAmount(rechnung)).toBe(5_900);
    } finally {
      await sperre.end({ timeout: 5 });
    }
  }, 30_000);

  it("verrechnet keine Belege verschiedener Lieferanten", async () => {
    await firma();
    const rechnung = await beleg("2026-09-10", 10_000, 1_900);
    const fremd = await beleg("2026-09-12", -3_000, -570, "telefon", "Vodafone GmbH");
    await expect(
      verrechnung.settleDocuments(actor, {
        documentId: rechnung,
        counterDocumentId: fremd,
        amount: 1_000,
        date: "2026-09-12",
        note: "Gutschrift",
      }),
    ).rejects.toThrow(/Lieferant/);

    // Derselbe Lieferant in anderer Schreibweise geht
    const eigene = await beleg("2026-09-13", -1_000, -190, "telefon", "  TELEKOM   Deutschland GmbH ");
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: eigene,
      amount: 1_000,
      date: "2026-09-13",
      note: "Gutschrift",
    });
    expect(await verrechnung.openAmount(rechnung)).toBe(10_900);
  }, 30_000);

  it("lehnt Verrechnung und Aufhebung in einem abgeschlossenen Jahr ab", async () => {
    await firma();
    const rechnung = await beleg("2025-11-10", 10_000, 1_900);
    const gutschrift = await beleg("2025-11-12", -3_000, -570);
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 1_000,
      date: "2025-11-20",
      note: "Gutschrift",
    });
    await sql`insert into year_closings (year) values (2025)`;

    await expect(
      verrechnung.settleDocuments(actor, {
        documentId: rechnung,
        counterDocumentId: gutschrift,
        amount: 1_000,
        date: "2025-11-21",
        note: "Gutschrift",
      }),
    ).rejects.toThrow(/abgeschlossen/);
    await expect(verrechnung.reverseSettlement(actor, ids[0]!, "2025-11-21")).rejects.toThrow(/abgeschlossen/);
    // Nichts wurde gebucht: die Verrechnung steht weiter, die Aufhebung fehlt
    expect(await verrechnung.openAmount(rechnung)).toBe(10_900);
  }, 30_000);

  it("hebt an einem späteren Tag auf: die EÜR des Ursprungsjahres bleibt, die Gegenwirkung trifft das Aufhebungsjahr", async () => {
    await firma();
    const rechnung = await beleg("2025-11-10", 10_000, 1_900, "software");
    const gutschrift = await beleg("2025-11-16", -3_000, -570, "hardware");
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2025-11-20",
      note: "Gutschrift",
    });
    // Die Verrechnung wirkt 2025 wie eine Zahlung auf beide Belege
    const ursprung = (await euerJournal.euerAusJournal(2025)).summe.zeilen;
    expect(ursprung["ausgabe:software"]).toBe(3_000);
    expect(ursprung["ausgabe:hardware"]).toBe(-3_000);
    // Beide Steuerbeträge heben sich auf: 570 aus der Rechnung, -570 aus der Gutschrift
    expect(ursprung.vorsteuer ?? 0).toBe(0);

    // Aufgehoben am 15.01.2026: die Gegenzeilen tragen den Tag der Aufhebung und nennen sie
    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-01-15", "Jahresabschluss");
    const zeilen = await verrechnung.listSettlements(rechnung);
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toMatchObject({ amount: 3_570, date: "2026-01-15", note: "Aufhebung: Gutschrift (Jahresabschluss)" });
    expect(zeilen[1]!.reversesId).toBe(ids[0]);

    // Das Ursprungsjahr bleibt, wie es war: keine rückwirkende Änderung einer schon gemeldeten EÜR
    expect((await euerJournal.euerAusJournal(2025)).summe.zeilen).toEqual(ursprung);
    // Die Gegenwirkung steht im Jahr der Aufhebung
    const folgejahr = (await euerJournal.euerAusJournal(2026)).summe.zeilen;
    expect(folgejahr["ausgabe:software"]).toBe(-3_000);
    expect(folgejahr["ausgabe:hardware"]).toBe(3_000);
    expect(folgejahr.vorsteuer ?? 0).toBe(0);
  }, 60_000);

  it("verlangt für die Aufhebung ein Datum und prüft es", async () => {
    await firma();
    const rechnung = await beleg("2026-06-10", 10_000, 1_900);
    const gutschrift = await beleg("2026-06-12", -3_000, -570);
    const { ids } = await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 3_570,
      date: "2026-06-12",
      note: "Gutschrift",
    });
    // ohne Datum lehnt schon das Schema ab
    await expect(verrechnung.reverseSettlement(actor, ids[0]!, undefined as unknown as string)).rejects.toThrow(/date/i);
    // vor dem Tag der Verrechnung: eine Aufhebung wirkt nicht rückwirkend
    await expect(verrechnung.reverseSettlement(actor, ids[0]!, "2026-06-11")).rejects.toThrow(/vor der Verrechnung/);
    // in der Zukunft
    await expect(verrechnung.reverseSettlement(actor, ids[0]!, "2099-01-01")).rejects.toThrow(/Zukunft/);
    // am Tag der Verrechnung geht es
    await verrechnung.reverseSettlement(actor, ids[0]!, "2026-06-12");
    expect(await verrechnung.openAmount(rechnung)).toBe(11_900);
  }, 30_000);

  it("verweigert Belege, die in dieselbe Richtung zeigen", async () => {
    await firma();
    const eine = await beleg("2026-04-10", 1_000, 190);
    const andere = await beleg("2026-04-11", 2_000, 380);
    await expect(
      verrechnung.settleDocuments(actor, { documentId: eine, counterDocumentId: andere, amount: 500, date: "2026-04-11", note: "Gutschrift" }),
    ).rejects.toThrow(/dieselbe Richtung/);
  }, 30_000);

  it("verlangt ein Datum und den Grund und prueft das Datum", async () => {
    await firma();
    const rechnung = await beleg("2026-05-10", 10_000, 1_900);
    const gutschrift = await beleg("2026-05-20", -3_000, -570);
    const basis = { documentId: rechnung, counterDocumentId: gutschrift, amount: 1_000 };

    // ohne Datum und ohne Grund lehnt schon das Schema ab
    await expect(verrechnung.settleDocuments(actor, basis as never)).rejects.toThrow(/date|Grund/i);
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-20", note: "   " })).rejects.toThrow(/Grund/);
    // vor dem juengeren Beleg: Aufrechnung wirkt nicht rueckwirkend
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-19", note: "Gutschrift" })).rejects.toThrow(/jüngeren/);
    // in der Zukunft
    await expect(verrechnung.settleDocuments(actor, { ...basis, date: "2099-01-01", note: "Gutschrift" })).rejects.toThrow(/Zukunft/);
    // am Tag des juengeren Belegs geht es
    await verrechnung.settleDocuments(actor, { ...basis, date: "2026-05-20", note: "Gutschrift" });
    expect(await verrechnung.openAmount(rechnung)).toBe(10_900);
  }, 30_000);
});
