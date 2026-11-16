import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Antworten } from "../../../lib/einrichtung.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const nichts: Antworten = {
  selbstaendig: null,
  kleinunternehmer: null,
  versteuerung: null,
  voranmeldung: null,
  ohneVorsteuerabzug: null,
  kontenrahmen: null,
  bereiche: {},
};

describe.skipIf(!testDatabaseUrl)("Fragen zur Einrichtung (Postgres, #266)", () => {
  let sql: postgres.Sql;
  let einrichtung: typeof import("./einrichtung.ts");
  let company: typeof import("../stammdaten/company.ts");
  let guard: typeof import("./settings-guard.ts");
  let cash: typeof import("../bank/cash.ts");
  const actor = "test:einrichtung";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    einrichtung = await import("./einrichtung.ts");
    company = await import("../stammdaten/company.ts");
    guard = await import("./settings-guard.ts");
    cash = await import("../bank/cash.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate cash_entries, journal_lines, journal_entries, vat_frequencies, vat_returns, employees, einrichtung, company, seals, audit_log, audit_chain cascade`;
    await sql`insert into audit_chain (id, seq, hash) values (1, 0, haben_audit_genesis())`;
  });

  const bereiche = async () => (await company.loadEinrichtung())?.ausgeblendeteBereiche;
  const zeitraeume = async () => (await sql`select year, from_month, frequency from vat_frequencies order by year, from_month`).map((r) => ({ ...r }));

  it("schreibt die Antworten in die Firmendaten und den Voranmeldungszeitraum (Freiberufler, Soll, SKR04)", async () => {
    await einrichtung.einrichtungSpeichern(
      actor,
      {
        selbstaendig: "freiberufler",
        kleinunternehmer: false,
        versteuerung: "soll",
        voranmeldung: "vierteljaehrlich",
        ohneVorsteuerabzug: true,
        kontenrahmen: "SKR04",
        bereiche: { angebote: true, kasse: false, personal: false },
      },
      today,
    );
    const firma = await company.loadCompany();
    expect(firma).toMatchObject({
      rechtsform: "einzelunternehmen",
      einkunftsart: "selbstaendig",
      kleinunternehmer: false,
      versteuerung: "soll",
      ohneVorsteuerabzug: true,
      kontenrahmen: "SKR04",
    });
    expect(firma.companySavedAt).not.toBeNull();
    expect(await company.loadEinrichtung()).toMatchObject({ ausgeblendeteBereiche: ["kasse", "personal"], offen: [] });
    expect((await company.loadEinrichtung())?.fragenAt).not.toBeNull();
    expect(await zeitraeume()).toEqual([{ year: 2026, from_month: 1, frequency: "vierteljaehrlich" }]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("„weiß ich nicht“ lässt die Vorgaben stehen, bestätigt keinen Steuerstatus und merkt sich die offenen Fragen (Gewerbe, Ist, SKR03)", async () => {
    await einrichtung.einrichtungSpeichern(actor, nichts, today);
    const firma = await company.loadCompany();
    expect(firma).toMatchObject({
      rechtsform: "einzelunternehmen",
      einkunftsart: null,
      kleinunternehmer: false,
      versteuerung: "ist",
      kontenrahmen: "SKR03",
    });
    expect(firma.companySavedAt).toBeNull();
    expect(await company.loadEinrichtung()).toMatchObject({ ausgeblendeteBereiche: [], offen: ["rechtsform", "kleinunternehmer"] });
    expect(await zeitraeume()).toEqual([]);

    // Gewerbe beantwortet, Kleinunternehmer weiter offen
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "gewerbe" }, today);
    expect(await company.loadCompany()).toMatchObject({ einkunftsart: "gewerbe", companySavedAt: null });
    expect((await company.loadEinrichtung())?.offen).toEqual(["kleinunternehmer"]);

    // Wer danach die Firmendaten speichert, hat selbst entschieden: Die Startseite erinnert nicht mehr
    await guard.saveCompany(actor, company.companySchema.parse({ ...(await company.loadCompany()), name: "Musterbetrieb" }), today);
    expect((await company.loadEinrichtung())?.offen).toEqual([]);
  });

  it("Kleinunternehmer: kein Voranmeldungszeitraum, Versteuerung bleibt", async () => {
    await einrichtung.einrichtungSpeichern(
      actor,
      { ...nichts, selbstaendig: "gewerbe", kleinunternehmer: true, versteuerung: "soll", voranmeldung: "vierteljaehrlich" },
      today,
    );
    expect(await company.loadCompany()).toMatchObject({ kleinunternehmer: true, versteuerung: "ist" });
    expect((await company.loadEinrichtung())?.offen).toEqual([]);
    expect(await zeitraeume()).toEqual([]);
  });

  it("gilt mit denselben Sperren wie die Firmendaten: Nach der ersten Buchung bleibt alles, wie es war", async () => {
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "freiberufler", kleinunternehmer: false }, today);
    await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5_000 }, today);
    const vorher = await company.loadEinrichtung();

    await expect(
      einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "gmbh", kleinunternehmer: false, bereiche: { kasse: false } }, today),
    ).rejects.toThrow(/^Rechtsform: Es gibt schon Buchungen/);
    await expect(
      einrichtung.einrichtungSpeichern(actor, { ...nichts, kleinunternehmer: false, versteuerung: "soll", bereiche: { kasse: false } }, today),
    ).rejects.toThrow(/^Versteuerung: Im Jahr 2026 gibt es schon Buchungen/);
    expect(await company.loadCompany()).toMatchObject({ rechtsform: "einzelunternehmen", versteuerung: "ist" });
    expect(await company.loadEinrichtung()).toEqual(vorher);

    // Bereiche und unveränderte Angaben gehen auch nach der ersten Buchung
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "freiberufler", kleinunternehmer: false, bereiche: { kasse: false } }, today);
    expect(await bereiche()).toEqual(["kasse"]);
  }, 30_000);

  it("ändert ohne Antworten zu den Firmendaten die Firmenzeile nicht", async () => {
    const vorher = await company.loadCompany();
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, bereiche: { lastschriften: false } }, today);
    expect(await company.loadCompany()).toEqual(vorher);
    expect(await bereiche()).toEqual(["lastschriften"]);
  });

  it("füllt beim erneuten Durchgehen vor, was gespeichert ist", async () => {
    expect((await einrichtung.einrichtungStand(today)).stand).toMatchObject({ eingerichtet: false, voranmeldung: "monatlich", ausgeblendet: [] });
    await einrichtung.einrichtungSpeichern(
      actor,
      { ...nichts, kleinunternehmer: false, voranmeldung: "vierteljaehrlich", bereiche: { anlagen: false } },
      today,
    );
    const { stand, locks } = await einrichtung.einrichtungStand(today);
    expect(stand).toMatchObject({ eingerichtet: true, firmendatenGespeichert: true, voranmeldung: "vierteljaehrlich", ausgeblendet: ["anlagen"] });
    expect(locks.rechtsform).toBeNull();
  });

  it("fragt auch bei einer Instanz von vor v0.8.0 erneut nach: Firmendaten ohne Zeitpunkt des Speicherns (drizzle/0204)", async () => {
    // Bis v0.7.0 gab es firmendaten_gespeichert_at nicht; die Migration 0204 lässt die Spalte bei allen leer
    await guard.saveCompany(
      actor,
      company.companySchema.parse({ ...(await company.loadCompany()), name: "Musterbetrieb", kleinunternehmer: true, einkunftsart: "selbstaendig" }),
      today,
    );
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor(actor, (tx) => tx.update(schema.company).set({ companySavedAt: null }));
    const { stand } = await einrichtung.einrichtungStand(today);
    const { antwortenAus, erneutDurchgehen, rueckfrageAenderungen } = await import("../../../lib/einrichtung.ts");
    expect(erneutDurchgehen(stand)).toBe(true);
    expect(antwortenAus(stand)).toMatchObject({ selbstaendig: "freiberufler", kleinunternehmer: true });
    expect(rueckfrageAenderungen(stand, { ...antwortenAus(stand), kleinunternehmer: false })).toEqual([
      { feld: "Kleinunternehmer", von: "ja", nach: "nein" },
    ]);
  });

  it("Einstellungen › Bereiche speichert sortiert und ohne Doppelte", async () => {
    expect(await company.loadEinrichtung()).toBeNull();
    await company.saveBereiche(actor, ["personal", "kasse", "kasse"]);
    expect(await bereiche()).toEqual(["kasse", "personal"]);
    await company.saveBereiche(actor, []);
    expect(await bereiche()).toEqual([]);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });
});
