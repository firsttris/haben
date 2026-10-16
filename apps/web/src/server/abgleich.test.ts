import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n") + "\n");
}

const eingang = (date: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", "Nordwerk", "Testfirma", purpose, "Eingang", "DE02100100100006820101", amount, "", "", ""];
const ausgang = (date: string, name: string, amount: string) =>
  [date, date, "Gebucht", "Testfirma", name, "Zahlung", "Ausgang", "DE02100100100006820101", amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("Abgleich Journal ↔ Umsatzsteuer und EÜR (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let documents: typeof import("./documents.ts");
  let pauschalen: typeof import("./pauschalen.ts");
  let assets: typeof import("./assets.ts");
  let integrity: typeof import("./integrity.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    documents = await import("./documents.ts");
    pauschalen = await import("./pauschalen.ts");
    assets = await import("./assets.ts");
    integrity = await import("./integrity.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll") {
    await sql`truncate asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, 'SKR03')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "a@b.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  }

  async function invoice(issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) {
    const draft = await invoices.createDraft(actor, {
      contactId, issueDate, serviceFrom: null, serviceTo: null, paymentTermDays: 14, format: "zugferd", note: "",
      lines: lines.map((l) => ({ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(
    date: string,
    amounts: { taxRate: 1900 | 700 | 0; net: number; tax: number }[],
    extra: { payment?: "bank" | "privat"; privateShare?: number; reverseCharge?: "eu" | "drittland" | null; category?: "edv" | "telefon" } = {},
  ) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant", supplierUstId: "", invoiceNumber: `R${docSeq}`, documentDate: date, dueDate: null,
      category: extra.category ?? "edv", payment: extra.payment ?? "bank", note: "", amounts,
      privateShare: extra.privateShare ?? 0, reverseCharge: extra.reverseCharge ?? null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transactions(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${crypto.randomUUID()}.csv` }, null);
    return sql<{ id: string; booking_date: string; amount: number }[]>`select id, booking_date::text, amount from bank_transactions order by booking_date, amount`;
  }

  /** Ein Jahr Betrieb über die echten Anwendungsfälle: Rechnungen, Teilzahlungen, Storno, Belege, Pauschalen, Finanzamt */
  async function geschaeftsjahr() {
    const a = await invoice("2026-01-15", [{ net: 400_000, rate: 1900 }, { net: 100_000, rate: 700 }]);
    const b = await invoice("2026-02-10", [{ net: 33_333, rate: 1900 }]);
    const c = await invoice("2026-02-20", [{ net: 10_000, rate: 1900 }]);
    await invoices.cancelInvoice(actor, c.id, "2026-03-02");

    await bookedDocument("2026-01-20", [{ taxRate: 1900, net: 3_240, tax: 616 }]);
    await bookedDocument("2026-02-05", [{ taxRate: 1900, net: 10_000, tax: 1_900 }, { taxRate: 700, net: 2_000, tax: 140 }], { payment: "privat" });
    // Handyvertrag mit 30 % Privatanteil, § 13b aus dem EU-Ausland
    await bookedDocument("2026-02-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
    await bookedDocument("2026-03-03", [{ taxRate: 1900, net: 20_000, tax: 3_800 }], { reverseCharge: "eu", privateShare: 25 });

    await pauschalen.createPauschale(actor, { art: "fahrt", date: "2026-02-14", description: "Kunde Hamburg", km: 123, fahrzeug: "pkw", hinUndZurueck: true }, "2026-03-31");
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-01", tage: 9, description: "" }, "2026-03-31");

    const txs = await transactions([
      eingang("01.02.26", `RE ${a.number} Teil 1`, "1.000,00"),
      eingang("15.02.26", `RE ${a.number} Teil 2`, "2.333,33"),
      eingang("03.03.26", `RE ${b.number}`, "396,66"),
      ausgang("10.02.26", "Finanzamt", "-1.234,56"),
    ]);
    const by = (amount: number) => txs.find((t) => t.amount === amount)!.id;
    await bank.allocate(actor, { kind: "invoice", transactionId: by(100_000), invoiceId: a.id, amount: 100_000 });
    await bank.allocate(actor, { kind: "invoice", transactionId: by(233_333), invoiceId: a.id, amount: 233_333 });
    await bank.allocate(actor, { kind: "invoice", transactionId: by(39_666), invoiceId: b.id, amount: 39_666 });
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: by(-123_456), amount: -123_456 });
    // Zugeordnet, aufgehoben und neu zugeordnet: Gegenbuchung und Gegenzeile heben sich auf
    const [wrong] = await sql`select id from allocations where amount = 233333`;
    await bank.reverseAllocation(actor, wrong!.id);
    await bank.allocate(actor, { kind: "invoice", transactionId: by(233_333), invoiceId: a.id, amount: 233_333 });
    return { a, b };
  }

  const months = [1, 2, 3] as const;

  for (const versteuerung of ["ist", "soll"] as const) {
    it(`${versteuerung === "ist" ? "Ist" : "Soll"}: Journal, Voranmeldung und EÜR stimmen überein`, async () => {
      await reset(versteuerung);
      await geschaeftsjahr();
      for (const month of months) {
        const result = await abgleich.vatAbgleich({ year: 2026, month });
        expect(result.hinweise).toEqual([]);
        expect(abgleich.abweichungen(result.zeilen), `2026-${month}`).toEqual([]);
      }
      // Der Abgleich hat wirklich etwas verglichen
      const feb = await abgleich.vatAbgleich({ year: 2026, month: 2 });
      expect(feb.zeilen.find((z) => z.posten.startsWith("Vorsteuer (Kz 66)"))!.quelle).toBe(1_900 + 140 + 665);
      const march = await abgleich.vatAbgleich({ year: 2026, month: 3 });
      expect(march.zeilen.find((z) => z.posten.startsWith("Umsatzsteuer § 13b"))!.journal).toBe(3_800);
      expect(march.zeilen.find((z) => z.posten.startsWith("Vorsteuer § 13b"))!.journal).toBe(2_850);

      const euer = await abgleich.euerAbgleich(2026);
      expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
      expect(euer.zeilen.find((z) => z.posten.startsWith("Umsatzsteuer an das Finanzamt"))).toMatchObject({ journal: 123_456, quelle: 123_456 });
      expect(euer.zeilen.filter((z) => z.posten.startsWith("Pauschale")).every((z) => z.journal > 0)).toBe(true);

      const all = await abgleich.abgleichAll("2026-03-31");
      expect(abgleich.abweichungen(all.zeilen)).toEqual([]);
      expect(all.zeilen.filter((z) => z.bereich === "ustva").map((z) => z.zeitraum)).toEqual(
        expect.arrayContaining(["2026-01", "2026-02", "2026-03"]),
      );
    }, 60_000);
  }

  it("findet Abweichungen, wenn Journal oder Nebenbuch an Haben vorbei geändert werden", async () => {
    await reset("ist");
    const { a } = await geschaeftsjahr();

    /** Ändert mit abgeschalteten Triggern, wie jemand mit vollem Datenbankzugriff, und gleicht danach ab */
    async function manipulated(change: (tx: postgres.TransactionSql) => Promise<unknown>) {
      await bypass(change);
      return abgleich.abweichungen((await abgleich.abgleichAll("2026-03-31")).zeilen);
    }
    async function bypass(change: (tx: postgres.TransactionSql) => Promise<unknown>) {
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await change(tx);
      });
    }

    // Umsatzsteuer im Journal: Zahlung im Februar mit zu wenig Steuer
    const [line] = await sql`select l.id, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' and e.date = '2026-02-01' and l.account = '1776' limit 1`;
    const found = await manipulated((tx) => tx`update journal_lines set credit = credit - 100 where id = ${line!.id}`);
    expect(found).toEqual([expect.objectContaining({ bereich: "ustva", zeitraum: "2026-02", posten: "Umsatzsteuer 19 % (Kz 81)" })]);
    expect(found[0]!.quelle - found[0]!.journal).toBe(100);
    await bypass((tx) => tx`update journal_lines set credit = credit + 100 where id = ${line!.id}`);

    // Nebenbuch: Steuer eines gebuchten Belegs geändert
    const [amount] = await sql`select a.id, a.tax from document_amounts a join documents d on d.id = a.document_id where d.document_date = '2026-01-20'`;
    const docFound = await manipulated((tx) => tx`update document_amounts set tax = 600 where id = ${amount!.id}`);
    expect(docFound).toEqual([expect.objectContaining({ zeitraum: "2026-01", posten: "Vorsteuer (Kz 66)", journal: 616, quelle: 600 })]);
    await bypass((tx) => tx`update document_amounts set tax = ${amount!.tax} where id = ${amount!.id}`);

    // Zuordnung auf eine andere Rechnung umgehängt: Steuer laut Zahlungen anders als gebucht
    const [b] = await sql`select id from invoices where number <> ${a.number} and kind = 'rechnung' order by issue_date limit 1`;
    const [allocation] = await sql`select id from allocations where invoice_id = ${a.id} and amount = 100000`;
    const moved = await manipulated((tx) => tx`update allocations set invoice_id = ${b!.id} where id = ${allocation!.id}`);
    expect(moved.map((z) => `${z.bereich} ${z.zeitraum} ${z.posten}`)).toEqual(["ustva 2026-02 Umsatzsteuer 19 % (Kz 81)", "ustva 2026-02 Umsatzsteuer 7 % (Kz 86)"]);

    // Die Integritätsprüfung meldet es; Kette und Siegel sehen die Zuordnung ebenfalls (seit 0064 versiegelt)
    const report = await integrity.checkIntegrity("2026-03-31");
    expect(report.abgleich.abweichungen).toHaveLength(2);
    // (Siegel früherer Tests in dieser Datenbank melden gelöschte Datensätze; hier zählt nur die Zuordnung)
    expect(report.problems).toContainEqual(expect.objectContaining({ tabelle: "allocations", zeile: allocation!.id, befund: "Inhalt passt nicht zum Siegel" }));
  }, 60_000);

  it("AfA und Privatnutzung: Hinweis, solange das Jahr nicht gebucht ist, danach Abgleich", async () => {
    await reset("soll");
    await assets.createAsset(actor, {
      name: "Firmenwagen",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2023-01-10",
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 2_400_000,
      disposalDate: null,
      privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
      note: "",
    });
    await assets.createAsset(actor, {
      name: "Laptop",
      kind: "edv",
      method: "gwg",
      acquisitionDate: "2025-03-01",
      cost: 70_000,
      usefulLifeMonths: null,
      openingDate: "2025-03-01",
      openingBookValue: 70_000,
      disposalDate: null,
      note: "",
    });
    // Eine Buchung im Jahr, damit es im Abgleich vorkommt
    await invoice("2025-06-01", [{ net: 10_000, rate: 1900 }]);

    const before = await abgleich.euerAbgleich(2025);
    expect(before.hinweise).toEqual(["AfA 2025 ist für 2 Anlagen noch nicht gebucht; AfA und Privatnutzung werden danach abgeglichen."]);
    expect(before.zeilen.some((z) => z.posten === "AfA")).toBe(false);
    // Die Voranmeldung zählt die Privatnutzung schon monatlich; der Abgleich der Umsatzsteuer lässt sie aus
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2025, month: 6 })).zeilen)).toEqual([]);

    await assets.bookDepreciation(actor, 2025, "2025-12-15");
    const after = await abgleich.euerAbgleich(2025);
    expect(after.hinweise).toEqual([]);
    expect(abgleich.abweichungen(after.zeilen)).toEqual([]);
    const values = Object.fromEntries(after.zeilen.map((z) => [z.posten, z.journal]));
    expect(values["AfA"]).toBe(600_000);
    expect(values["Sofortabschreibung GWG"]).toBe(70_000);
    expect(values["Private Kfz-Nutzung"]).toBeGreaterThan(0);
    expect(values["Umsatzsteuer auf die private Kfz-Nutzung"]).toBeGreaterThan(0);
    for (const month of [1, 6, 12]) {
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2025, month })).zeilen)).toEqual([]);
    }
  }, 60_000);

  it("Vorprüfung der Voranmeldung meldet Abweichungen mit Beträgen", () => {
    expect(
      abgleich.abgleichIssues({
        zeilen: [
          { bereich: "ustva", zeitraum: "2026-02", posten: "Vorsteuer (Kz 66)", journal: 616, quelle: 600 },
          { bereich: "ustva", zeitraum: "2026-02", posten: "Umsatzsteuer 7 % (Kz 86)", journal: 0, quelle: 0 },
        ],
        hinweise: ["Hinweis"],
      }),
    ).toEqual([
      {
        tone: "warn",
        text: "Buchungen und Voranmeldung weichen ab: Vorsteuer (Kz 66) laut Journal 6,16 €, laut Rechnungen, Belegen und Zahlungen 6,00 €. Bitte vor dem Senden klären.",
        link: "/konten",
      },
      { tone: "info", text: "Hinweis", link: "/konten" },
    ]);
  });
});
