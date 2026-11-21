import { type FintsTestbank, type FintsTestbankUmsatz, startFintsTestbank } from "@haben/import/fints-testbank";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const PRODUKT = "HABENTESTPRODUKT01";
const ACTOR = "test-user";
const IBAN_A = "DE02120300000000202051";
const IBAN_B = "DE12500105170648489890";
const BLZ = "12030000";

/**
 * Kontoabruf über FinTS gegen die nachgebaute Bank (@haben/import/fints-testbank): Sie spricht FinTS 3.0 mit lib-fints,
 * verlangt auf Wunsch eine TAN bei der Anmeldung oder beim Umsatzabruf und kennt pushTAN (entkoppelt) und chipTAN.
 */
describe.skipIf(!testDatabaseUrl)("Kontoabruf über FinTS (Postgres)", () => {
  let fints: typeof import("./fints.ts");
  let abruf: typeof import("./fints-abruf.ts");
  let vorgang: typeof import("./fints-vorgang.ts");
  let geheim: typeof import("./fints-geheim.ts");
  let sql: postgres.Sql;
  let bank: FintsTestbank;
  const umsaetze: Record<string, FintsTestbankUmsatz[]> = {
    [IBAN_A]: [
      { tag: "2026-01-15", betrag: "500,00", name: "Muster GmbH", iban: "DE89370400440532013000", zweck: "RE-2025-0099", ref: "A0" },
      { tag: "2026-10-05", betrag: "100,00", name: "Muster GmbH", iban: "DE89370400440532013000", zweck: "Rechnung RE-2026-0042", ref: "A1" },
      { tag: "2026-10-20", betrag: "-49,99", name: "Telekom", zweck: "Telefon 10/2026", ref: "A2" },
    ],
    [IBAN_B]: [{ tag: "2026-10-01", betrag: "5,00", name: "Bank", zweck: "Zinsen", ref: "B1" }],
  };
  const zugang = () => ({ blz: BLZ, url: bank.url, benutzer: "max", pin: "12345" });
  // Der Abruf im Hintergrund vergleicht mit „Zuletzt abgerufen“, das die echte Uhr setzt; deshalb Zeitpunkte ab jetzt
  const spaeter = (tage: number, stunden = 0) => new Date(Date.now() + tage * 86_400_000 + stunden * 3_600_000);

  /** Andere PIN in der Zeile, die Bankdaten bleiben */
  async function pinSetzen(pin: string) {
    const { bankdaten } = geheim.fintsGeheimnisLesen((await verbindung()).ciphertext);
    await sql`update fints_connections set ciphertext = ${geheim.fintsGeheimnisVerschluesseln({ pin, bankdaten })}`;
  }

  async function verbindung() {
    const [row] = await sql`select * from fints_connections`;
    return row!;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    process.env.FINTS_PRODUKT_ID = PRODUKT;
    bank = await startFintsTestbank({
      produktId: PRODUKT,
      bankname: "Testbank",
      konten: [
        { iban: IBAN_A, nummer: "0000202051", name: "Girokonto" },
        { iban: IBAN_B, nummer: "0648489890", name: "Tagesgeld" },
        { iban: "DE89370400440532013000", nummer: "0532013000", name: "Dollarkonto", waehrung: "USD" },
      ],
      umsaetze,
    });
    fints = await import("./fints.ts");
    abruf = await import("./fints-abruf.ts");
    vorgang = await import("./fints-vorgang.ts");
    geheim = await import("./fints-geheim.ts");
  });

  afterAll(async () => {
    await bank?.schliessen();
    await sql?.end();
  });

  beforeEach(() => {
    Object.assign(bank.zustand, {
      scaBeiAnmeldung: false,
      scaBeiUmsaetzen: false,
      freigegeben: false,
      appTanEintippen: false,
      umsatzTanVerschwiegen: false,
      nichtErreichbar: false,
      mt940Unlesbar: false,
    });
  });

  it("verbindet mit gewähltem TAN-Verfahren und TAN, legt die Konten an und holt die ersten Umsätze", async () => {
    bank.zustand.scaBeiAnmeldung = true;
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-21");
    expect(wahl).toMatchObject({
      art: "verfahren",
      verfahren: [
        { id: 921, name: "pushTAN 2.0" },
        { id: 912, name: "chipTAN manuell" },
      ],
    });
    if (wahl.art !== "verfahren") return;
    const tan = await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 912 });
    expect(tan).toMatchObject({ art: "tan", entkoppelt: false, text: "Bitte geben Sie die TAN ein.", hinweis: null });
    if (tan.art !== "tan") return;
    // Ohne TAN fragt Haben noch einmal, statt die Bank ohne TAN anzufragen
    const nochmal = await vorgang.vorgangFortsetzen(ACTOR, tan.vorgang, { tan: " " });
    expect(nochmal).toMatchObject({ art: "tan", hinweis: "Bitte die TAN eingeben." });
    if (nochmal.art !== "tan") return;
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, nochmal.vorgang, { tan: "123456" });
    expect(fertig).toMatchObject({ art: "fertig", ok: true, neu: 4, meldung: "Testbank verbunden, 4 neue Umsätze." });
    if (fertig.art !== "fertig") return;
    expect(fertig.hinweise).toEqual([
      "Neu angelegt: Testbank Girokonto …2051, Testbank Tagesgeld …9890. Name und Zweck (z. B. Steuerkonto) legst du unter Bank mit „Name und Zweck“ fest.",
      "1 Konten in Fremdwährung (USD) werden nicht abgerufen, Haben bucht nur in Euro.",
    ]);

    const row = await verbindung();
    expect(row).toMatchObject({ bank_name: "Testbank", bank_code: BLZ, login: "max", status: "aktiv", tan_method: 912, last_error: null });
    expect(row.accounts.map((a: { iban: string; syncedTo: string }) => [a.iban, a.syncedTo])).toEqual([
      [IBAN_A, "2026-10-21"],
      [IBAN_B, "2026-10-21"],
    ]);
    // PIN und Bankdaten nur verschlüsselt, nie im Klartext in der Zeile oder im Protokoll
    const { pin, bankdaten } = geheim.fintsGeheimnisLesen(row.ciphertext);
    expect(pin).toBe("12345");
    expect(bankdaten.systemId).toMatch(/^SYS/);
    expect(Buffer.from(row.ciphertext).includes(Buffer.from("12345"))).toBe(false);
    const protokoll = await sql`select new_value::text as wert from audit_log where table_name = 'fints_connections'`;
    expect(protokoll.length).toBeGreaterThan(0);
    for (const p of protokoll) expect(p.wert).not.toMatch(/12345|ciphertext/);

    const gebucht = await sql`
      select t.booking_date::text as tag, t.amount, i.format from bank_transactions t join bank_imports i on i.id = t.import_id
      join bank_accounts a on a.id = t.bank_account_id where a.iban = ${IBAN_A} order by t.booking_date`;
    expect(gebucht.map((t) => [t.tag, t.amount, t.format])).toEqual([
      ["2026-01-15", 50000, "fints"],
      ["2026-10-05", 10000, "fints"],
      ["2026-10-20", -4999, "fints"],
    ]);
    // Die eigene Produktnummer geht mit jeder Anmeldung an die Bank, die PIN nur in der Signatur
    const anmeldungen = bank.zustand.anfragen.filter((a) => a.segmente.includes("HKIDN"));
    expect(anmeldungen.length).toBeGreaterThan(0);
    expect(anmeldungen.every((a) => a.produktId === PRODUKT)).toBe(true);
  });

  it("behält beim erneuten Verbinden desselben Zugangs die Verbindung und macht beim Abrufstand weiter", async () => {
    const { id } = await verbindung();
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-21");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 });
    expect(fertig).toMatchObject({ art: "fertig", ok: true, neu: 0 });
    const rows = await sql`select id, tan_method from fints_connections`;
    expect(rows.map((r) => [r.id, r.tan_method])).toEqual([[id, 921]]);
    // Folgeabruf: sieben Tage vor dem letzten Abruf, nicht wieder ab Jahresbeginn
    const kaz = bank.zustand.anfragen.filter((a) => a.segmente.includes("HKKAZ") && a.iban === IBAN_A).at(-1);
    expect(kaz).toMatchObject({ von: "2026-10-14", bis: "2026-10-21" });
  });

  it("lässt beim erneuten Verbinden Status und Abrufstand stehen, wenn der erste Abruf abbricht oder scheitert", async () => {
    // Wie nach einer neuen PIN bei der Bank: In der Zeile steht noch die alte, die Verbindung auf „Fehler“
    await pinSetzen("00000");
    await sql`update fints_connections set status = 'fehler', last_error = 'Abruf fehlgeschlagen: PIN ungültig. (9942)'`;
    const stand = (row: postgres.Row) => ({
      id: row.id,
      status: row.status,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
      syncedTo: row.accounts.map((a: { syncedTo: string }) => a.syncedTo),
    });
    const vorher = await verbindung();

    // „Abbrechen“ an der TAN für die Umsätze: Den Vorgang setzt niemand fort
    bank.zustand.scaBeiUmsaetzen = true;
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-22");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    expect(await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 })).toMatchObject({ art: "tan", entkoppelt: true });
    const abgebrochen = await verbindung();
    expect(stand(abgebrochen)).toEqual(stand(vorher));
    expect(abgebrochen.last_error).toBe(vorher.last_error);
    expect(await sql`select id from fints_connections`).toHaveLength(1);
    // Die neue PIN gilt schon: „Jetzt abrufen“ schickt nicht wieder die abgelehnte, die Bank sperrte sonst den Zugang
    expect(geheim.fintsGeheimnisLesen(abgebrochen.ciphertext).pin).toBe("12345");

    // Der erste Abruf scheitert: Die Meldung nennt den Fehler, der Abrufstand bleibt
    bank.zustand.scaBeiUmsaetzen = false;
    bank.zustand.mt940Unlesbar = true;
    const nochmal = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-22");
    if (nochmal.art !== "verfahren") throw new Error("Verfahren erwartet");
    const gescheitert = await vorgang.vorgangFortsetzen(ACTOR, nochmal.vorgang, { verfahren: 921 });
    expect(gescheitert).toMatchObject({ art: "fertig", ok: false, neu: 0 });
    if (gescheitert.art !== "fertig") return;
    expect(gescheitert.meldung).toMatch(/^Abruf fehlgeschlagen: Die Bank hat die Umsätze von Konto …2051 als MT940 geschickt/);
    const row = await verbindung();
    expect(stand(row)).toEqual(stand(vorher));
    expect(row.last_error).toBe(gescheitert.meldung);
    await sql`update fints_connections set status = 'aktiv', last_error = null`;
  });

  it("wartet bei „Jetzt abrufen“ auf die Freigabe in der App", async () => {
    umsaetze[IBAN_A]!.push({ tag: "2026-10-22", betrag: "250,00", name: "Kunde AG", zweck: "RE-2026-0050", ref: "A3" });
    bank.zustand.scaBeiUmsaetzen = true;
    const { id } = await verbindung();
    const tan = await abruf.fintsAbrufen(ACTOR, id, "2026-10-22");
    expect(tan).toMatchObject({ art: "tan", entkoppelt: true, hinweis: null });
    if (tan.art !== "tan") return;
    const ausstehend = await vorgang.vorgangFortsetzen(ACTOR, tan.vorgang, {});
    expect(ausstehend).toMatchObject({ art: "tan", hinweis: "Noch nicht freigegeben. Bitte in der App der Bank bestätigen und dann weiter." });
    if (ausstehend.art !== "tan") return;
    bank.zustand.freigegeben = true;
    const fertig = await vorgang.vorgangFortsetzen(ACTOR, ausstehend.vorgang, {});
    expect(fertig).toMatchObject({ art: "fertig", ok: true, neu: 1, meldung: "Testbank, 1 neue Umsätze." });
    expect((await verbindung()).last_sync_at).not.toBeNull();
  });

  it("schreibt BPD, UPD und Kundensystem-ID nicht ins Änderungsprotokoll, auch nicht bei jedem Abruf", async () => {
    // Sonst steht der ganze Stand der Bank (alle Geschäftsvorfälle, TAN-Verfahren, Konten mit Inhabern und Limits) bei
    // jedem Abruf alt und neu im Protokoll, dauerhaft und im Export für Steuerberatung und Betriebsprüfung (audit.csv)
    const vorher = (await sql`select count(*)::int as n from audit_log where table_name = 'fints_connections'`)[0]!.n;
    expect(await abruf.fintsAbrufen(ACTOR, (await verbindung()).id, "2026-10-23")).toMatchObject({ art: "fertig", ok: true });
    const zeilen = await sql`
      select coalesce(old_value::text, '') || coalesce(new_value::text, '') as wert from audit_log where table_name = 'fints_connections'`;
    expect(zeilen.length).toBeGreaterThan(vorher);
    for (const z of zeilen) expect(z.wert).not.toMatch(/banking_information|systemId|supportedTanMethods|bankAccounts/);
    // Der Abruf braucht sie trotzdem: Er fragt die Bank nicht neu nach BPD und UPD
    expect(bank.zustand.anfragen.at(-3)?.segmente.filter((s) => s.startsWith("HK"))).toEqual(["HKIDN", "HKVVB", "HKTAN"]);
  });

  it("setzt im Hintergrund „tan“, wenn die Bank eine TAN verlangt, und versucht es dann nicht wieder", async () => {
    bank.zustand.scaBeiUmsaetzen = true;
    const ergebnis = await abruf.runDueFintsSyncs(spaeter(1));
    expect(ergebnis).toMatchObject({ synced: 1, added: 0 });
    expect(ergebnis.errors).toEqual(["Testbank: Die Bank verlangt eine TAN. Unter Bank „Jetzt abrufen“ wählen und mit TAN bestätigen."]);
    expect(await verbindung()).toMatchObject({ status: "tan" });
    const vorher = bank.zustand.anfragen.length;
    expect(await abruf.runDueFintsSyncs(spaeter(2))).toEqual({ synced: 0, added: 0, errors: [] });
    expect(bank.zustand.anfragen).toHaveLength(vorher);

    // Auf Knopfdruck mit Freigabe läuft die Verbindung wieder
    bank.zustand.freigegeben = true;
    const tan = await abruf.fintsAbrufen(ACTOR, (await verbindung()).id, "2026-10-25");
    if (tan.art !== "tan") throw new Error("TAN erwartet");
    expect(await vorgang.vorgangFortsetzen(ACTOR, tan.vorgang, {})).toMatchObject({ art: "fertig", ok: true });
    expect(await verbindung()).toMatchObject({ status: "aktiv", last_error: null });
  });

  it("hört im Hintergrund nach einer abgelehnten PIN auf, damit die Bank den Zugang nicht sperrt", async () => {
    await pinSetzen("00000");
    await sql`update fints_connections set last_sync_at = null`;
    const ergebnis = await abruf.runDueFintsSyncs(spaeter(3));
    expect(ergebnis.errors).toEqual(["Testbank: Abruf fehlgeschlagen: PIN ungültig. (9942)"]);
    expect(await verbindung()).toMatchObject({ status: "fehler" });
    const vorher = bank.zustand.anfragen.length;
    await abruf.runDueFintsSyncs(spaeter(4));
    expect(bank.zustand.anfragen).toHaveLength(vorher);
    await pinSetzen("12345");
    await sql`update fints_connections set status = 'aktiv', last_error = null`;
  });

  it("lässt den Status nach einem Netzfehler stehen und versucht es erst am nächsten Tag wieder", async () => {
    bank.zustand.nichtErreichbar = true;
    const jetzt = spaeter(10);
    const ergebnis = await abruf.runDueFintsSyncs(jetzt);
    expect(ergebnis.errors[0]).toMatch(/^Testbank: Abruf fehlgeschlagen: .*503/);
    const row = await verbindung();
    expect(row.status).toBe("aktiv");
    expect(row.last_error).toMatch(/503/);
    expect(new Date(row.last_sync_at).getTime()).toBe(jetzt.getTime());
    expect(await abruf.runDueFintsSyncs(spaeter(10, 6))).toEqual({ synced: 0, added: 0, errors: [] });
  });

  it("ruft ausgeschlossene Konten nicht ab", async () => {
    await sql`update bank_accounts set excluded_at = now() where iban = ${IBAN_B}`;
    const vorher = bank.zustand.anfragen.length;
    expect(await abruf.fintsAbrufen(ACTOR, (await verbindung()).id, "2026-10-29")).toMatchObject({ art: "fertig", ok: true });
    const ibans = bank.zustand.anfragen.slice(vorher).flatMap((a) => (a.iban ? [a.iban] : []));
    expect(ibans).toEqual([IBAN_A]);
    await sql`update bank_accounts set excluded_at = null where iban = ${IBAN_B}`;
  });

  it("meldet Umsätze, die lib-fints nicht lesen kann, und lässt den Abrufstand stehen, damit kein Tag verloren geht", async () => {
    umsaetze[IBAN_A]!.push({ tag: "2026-10-30", betrag: "80,00", name: "Kunde AG", zweck: "RE-2026-0051", ref: "A4" });
    const { id, accounts: vorher } = await verbindung();
    const stand = (accounts: { iban: string; syncedTo: string }[]) => accounts.map((a) => [a.iban, a.syncedTo]);
    const importe = async () => (await sql`select count(*)::int as n from bank_imports`)[0]!.n;
    const importeVorher = await importe();

    bank.zustand.mt940Unlesbar = true;
    const fehler = await abruf.fintsAbrufen(ACTOR, id, "2026-11-02");
    expect(fehler).toMatchObject({ art: "fertig", ok: false, neu: 0 });
    if (fehler.art !== "fertig") return;
    expect(fehler.meldung).toMatch(/^Abruf fehlgeschlagen: Die Bank hat die Umsätze von Konto …2051 als MT940 geschickt, Haben kann sie nicht lesen/);
    const row = await verbindung();
    expect(row).toMatchObject({ status: "aktiv", last_error: fehler.meldung });
    expect(stand(row.accounts)).toEqual(stand(vorher));
    expect(await importe()).toBe(importeVorher);

    // Der nächste Abruf, den lib-fints lesen kann, beginnt beim alten Stand und holt den Umsatz
    bank.zustand.mt940Unlesbar = false;
    expect(await abruf.fintsAbrufen(ACTOR, id, "2026-11-03")).toMatchObject({ art: "fertig", ok: true, neu: 1 });
    const kaz = bank.zustand.anfragen.filter((a) => a.segmente.includes("HKKAZ") && a.iban === IBAN_A).at(-1);
    expect(kaz).toMatchObject({ von: "2026-10-22", bis: "2026-11-03" });
  });

  it("übernimmt Konten aus Enable Banking und gibt sie an Enable Banking ab", async () => {
    const [a] = await sql`select id from bank_accounts where iban = ${IBAN_A}`;
    const [b] = await sql`select id from bank_accounts where iban = ${IBAN_B}`;
    const [c] = await sql`insert into bank_accounts (iban, name) values ('DE75512108001245126199', 'Rücklagen') returning id`;
    const eb = (konten: postgres.Row[]) =>
      JSON.stringify(konten.map((k) => ({ uid: `uid-${k.id}`, iban: "x", name: "x", bankAccountId: k.id, syncedTo: null })));
    await sql`insert into bank_connections (aspsp_name, aspsp_country, psu_type, status, accounts) values
      ('EB-Bank', 'DE', 'business', 'aktiv', ${eb([a!, c!])}::jsonb), ('EB-Ganz', 'DE', 'business', 'aktiv', ${eb([b!])}::jsonb)`;

    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-29");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    expect(await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 })).toMatchObject({ art: "fertig", ok: true });
    const uebrig = await sql`select aspsp_name, accounts from bank_connections order by aspsp_name`;
    // EB-Bank behält nur das Konto, das FinTS nicht abruft; EB-Ganz hat keines mehr und ist getrennt
    expect(uebrig.map((r) => [r.aspsp_name, r.accounts.map((x: { bankAccountId: string }) => x.bankAccountId)])).toEqual([["EB-Bank", [c!.id]]]);

    const { kontenUebernehmen } = await import("./konto-uebernahme.ts");
    const { db } = await import("../../db/index.ts");
    await db.transaction((tx) => kontenUebernehmen(tx, new Set([a!.id])));
    expect((await verbindung()).accounts.map((x: { iban: string }) => x.iban)).toEqual([IBAN_B]);
  });

  it("lässt einen Vorgang nur die Person fortsetzen, die ihn begonnen hat", async () => {
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-29");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    await expect(vorgang.vorgangFortsetzen("jemand-anders", wahl.vorgang, { verfahren: 921 })).rejects.toThrow(/abgelaufen oder unbekannt/);
    await expect(vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 1 })).rejects.toThrow(/bietet die Bank nicht an/);
  });

  it("meldet eine falsche PIN beim Verbinden und legt nichts an", async () => {
    await sql`delete from fints_connections`;
    const antwort = await fints.fintsVerbinden(ACTOR, { ...zugang(), pin: "99999" }, "2026-10-29");
    expect(antwort).toEqual({ art: "fertig", ok: false, meldung: "PIN ungültig. (9942)", hinweise: [], neu: 0 });
    expect(await sql`select id from fints_connections`).toHaveLength(0);
  });

  it("erklärt beim Verbinden, wenn die Bank die Registrierungsnummer noch nicht kennt", async () => {
    const andere = await startFintsTestbank({ produktId: "ANDERESPRODUKT", konten: [{ iban: IBAN_A, nummer: "0000202051", name: "Girokonto" }] });
    try {
      const antwort = await fints.fintsVerbinden(ACTOR, { ...zugang(), url: andere.url }, "2026-10-29");
      expect(antwort).toMatchObject({ art: "fertig", ok: false });
      if (antwort.art !== "fertig") return;
      expect(antwort.meldung).toMatch(
        /^Das Kundenprodukt wird nicht unterstützt\. \(9952\) Die Bank kennt die Registrierungsnummer aus FINTS_PRODUKT_ID nicht/,
      );
      expect(await sql`select id from fints_connections`).toHaveLength(0);
    } finally {
      await andere.schliessen();
    }
  });

  it("nimmt nur https an, http allein zur eigenen Maschine", async () => {
    await expect(fints.fintsVerbinden(ACTOR, { ...zugang(), url: "http://bank.example/fints" }, "2026-10-29")).rejects.toThrow(/https/);
    await expect(fints.fintsVerbinden(ACTOR, { ...zugang(), blz: "1203" }, "2026-10-29")).rejects.toThrow(/acht Ziffern/);
    await expect(fints.fintsVerbinden(ACTOR, { ...zugang(), fetchFrom: "2026-11-01" }, "2026-10-29")).rejects.toThrow(/Zukunft/);
  });

  it("ruft nach 9075 mit TAN-Schritt ab und speichert das mit der Verbindung (wie die Consorsbank)", async () => {
    bank.zustand.umsatzTanVerschwiegen = true;
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-29");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    expect(await vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 })).toMatchObject({ art: "fertig", ok: true });
    const row = await verbindung();
    expect(row).toMatchObject({ status: "aktiv", last_error: null });
    const { bankdaten } = geheim.fintsGeheimnisLesen(row.ciphertext);
    expect(bankdaten.bpd?.allowedTransactions.find((t) => t.transId === "HKKAZ")?.tanRequired).toBe(true);

    // „Jetzt abrufen“ mit den gespeicherten Bankdaten: der TAN-Schritt geht gleich mit, keine zweite 9075
    const vorher = bank.zustand.anfragen.length;
    expect(await abruf.fintsAbrufen(ACTOR, row.id, "2026-10-30")).toMatchObject({ art: "fertig", ok: true });
    const abrufe = bank.zustand.anfragen.slice(vorher).filter((a) => a.segmente.includes("HKKAZ"));
    expect(abrufe.length).toBeGreaterThan(0);
    expect(abrufe.every((a) => a.segmente.includes("HKTAN"))).toBe(true);
  });

  it("verbindet kein Konto, das schon eine externe Quelle hat (#306)", async () => {
    await sql`delete from fints_connections`;
    await sql`delete from bank_connections`;
    const [b] = await sql`select id from bank_accounts where iban = ${IBAN_B}`;
    const { addExternalSource } = await import("./externe-quellen.ts");
    await addExternalSource(ACTOR, { accountId: b!.id, provider: "eigener-dienst", externalAccountId: "tagesgeld-1" });
    const wahl = await fints.fintsVerbinden(ACTOR, zugang(), "2026-10-29");
    if (wahl.art !== "verfahren") throw new Error("Verfahren erwartet");
    await expect(vorgang.vorgangFortsetzen(ACTOR, wahl.vorgang, { verfahren: 921 })).rejects.toThrow(/schon über die Schnittstelle \(eigener-dienst\)/);
    expect(await sql`select id from fints_connections`).toHaveLength(0);
  });
});
