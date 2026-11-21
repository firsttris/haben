import { bwaZeitraum, type Form43Zeile } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * „Warum?“ je Zeile der BWA (#1380, Teil 2): die Abweichung einer Zeile zum Vorjahr nach Kontakt, aus denselben Anteilen wie
 * die BWA. Kunde einer Rechnung, Lieferant eines Belegs mit Kontakt oder nur mit Namen. Alle Daten sind erfunden.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const umsatz = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Umsatz",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

const kontakt = (name: string, rolle: "kunde" | "lieferant") => ({
  kundennummer: "",
  name,
  strasse: "Hafenstraße 5",
  plz: "20457",
  ort: "Hamburg",
  land: "DE",
  email: "a@b.example",
  ustId: "",
  iban: "",
  leitwegId: "",
  defaultFormat: null,
  isCustomer: rolle === "kunde",
  isSupplier: rolle === "lieferant",
});

describe.skipIf(!testDatabaseUrl)("BWA: Warum? je Zeile (Postgres, #1380)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let bwa: typeof import("./bwa.ts");
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    bwa = await import("./bwa.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate own_accounts, document_settlements, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, lexoffice_vouchers, lexoffice_imports, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, rechtsform)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 'einzelunternehmen')`;
  }

  async function invoice(contactId: string, issueDate: string, net: number) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  /** Archivierter Beleg aus Lexware Office mit Kontakt */
  async function archivBeleg(date: string, net: number, contactId: string, direction: "einnahme" | "ausgabe") {
    const [imp] = await sql<{ id: string }[]>`insert into lexoffice_imports (progress) values ('{}'::jsonb) returning id`;
    const type = direction === "ausgabe" ? "purchaseinvoice" : "invoice";
    const [v] = await sql<
      { id: string }[]
    >`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, date, status, contact_id, net, tax, gross, taxes, categories, raw)
      values (${crypto.randomUUID()}, ${imp!.id}, ${type}, ${direction}, ${date}, 'open', ${contactId}, ${net}, 0, ${net}, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) returning id`;
    return v!.id;
  }

  /** Beleg über EDV (Instandhaltung), privat bezahlt: Abfluss am Belegdatum */
  async function beleg(date: string, net: number, supplierName: string, supplierContactId: string | null = null, supplierUstId = "", lexwareKontakt?: string) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 11]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `w${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName,
      supplierContactId,
      supplierUstId,
      invoiceNumber: `W${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      privateShare: 0,
      reverseCharge: null,
    });
    // Aus Lexware Office übernommen: der Kontakt steht nur am archivierten Beleg (wie auf der Kontaktseite, lieferant-belege.ts)
    if (lexwareKontakt) await sql`update documents set lexoffice_voucher_id = ${await archivBeleg(date, net, lexwareKontakt, "ausgabe")} where id = ${id}`;
    await documents.bookDocument(actor, id);
    return id;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`zerlegt die Abweichung zum Vorjahr nach Kunde und Lieferant; die Teile ergeben die Zeile (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const kunde = (await contacts.createContact(actor, kontakt("Nordwerk Software GmbH", "kunde"))).id;
        const cloudwerk = (await contacts.createContact(actor, kontakt("Cloudwerk GmbH", "lieferant"))).id;
        const altanbieter = (await contacts.createContact(actor, kontakt("Altanbieter KG", "lieferant"))).id;

        // Kunde: 2026 eine Rechnung über 1.000 €, 2027 zwei, je bezahlt
        const r1 = await invoice(kunde, "2026-03-02", 100_000);
        const r2 = await invoice(kunde, "2027-03-01", 100_000);
        const r3 = await invoice(kunde, "2027-04-01", 100_000);
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([
              umsatz("10.03.26", `RE ${r1.number}`, "1190,00"),
              umsatz("10.03.27", `RE ${r2.number}`, "1190,00"),
              umsatz("10.04.27", `RE ${r3.number}`, "1190,00"),
            ]),
            filename: `${crypto.randomUUID()}.csv`,
          },
          null,
        );
        const txs = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions order by booking_date`;
        for (const [t, r] of [
          [txs[0]!, r1],
          [txs[1]!, r2],
          [txs[2]!, r3],
        ] as const)
          await bank.allocate(actor, { kind: "invoice", transactionId: t.id, invoiceId: r.id, amount: 119_000 });

        // Lieferanten: neu mit Kontakt (der Name am Beleg weicht ab), weggefallen mit Kontakt, ohne Kontakt nur mit Namen
        await beleg("2027-05-04", 30_000, "CLOUDWERK", cloudwerk);
        await beleg("2026-05-04", 45_000, "Altanbieter KG", altanbieter);
        await beleg("2026-06-01", 10_000, "Rechenzentrum Süd");
        await beleg("2027-06-01", 35_000, "Rechenzentrum Süd");

        const jahr = bwaZeitraum("jahr", 2027);
        const bericht = await bwa.bwaBericht(jahr, "vorjahr");
        const teile = async (zeile: Form43Zeile) => {
          const warum = (await bwa.bwaWarum(jahr, "vorjahr", zeile))!;
          return warum.teile.map((t) => [t.name, t.kontaktId, t.art, t.differenz, t.anzahl, t.jeVorgang, t.anzahlVergleich, t.jeVorgangVergleich]);
        };

        expect(await teile("erloese")).toEqual([["Nordwerk Software GmbH", kunde, "gestiegen", 100_000, 2, 100_000, 1, 100_000]]);
        expect(await teile("instandhaltung")).toEqual([
          ["Altanbieter KG", altanbieter, "weggefallen", -45_000, 0, null, 1, 45_000],
          ["Cloudwerk GmbH", cloudwerk, "neu", 30_000, 1, 30_000, 0, null],
          ["Rechenzentrum Süd", null, "gestiegen", 25_000, 1, 35_000, 1, 10_000],
        ]);

        // Jede Zeile mit Beträgen: Teile plus übrige sind genau die Abweichung der BWA
        const mitBetrag = bericht.zeilen.filter((z) => z.art === "zeile" && (z.betrag !== 0 || z.vergleich !== 0));
        expect(mitBetrag.map((z) => z.key)).toEqual(expect.arrayContaining(["erloese", "umsatzsteuer", "instandhaltung", "vorsteuer"]));
        for (const z of mitBetrag) {
          const warum = (await bwa.bwaWarum(jahr, "vorjahr", z.key as Form43Zeile))!;
          expect([warum.betrag, warum.vergleich, warum.abweichung], z.key).toEqual([z.betrag, z.vergleich, z.abweichung!.betrag]);
          const summe = warum.teile.reduce((s, t) => s + t.differenz, 0) + (warum.uebrige?.differenz ?? 0);
          expect(summe, z.key).toBe(z.abweichung!.betrag);
        }

        // Ohne Vergleich gibt es nichts zu erklären
        expect(await bwa.bwaWarum(jahr, "keiner", "erloese")).toBeNull();
      }, 60_000);
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`fasst denselben Lieferanten bzw. Kunden mit und ohne Kontakt zusammen, statt „neu“ und „weggefallen“ (#1514, ${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const hosting = (await contacts.createContact(actor, { ...kontakt("Muster Hosting", "lieferant"), ustId: "DE136695976" })).id;
        const kunde = (await contacts.createContact(actor, kontakt("Nordwerk Software GmbH", "kunde"))).id;

        // Vorjahr ohne Kontakt: gleiche USt-IdNr. wie der Kontakt, daran über den Namen ein zweiter, dazu ein aus Lexware
        // Office übernommener mit dem Kontakt nur am archivierten Beleg; dieses Jahr mit Kontakt
        await beleg("2026-02-02", 40_000, "Muster Hosting GmbH", null, "DE 136695976");
        await beleg("2026-03-02", 8_000, " muster hosting gmbh");
        await beleg("2026-04-01", 2_000, "MH Altname", null, "", hosting);
        await beleg("2027-02-01", 60_000, "Muster Hosting", hosting);
        await beleg("2027-03-01", 5_000, "Papierladen");

        // Kunde: im Vorjahr eine Rechnung, die übernommen ohne Kunden nur seinen Namen trägt; dieses Jahr mit Kunde
        const r1 = await invoice(kunde, "2026-03-02", 100_000);
        const r2 = await invoice(kunde, "2027-03-01", 100_000);
        await sql.begin(async (tx) => {
          // An Haben vorbei, wie eine übernommene Rechnung ohne Kontakt; die Sperre lässt das sonst nicht zu
          await tx`set local session_replication_role = replica`;
          await tx`update invoices set contact_id = null, buyer = jsonb_set(buyer, '{name}', '"NORDWERK Software GmbH"') where id = ${r1.id}`;
        });
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([umsatz("10.03.26", `RE ${r1.number}`, "1190,00"), umsatz("10.03.27", `RE ${r2.number}`, "1190,00")]),
            filename: `${crypto.randomUUID()}.csv`,
          },
          null,
        );
        const txs = await sql<{ id: string }[]>`select id from bank_transactions order by booking_date`;
        await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: r1.id, amount: 119_000 });
        await bank.allocate(actor, { kind: "invoice", transactionId: txs[1]!.id, invoiceId: r2.id, amount: 119_000 });

        const jahr = bwaZeitraum("jahr", 2027);
        const warum = async (zeile: Form43Zeile) => (await bwa.bwaWarum(jahr, "vorjahr", zeile))!;
        const instandhaltung = await warum("instandhaltung");
        expect(instandhaltung.teile.map((t) => [t.name, t.kontaktId, t.art, t.differenz, t.anzahl, t.anzahlVergleich])).toEqual([
          ["Muster Hosting", hosting, "gestiegen", 10_000, 1, 3],
          ["Papierladen", null, "neu", 5_000, 1, 0],
        ]);
        const erloese = await warum("erloese");
        expect([erloese.teile, erloese.unveraendert]).toEqual([[], 1]);

        // Die Teile ergeben weiter genau die Abweichung jeder Zeile
        const bericht = await bwa.bwaBericht(jahr, "vorjahr");
        for (const z of bericht.zeilen.filter((z) => z.art === "zeile" && (z.betrag !== 0 || z.vergleich !== 0))) {
          const w = await warum(z.key as Form43Zeile);
          expect([w.betrag, w.vergleich, w.abweichung], z.key).toEqual([z.betrag, z.vergleich, z.abweichung!.betrag]);
          expect(w.teile.reduce((s, t) => s + t.differenz, 0) + (w.uebrige?.differenz ?? 0), z.key).toBe(z.abweichung!.betrag);
        }
        expect(instandhaltung.abweichung).toBe(15_000);
      }, 60_000);
    }
  }

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`eine aus Lexware Office übernommene Rechnung ohne Kunden zählt über den archivierten Beleg zum Kunden (#1514, ${kontenrahmen}, ${versteuerung})`, async () => {
      await reset(versteuerung, kontenrahmen);
      const kunde = (await contacts.createContact(actor, kontakt("Nordwerk Software GmbH", "kunde"))).id;
      const r1 = await invoice(kunde, "2026-03-02", 100_000);
      const r2 = await invoice(kunde, "2027-03-01", 120_000);
      // Im Vorjahr übernommen: ohne Kunden, mit anderem Namen, der Kunde steht nur am archivierten Beleg
      const archiv = await archivBeleg("2026-03-02", 100_000, kunde, "einnahme");
      await sql.begin(async (tx) => {
        // An Haben vorbei, wie eine übernommene Rechnung ohne Kontakt; die Sperre lässt das sonst nicht zu
        await tx`set local session_replication_role = replica`;
        await tx`update invoices set contact_id = null, lexoffice_voucher_id = ${archiv}, buyer = jsonb_set(buyer, '{name}', '"NW Altname"') where id = ${r1.id}`;
      });
      await bank.importStatement(
        actor,
        {
          bytes: dkbCsv([umsatz("10.03.26", `RE ${r1.number}`, "1190,00"), umsatz("10.03.27", `RE ${r2.number}`, "1428,00")]),
          filename: `${crypto.randomUUID()}.csv`,
        },
        null,
      );
      const txs = await sql<{ id: string }[]>`select id from bank_transactions order by booking_date`;
      await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: r1.id, amount: 119_000 });
      await bank.allocate(actor, { kind: "invoice", transactionId: txs[1]!.id, invoiceId: r2.id, amount: 142_800 });

      const warum = (await bwa.bwaWarum(bwaZeitraum("jahr", 2027), "vorjahr", "erloese"))!;
      expect(warum.teile.map((t) => [t.name, t.kontaktId, t.art, t.differenz, t.anzahl, t.anzahlVergleich])).toEqual([
        ["Nordwerk Software GmbH", kunde, "gestiegen", 20_000, 1, 1],
      ]);
    }, 60_000);

    it(`Skonto und Forderungsausfall zählen nicht als eigener Vorgang; die Teile ergeben die Zeile (${kontenrahmen}, ${versteuerung})`, async () => {
      await reset(versteuerung, kontenrahmen);
      const kunde = (await contacts.createContact(actor, kontakt("Nordwerk Software GmbH", "kunde"))).id;

      // 2026 eine Rechnung über 1.000 €, voll bezahlt; 2027 eine mit 2 % Skonto bezahlt und eine über 200 € als Forderungsausfall
      const r1 = await invoice(kunde, "2026-03-02", 100_000);
      const r2 = await invoice(kunde, "2027-03-01", 100_000);
      const r3 = await invoice(kunde, "2027-04-01", 20_000);
      await bank.importStatement(
        actor,
        {
          bytes: dkbCsv([umsatz("10.03.26", `RE ${r1.number}`, "1190,00"), umsatz("10.03.27", `RE ${r2.number}`, "1166,20")]),
          filename: `${crypto.randomUUID()}.csv`,
        },
        null,
      );
      const txs = await sql<{ id: string }[]>`select id from bank_transactions order by booking_date`;
      await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: r1.id, amount: 119_000 });
      await bank.allocateWithRest(actor, { transactionId: txs[1]!.id, target: { kind: "invoice", invoiceId: r2.id }, rest: "skonto" });
      await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: r3.id, date: "2027-09-30" });
      expect((await sql<{ kind: string }[]>`select kind from write_offs order by date`).map((w) => w.kind)).toEqual(["skonto", "forderungsausfall"]);

      // Die EÜR zählt nur, was gezahlt wird: 2027 nur die Zahlung mit 980 € netto, ein Vorgang je Jahr
      const jahr = bwaZeitraum("jahr", 2027);
      const warum = (await bwa.bwaWarum(jahr, "vorjahr", "erloese"))!;
      expect(warum.teile.map((t) => [t.name, t.kontaktId, t.art, t.differenz, t.anzahl, t.jeVorgang, t.anzahlVergleich, t.jeVorgangVergleich])).toEqual([
        ["Nordwerk Software GmbH", kunde, "gesunken", -2_000, 1, 98_000, 1, 100_000],
      ]);

      const bericht = await bwa.bwaBericht(jahr, "vorjahr");
      const mitBetrag = bericht.zeilen.filter((z) => z.art === "zeile" && (z.betrag !== 0 || z.vergleich !== 0));
      expect(mitBetrag.map((z) => z.key)).toEqual(expect.arrayContaining(["erloese", "umsatzsteuer"]));
      for (const z of mitBetrag) {
        const w = (await bwa.bwaWarum(jahr, "vorjahr", z.key as Form43Zeile))!;
        expect([w.betrag, w.vergleich, w.abweichung], z.key).toEqual([z.betrag, z.vergleich, z.abweichung!.betrag]);
        expect(w.teile.reduce((s, t) => s + t.differenz, 0) + (w.uebrige?.differenz ?? 0), z.key).toBe(z.abweichung!.betrag);
        expect(
          w.teile.reduce((s, t) => s + t.anzahl, 0),
          z.key,
        ).toBe(1);
      }
    }, 60_000);
  }

  it("freier Zeitraum über zwei Jahre gegen das Vorjahr: das gemeinsame Jahr zählt auf beiden Seiten, die Teile ergeben die Zeile", async () => {
    await reset("ist", "SKR03");
    const cloudwerk = (await contacts.createContact(actor, kontakt("Cloudwerk GmbH", "lieferant"))).id;
    await beleg("2024-06-03", 10_000, "Cloudwerk GmbH", cloudwerk);
    await beleg("2025-06-02", 20_000, "Cloudwerk GmbH", cloudwerk);
    await beleg("2026-06-01", 30_000, "Cloudwerk GmbH", cloudwerk);

    // 2025–2026 gegen 2024–2025
    const zeitraum = { von: "2025-01-01", bis: "2026-12-31" };
    const zeile = (await bwa.bwaBericht(zeitraum, "vorjahr")).zeilen.find((z) => z.key === "instandhaltung")!;
    expect(zeile.abweichung?.betrag).toBe(20_000);
    const warum = (await bwa.bwaWarum(zeitraum, "vorjahr", "instandhaltung"))!;
    expect([warum.betrag, warum.vergleich, warum.abweichung]).toEqual([zeile.betrag, zeile.vergleich, zeile.abweichung!.betrag]);
    expect(warum.teile.map((t) => [t.name, t.differenz, t.anzahl, t.anzahlVergleich])).toEqual([["Cloudwerk GmbH", 20_000, 2, 2]]);
  }, 60_000);
});
