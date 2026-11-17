import { type FintsTestbank, startFintsTestbank } from "@haben/import/fints-testbank";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const PRODUKT = "HABENTESTPRODUKT01";
const ACTOR = "test-user";
const GIRO = "DE02120300000000202051";
const TAGESGELD = "DE12500105170648489890";
const PRIVAT = "DE91100000000123456789";
const BLZ = "12030000";

/**
 * Wahl der Konten beim Verbinden über FinTS gegen die nachgebaute Bank (@haben/import/fints-testbank): Nur die gewählten
 * Konten legt Haben an und ruft sie ab. Die Fälle bauen aufeinander auf, wie beim Verbinden und späteren „Zugang ändern“.
 */
describe.skipIf(!testDatabaseUrl)("Konten wählen beim Verbinden über FinTS (Postgres)", () => {
  let fints: typeof import("./fints.ts");
  let abruf: typeof import("./fints-abruf.ts");
  let vorgang: typeof import("./fints-vorgang.ts");
  let sql: postgres.Sql;
  let bank: FintsTestbank;
  const zugang = () => ({ blz: BLZ, url: bank.url, benutzer: "max", pin: "12345" });

  /** Verbindet mit pushTAN bis zur Wahl der Konten; vorwahl: je IBAN, ob Haben sie vorgewählt hat */
  async function bisZurWahl(today: string) {
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), today);
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    const konten = await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 });
    if (konten.art !== "konten") throw new Error(`Kontenwahl erwartet, nicht ${konten.art}`);
    return { id: konten.vorgang, konten: konten.konten, vorwahl: Object.fromEntries(konten.konten.map((k) => [k.iban, k.gewaehlt])) };
  }

  const ibans = async () => (await sql`select accounts from fints_connections where bank_code = ${BLZ}`)[0]!.accounts.map((a: { iban: string }) => a.iban);
  const umsaetze = async (iban: string) =>
    (await sql`select count(*)::int as n from bank_transactions t join bank_accounts a on a.id = t.bank_account_id where a.iban = ${iban}`)[0]!.n;
  /** IBANs, nach deren Umsätzen Haben die Bank seit dem Stand vorher gefragt hat */
  const abgerufen = (vorher: number) => bank.zustand.anfragen.slice(vorher).flatMap((a) => (a.segmente.includes("HKKAZ") && a.iban ? [a.iban] : []));

  beforeAll(async () => {
    sql = await setupTestDb();
    process.env.FINTS_PRODUKT_ID = PRODUKT;
    bank = await startFintsTestbank({
      produktId: PRODUKT,
      bankname: "Testbank",
      konten: [
        { iban: GIRO, nummer: "0000202051", name: "Girokonto" },
        { iban: TAGESGELD, nummer: "0648489890", name: "Tagesgeld" },
        { iban: PRIVAT, nummer: "0123456789", name: "Privatkonto" },
        { iban: "DE89370400440532013000", nummer: "0532013000", name: "Dollarkonto", waehrung: "USD" },
      ],
      umsaetze: {
        [GIRO]: [{ tag: "2026-10-05", betrag: "100,00", name: "Muster GmbH", zweck: "Rechnung RE-2026-0042", ref: "G1" }],
        [TAGESGELD]: [{ tag: "2026-10-01", betrag: "5,00", name: "Bank", zweck: "Zinsen", ref: "T1" }],
        [PRIVAT]: [{ tag: "2026-10-03", betrag: "-80,00", name: "Supermarkt", zweck: "Einkauf", ref: "P1" }],
      },
    });
    fints = await import("./fints.ts");
    abruf = await import("./fints-abruf.ts");
    vorgang = await import("./fints-vorgang.ts");
  });

  afterAll(async () => {
    await bank?.schliessen();
    await sql?.end();
  });

  it("zeigt die Konten in Euro mit IBAN, alle vorgewählt, und übernimmt nur die gewählten", async () => {
    const vorher = bank.zustand.anfragen.length;
    const { id, konten } = await bisZurWahl("2026-10-21");
    expect(konten).toEqual([
      { iban: GIRO, name: "Girokonto", gewaehlt: true },
      { iban: TAGESGELD, name: "Tagesgeld", gewaehlt: true },
      { iban: PRIVAT, name: "Privatkonto", gewaehlt: true },
    ]);
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, id, { konten: [GIRO, TAGESGELD] });
    expect(fertig).toEqual({
      art: "fertig",
      ok: true,
      neu: 2,
      meldung: "Testbank verbunden, 2 neue Umsätze.",
      hinweise: [
        "Neu angelegt: Testbank Girokonto …2051, Testbank Tagesgeld …9890. Name und Zweck (z. B. Steuerkonto) legst du unter Bank mit „Name und Zweck“ fest.",
        "1 Konten in Fremdwährung (USD) werden nicht abgerufen, Haben bucht nur in Euro.",
      ],
    });
    expect(await ibans()).toEqual([GIRO, TAGESGELD]);
    // Das abgewählte Konto bekommt kein Konto in Haben und keine Umsätze; Haben fragt die Bank nicht einmal danach
    expect(await sql`select id from bank_accounts where iban = ${PRIVAT}`).toHaveLength(0);
    expect(abgerufen(vorher)).toEqual([GIRO, TAGESGELD]);
  });

  it("wählt beim erneuten Verbinden desselben Zugangs die bisher abgerufenen Konten vor", async () => {
    const { id, vorwahl } = await bisZurWahl("2026-10-21");
    expect(vorwahl).toEqual({ [GIRO]: true, [TAGESGELD]: true, [PRIVAT]: false });
    vorgang.vorgangVerwerfen(ACTOR, id);
  });

  it("ruft ein abgewähltes Konto nicht mehr ab und lässt seine Umsätze stehen", async () => {
    const { id } = await bisZurWahl("2026-10-22");
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, id, { konten: [GIRO] });
    expect(fertig).toMatchObject({ art: "fertig", ok: true });
    if (fertig.art !== "fertig") return;
    expect(fertig.hinweise[0]).toBe(
      "Nicht mehr abgerufen: Testbank Tagesgeld …9890. Die Umsätze bleiben; gehört ein Konto nicht zu dieser Firma, schließt du es unter Bank mit „Gehört nicht zu dieser Firma“ aus.",
    );
    expect(await ibans()).toEqual([GIRO]);
    expect(await umsaetze(TAGESGELD)).toBe(1);
    const vorher = bank.zustand.anfragen.length;
    const verbindung = (await sql`select id from fints_connections`)[0]!;
    expect(await abruf.fintsAbrufen(ACTOR, verbindung.id, "2026-10-23")).toMatchObject({ art: "fertig", ok: true });
    expect(abgerufen(vorher)).toEqual([GIRO]);
  });

  it("macht bei einem wieder angehakten Konto nach dem letzten vorhandenen Umsatz weiter", async () => {
    const { id, vorwahl } = await bisZurWahl("2026-10-24");
    expect(vorwahl).toEqual({ [GIRO]: true, [TAGESGELD]: false, [PRIVAT]: false });
    const vorher = bank.zustand.anfragen.length;
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, id, { konten: [GIRO, TAGESGELD] });
    expect(fertig).toMatchObject({
      art: "fertig",
      ok: true,
      neu: 0,
      hinweise: ["1 Konten in Fremdwährung (USD) werden nicht abgerufen, Haben bucht nur in Euro."],
    });
    expect(await ibans()).toEqual([GIRO, TAGESGELD]);
    const kaz = bank.zustand.anfragen.slice(vorher).find((a) => a.segmente.includes("HKKAZ") && a.iban === TAGESGELD);
    expect(kaz).toMatchObject({ von: "2026-10-02", bis: "2026-10-24" });
    expect(await umsaetze(TAGESGELD)).toBe(1);
  });

  it("wählt ein ausgeschlossenes Konto nicht vor", async () => {
    await sql`update bank_accounts set excluded_at = now() where iban = ${TAGESGELD}`;
    try {
      const { id, vorwahl } = await bisZurWahl("2026-10-25");
      expect(vorwahl).toEqual({ [GIRO]: true, [TAGESGELD]: false, [PRIVAT]: false });
      vorgang.vorgangVerwerfen(ACTOR, id);
    } finally {
      await sql`update bank_accounts set excluded_at = null where iban = ${TAGESGELD}`;
    }
  });

  it("übernimmt nur Konten, die die Bank zum Abruf gemeldet hat, und lässt die Verbindung sonst, wie sie war", async () => {
    const { id } = await bisZurWahl("2026-10-25");
    await expect(vorgang.vorgangFortsetzen(ACTOR, id, { konten: ["DE89370400440532013000"] })).rejects.toThrow(
      "Dieses Konto hat die Bank nicht zum Abruf gemeldet.",
    );
    expect(await ibans()).toEqual([GIRO, TAGESGELD]);
    expect(await sql`select id from bank_accounts where iban = 'DE89370400440532013000'`).toHaveLength(0);
  });

  it("fragt bei nur einem Konto nicht nach", async () => {
    const eine = await startFintsTestbank({
      produktId: PRODUKT,
      blz: "10020030",
      bankname: "Einzelbank",
      konten: [{ iban: "DE44500105175407324931", nummer: "5407324931", name: "Geschäftskonto" }],
    });
    try {
      const wahl = await fints.fintsVerbinden(ACTOR, { ...zugang(), blz: "10020030", url: eine.url }, "2026-10-25");
      if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
      expect(await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 })).toMatchObject({
        art: "fertig",
        ok: true,
        meldung: "Einzelbank verbunden, 0 neue Umsätze.",
      });
      const [row] = await sql`select accounts from fints_connections where bank_code = '10020030'`;
      expect(row!.accounts.map((a: { iban: string }) => a.iban)).toEqual(["DE44500105175407324931"]);
    } finally {
      await eine.schliessen();
    }
  });
});
