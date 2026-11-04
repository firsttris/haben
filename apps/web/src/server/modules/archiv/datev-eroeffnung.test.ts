import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today as heute } from "../../today.ts";

type Kontenrahmen = "SKR03" | "SKR04";
type Versteuerung = "ist" | "soll";

const COLUMNS = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;

type Row = [number, "S" | "H", string, string, string, string];

/** Buchungsstapel eines Jahres wie aus Lexware Office; Zeilen als [Betrag in Cent, S/H, Konto, Gegenkonto, BU, TTMM] */
function stack(year: number, kontenrahmen: Kontenrahmen, rows: Row[]) {
  const skr = kontenrahmen === "SKR03" ? "03" : "04";
  const header = `"EXTF";700;21;"Buchungsstapel";13;${year + 1}0102120000000;;"LO";"";"";1001;12345;${year}0101;4;${year}0101;${year}1231;"Lexware Export";"";1;0;0;"EUR";;"";;;"${skr}";;;"";""`;
  const lines = rows.map(([cents, side, account, contra, bu, ttmm]) => {
    const amount = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
    return `${amount};"${side}";"EUR";;;;${account};${contra};"${bu}";${ttmm};"";"";;"Test"`;
  });
  return new TextEncoder().encode([header, COLUMNS, ...lines].join("\r\n"));
}

const K = {
  SKR03: {
    bank: "1200",
    kasse: "1000",
    forderungen: "1400",
    verbindlichkeiten: "1600",
    ust: "1776",
    vorsteuer: "1576",
    vorauszahlung: "1780",
    nichtFaellig: "1766",
    kapital: "0800",
    gesellschafter: "0730",
    gewinnvortrag: "0860",
    erloes: "8400",
    aufwand: "4930",
  },
  SKR04: {
    bank: "1800",
    kasse: "1600",
    forderungen: "1200",
    verbindlichkeiten: "3300",
    ust: "3806",
    vorsteuer: "1406",
    vorauszahlung: "3820",
    nichtFaellig: "3816",
    kapital: "2900",
    gesellschafter: "3510",
    gewinnvortrag: "2970",
    erloes: "4400",
    aufwand: "6815",
  },
} as const;

const PDF = new TextEncoder().encode("%PDF-1.4\n% offener Posten\n%%EOF\n");

describe.skipIf(!testDatabaseUrl)("Eröffnung aus dem DATEV-Stapel (Postgres)", () => {
  let sql: postgres.Sql;
  let archive: typeof import("./archive.ts");
  let modul: typeof import("./datev-eroeffnung.ts");
  let legacy: typeof import("./legacy-open.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let cash: typeof import("../bank/cash.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let storage: typeof import("../../storage.ts");
  const actor = "test-user";
  // Echte Daten: Übernahmen buchen mit dem heutigen Tag, die Eröffnung steht im laufenden Jahr
  const today = heute();
  const year = Number(today.slice(0, 4));
  const schlussjahr = year - 1;

  beforeAll(async () => {
    sql = await setupTestDb();
    archive = await import("./archive.ts");
    modul = await import("./datev-eroeffnung.ts");
    legacy = await import("./legacy-open.ts");
    manual = await import("../buchhaltung/manual.ts");
    ledger = await import("../buchhaltung/ledger.ts");
    assets = await import("../buchhaltung/assets.ts");
    cash = await import("../bank/cash.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: Kontenrahmen, versteuerung: Versteuerung = "soll", rechtsform: "gmbh" | "ug" | "einzelunternehmen" = "gmbh") {
    // Archiv ist nur anhängbar; für jeden Fall leer beginnen
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await sql`truncate cash_entries, allocations, asset_depreciations, assets, journal_lines, journal_entries, document_amounts, documents,
      invoice_lines, invoices, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  }

  const upload = (y: number, bytes: Uint8Array) =>
    archive.addArchiveFile(actor, { bytes, filename: `EXTF_Buchungsstapel_${y}.csv`, kind: "datev", year: null });

  /** Stapel mit Eröffnung über 9000 (Bank, Kasse, Stammkapital, Gesellschafter), Ausgangs- und Eingangsrechnung, Vorauszahlung */
  function schlussRows(kontenrahmen: Kontenrahmen): Row[] {
    const k = K[kontenrahmen];
    return [
      [2_500_000, "S", k.bank, "9000", "", "0101"],
      [2_500_000, "S", "9000", k.kapital, "", "0101"],
      [50_000, "S", k.kasse, "9000", "", "0101"],
      [50_000, "S", "9000", k.gesellschafter, "", "0101"],
      [119_000, "S", "10001", k.erloes, "", "1503"], // Forderung an Debitor, Automatik 19 %
      [11_900, "H", "70001", k.aufwand, "9", "2004"], // Verbindlichkeit an Kreditor, Vorsteuer über BU 9
      [10_000, "S", k.vorauszahlung, k.bank, "", "1006"], // Umsatzsteuer-Vorauszahlung
    ];
  }

  async function legacyVoucher(values: { type: string; direction: "einnahme" | "ausgabe"; number: string; date: string; net: number; tax: number }) {
    const gross = values.net + values.tax;
    const payment = { status: "openRevenue", openAmount: gross, paidDate: null, items: [] };
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${values.type}, ${values.direction}, ${values.number},
        ${values.date}, ${values.date}, 'open', null, 'Nordwerk GmbH', ${values.net}, ${values.tax}, ${gross},
        ${JSON.stringify([{ rate: 1900, net: values.net, tax: values.tax }])}::jsonb,
        ${JSON.stringify(values.direction === "ausgabe" ? [{ categoryId: "x", name: "Bürobedarf", rate: 1900, net: values.net, tax: values.tax }] : [])}::jsonb,
        ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ address: { name: "Nordwerk GmbH" } })}::jsonb)
      returning id`;
    const sha = await storage.storeFile(PDF);
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
      values (${row!.id}, 'pdf', ${`${values.number}.pdf`}, 'application/pdf', ${sha}, ${PDF.byteLength})`;
    return row!.id as string;
  }

  /** Saldo je Konto im Eröffnungsjahr (Eröffnung + Bewegungen), ohne Nullsalden */
  async function salden(): Promise<Record<string, number>> {
    const rows = await ledger.saldenliste(ledger.ledgerRange(year));
    return Object.fromEntries(rows.filter((r) => r.saldo !== 0).map((r) => [r.account, r.saldo]));
  }

  describe.each(["SKR03", "SKR04"] as const)("%s", (kontenrahmen) => {
    const k = K[kontenrahmen];

    it.each(["soll", "ist"] as const)(
      "%s: schlägt die Schlussbilanz vor, bucht sie gegen 9000 und Kasse, Umsatzsteuer und Bilanz stimmen",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        const file = await upload(schlussjahr, stack(schlussjahr, kontenrahmen, schlussRows(kontenrahmen)));

        const vorschlag = await modul.datevEroeffnung(today);
        expect(vorschlag).toMatchObject({ schlussjahr, year, date: `${year}-01-01`, issues: [], gebucht: null, vortrag: "stapel" });
        const zeilen = Object.fromEntries(vorschlag!.zeilen.map((z) => [z.account, z.debit - z.credit]));
        expect(zeilen).toEqual({
          [k.bank]: 2_490_000,
          [k.kasse]: 50_000,
          [k.forderungen]: 119_000,
          [k.vorsteuer]: 1_900,
          [k.vorauszahlung]: 10_000,
          [k.kapital]: -2_500_000,
          [k.gesellschafter]: -50_000,
          [k.verbindlichkeiten]: -11_900,
          [k.ust]: -19_000,
          [k.gewinnvortrag]: -90_000,
        });

        await expect(modul.bookDatevEroeffnung(actor, { year, fingerprint: "0".repeat(64) }, today)).rejects.toThrow(/Vorschlag hat sich inzwischen geändert/);
        const id = await modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);
        const [entry] = await sql`select date, source_type, source_id, locked_at from journal_entries where id = ${id}`;
        expect(entry).toMatchObject({ date: `${year}-01-01`, source_type: "eroeffnung", source_id: file.id });
        expect(entry!.locked_at).not.toBeNull();
        expect(await sql`select 1 from seals where table_name = 'journal_entries' and row_id = ${id}`).toHaveLength(1);

        // Bilanz zum 1.1. gleich Schlussbilanz, 9000 ausgeglichen
        expect(await salden()).toEqual(zeilen);
        const nachher = await modul.datevEroeffnung(today);
        expect(nachher!.gebucht).toMatchObject({ id });
        await expect(modul.bookDatevEroeffnung(actor, { year, fingerprint: nachher!.fingerprint }, today)).rejects.toThrow(/ist gebucht/);
        // Eine manuelle Eröffnung daneben zählte doppelt
        await expect(
          manual.createManualEntry(
            actor,
            {
              kind: "eroeffnung",
              date: `${year}-01-01`,
              description: "Noch eine Eröffnung",
              lines: [
                { account: k.bank, debit: 100, credit: 0 },
                { account: "9000", debit: 0, credit: 100 },
              ],
            },
            today,
          ),
        ).rejects.toThrow(/Eröffnung aus dem DATEV-Stapel enthält schon alle Bestände/);

        // Kassenbuch: Anfangsbestand aus der Eröffnung, ohne eigene Zeile; der Bestand darf nicht negativ werden
        const book = await cash.cashBook(year);
        expect(book).toMatchObject({ opening: 50_000, current: 50_000, entries: [] });
        await expect(cash.createCashEntry(actor, { kind: "entnahme", date: `${year}-01-02`, amount: 60_000 }, today)).rejects.toThrow(/negativ/);
        await cash.createCashEntry(actor, { kind: "entnahme", date: `${year}-01-02`, amount: 30_000 }, today);
        expect((await cash.cashBook(year)).closing).toBe(20_000);

        // Voranmeldung Januar: die vorgetragene Umsatz- und Vorsteuer zählt nicht
        expect(await documents.inputTaxForPeriod({ year, month: 1 })).toBe(0);
        expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year, month: 1 })).zeilen)).toEqual([]);

        // Storno nur mit Prüfung des Kassenbuchs, und nicht, wenn der Bestand dann negativ würde
        await expect(manual.reverseManualEntry(actor, id)).rejects.toThrow(/Prüfung des Kassenbuchs/);
        await expect(manual.reverseManualEntry(actor, id, cash.checkCashReversal)).rejects.toThrow(/Kassenbestand würde am 02\.01\./);
      },
    );

    it.each(["soll", "ist"] as const)(
      "%s: rechnet vorher übernommene offene Posten heraus, später übernommene bucht sie nicht noch einmal",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        await upload(schlussjahr, stack(schlussjahr, kontenrahmen, schlussRows(kontenrahmen)));
        const rechnung = await legacyVoucher({
          type: "invoice",
          direction: "einnahme",
          number: "RE-7",
          date: `${schlussjahr}-03-15`,
          net: 100_000,
          tax: 19_000,
        });
        const beleg = await legacyVoucher({
          type: "purchaseinvoice",
          direction: "ausgabe",
          number: "B-3",
          date: `${schlussjahr}-04-20`,
          net: 10_000,
          tax: 1_900,
        });
        await legacy.takeOverLegacyItem(actor, rechnung);

        const vorschlag = await modul.datevEroeffnung(today);
        expect(vorschlag!.issues).toEqual([]);
        expect(vorschlag!.hinweise.join(" ")).toMatch(/herausgerechnet/);
        expect(vorschlag!.zeilen.map((z) => z.account)).not.toContain(k.forderungen);
        expect(vorschlag!.zeilen.find((z) => z.account === "9000")).toBeDefined();
        await modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);

        const vorher = await salden();
        expect(vorher["9000"]).toBeUndefined();
        expect(vorher[k.forderungen]).toBe(119_000);
        expect(vorher[k.nichtFaellig]).toBeUndefined();

        // Nach der Eröffnung: der Beleg steckt schon in den Verbindlichkeiten, die Übernahme legt nur den Beleg an
        const result = await legacy.takeOverLegacyItem(actor, beleg);
        expect(result.kind).toBe("document");
        expect(await sql`select 1 from journal_entries where source_type = 'document' and source_id = ${result.id}`).toHaveLength(0);
        const [doc] = await sql`select status, locked_at from documents where id = ${result.id}`;
        expect(doc).toMatchObject({ status: "gebucht" });
        expect(await salden()).toEqual(vorher);
        expect(vorher[k.verbindlichkeiten]).toBe(-11_900);
      },
    );

    it("übernommene Anlage: steht sie in der Eröffnung, verweist sie darauf statt noch einmal gegen 9000 zu buchen", async () => {
      await setup(kontenrahmen);
      const asset = await assets.createAsset(actor, {
        name: "Notebook",
        kind: "buero",
        method: "linear",
        acquisitionDate: `${schlussjahr - 2}-06-01`,
        cost: 260_000,
        usefulLifeMonths: 156,
        openingDate: `${year}-01-01`,
        openingBookValue: 200_000,
        disposalDate: null,
        note: "",
      });
      await upload(
        schlussjahr,
        stack(schlussjahr, kontenrahmen, [
          [200_000, "S", asset.account, "9000", "", "0101"],
          [200_000, "S", "9000", k.kapital, "", "0101"],
        ]),
      );
      const vorschlag = await modul.datevEroeffnung(today);
      const id = await modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);
      await assets.bookDepreciation(actor, year, `${year}-12-01`);
      const [row] = await sql`select opening_entry_id from assets where id = ${asset.id}`;
      expect(row!.opening_entry_id).toBe(id);
      expect((await salden())["9000"]).toBeUndefined();
    });

    it("mehr als 20 Zeilen", async () => {
      await setup(kontenrahmen);
      const konten = Array.from({ length: 30 }, (_, i) => String(401 + i).padStart(4, "0"));
      await upload(
        schlussjahr,
        stack(schlussjahr, kontenrahmen, [
          ...konten.map((konto): Row => [1_000, "S", konto, "9000", "", "0101"]),
          [30_000, "S", "9000", k.kapital, "", "0101"],
        ]),
      );
      const vorschlag = await modul.datevEroeffnung(today);
      expect(vorschlag!.zeilen).toHaveLength(31);
      expect(vorschlag!.issues).toEqual([]);
      await modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);
      expect(await sql`select 1 from journal_lines`).toHaveLength(31);
    });
  });

  it("nur GmbH und UG, nur mit Stapel", async () => {
    await setup("SKR04", "soll", "einzelunternehmen");
    await upload(schlussjahr, stack(schlussjahr, "SKR04", schlussRows("SKR04")));
    expect(await modul.datevEroeffnung(today)).toBeNull();
    await setup("SKR04", "soll", "ug");
    expect(await modul.datevEroeffnung(today)).toBeNull();
    await upload(schlussjahr, stack(schlussjahr, "SKR04", schlussRows("SKR04")));
    expect((await modul.datevEroeffnung(today))!.issues).toEqual([]);
  });

  it("Hinweis statt Vorschlag: Buchungen davor, andere Eröffnung, fremder Kontenrahmen, Schlussbilanz geht nicht auf", async () => {
    const k = K.SKR04;
    await setup("SKR04");
    await upload(schlussjahr, stack(schlussjahr, "SKR04", schlussRows("SKR04")));
    const manuell = await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: `${year}-01-01`,
        description: "Eröffnung von Hand",
        lines: [
          { account: k.bank, debit: 100, credit: 0 },
          { account: "9000", debit: 0, credit: 100 },
        ],
      },
      today,
    );
    const vorschlag = await modul.datevEroeffnung(today);
    expect(vorschlag!.issues.join(" ")).toMatch(/schon eine Eröffnung vom 01\.01\./);
    await expect(modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today)).rejects.toThrow(/zuerst stornieren/);
    // Nach dem Storno der manuellen Eröffnung geht es
    await manual.reverseManualEntry(actor, manuell);
    expect((await modul.datevEroeffnung(today))!.issues).toEqual([]);

    // Eine Buchung vor dem 1.1.
    await sql`truncate journal_lines, journal_entries cascade`;
    await manual.createManualEntry(
      actor,
      {
        date: `${schlussjahr}-12-30`,
        description: "Umbuchung im Vorjahr",
        lines: [
          { account: k.gesellschafter, debit: 100, credit: 0 },
          { account: k.kapital, debit: 0, credit: 100 },
        ],
      },
      today,
    );
    expect((await modul.datevEroeffnung(today))!.issues.join(" ")).toMatch(/Vor dem 1\.1\.\d{4} gibt es schon Buchungen/);

    // Stapel in einem anderen Kontenrahmen
    await setup("SKR04");
    await upload(schlussjahr, stack(schlussjahr, "SKR03", schlussRows("SKR03")));
    expect((await modul.datevEroeffnung(today))!.issues.join(" ")).toMatch(/anderen Kontenrahmen/);

    // Schlussbilanz mit offenem Vortragskonto
    await setup("SKR04");
    await upload(
      schlussjahr,
      stack(schlussjahr, "SKR04", [
        [100_000, "S", k.bank, "9008", "", "0101"],
        [50_000, "S", "9000", k.kapital, "", "0101"],
      ]),
    );
    const offen = await modul.datevEroeffnung(today);
    expect(offen!.issues.join(" ")).toMatch(/9000 bis 9009 sind zusammen nicht ausgeglichen/);
    await expect(modul.bookDatevEroeffnung(actor, { year, fingerprint: offen!.fingerprint }, today)).rejects.toThrow(/nicht ausgeglichen/);
  });

  it("Storno der Eröffnung nimmt den Kassenbestand wieder heraus", async () => {
    await setup("SKR03");
    await upload(schlussjahr, stack(schlussjahr, "SKR03", schlussRows("SKR03")));
    const vorschlag = await modul.datevEroeffnung(today);
    const id = await modul.bookDatevEroeffnung(actor, { year, fingerprint: vorschlag!.fingerprint }, today);
    await manual.reverseManualEntry(actor, id, cash.checkCashReversal);
    expect((await cash.cashBook(year)).opening).toBe(0);
    // Danach lässt sie sich wieder vorschlagen und buchen
    const neu = await modul.datevEroeffnung(today);
    expect(neu!.issues).toEqual([]);
    await modul.bookDatevEroeffnung(actor, { year, fingerprint: neu!.fingerprint }, today);
    expect((await cash.cashBook(year)).opening).toBe(50_000);
  });
});
