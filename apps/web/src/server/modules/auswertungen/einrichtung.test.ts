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
    await leeren(sql)`truncate cash_entries, journal_lines, journal_entries, vat_frequencies, vat_returns, employees, company cascade`;
  });

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
      ausgeblendeteBereiche: ["kasse", "personal"],
      einrichtungOffen: [],
    });
    expect(firma.einrichtungAt).not.toBeNull();
    expect(firma.companySavedAt).not.toBeNull();
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
      ausgeblendeteBereiche: [],
      einrichtungOffen: ["rechtsform", "kleinunternehmer"],
    });
    expect(firma.einrichtungAt).not.toBeNull();
    expect(firma.companySavedAt).toBeNull();
    expect(await zeitraeume()).toEqual([]);

    // Gewerbe beantwortet, Kleinunternehmer weiter offen
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "gewerbe" }, today);
    expect(await company.loadCompany()).toMatchObject({ einkunftsart: "gewerbe", einrichtungOffen: ["kleinunternehmer"], companySavedAt: null });

    // Wer danach die Firmendaten speichert, hat selbst entschieden: Die Startseite erinnert nicht mehr
    await guard.saveCompany(actor, company.companySchema.parse({ ...(await company.loadCompany()), name: "Musterbetrieb" }), today);
    expect((await company.loadCompany()).einrichtungOffen).toEqual([]);
  });

  it("Kleinunternehmer: kein Voranmeldungszeitraum, Versteuerung bleibt", async () => {
    await einrichtung.einrichtungSpeichern(
      actor,
      { ...nichts, selbstaendig: "gewerbe", kleinunternehmer: true, versteuerung: "soll", voranmeldung: "vierteljaehrlich" },
      today,
    );
    expect(await company.loadCompany()).toMatchObject({ kleinunternehmer: true, versteuerung: "ist", einrichtungOffen: [] });
    expect(await zeitraeume()).toEqual([]);
  });

  it("gilt mit denselben Sperren wie die Firmendaten: Nach der ersten Buchung bleibt alles, wie es war", async () => {
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "freiberufler", kleinunternehmer: false }, today);
    await cash.createCashEntry(actor, { kind: "einlage", date: "2026-10-01", amount: 5_000 }, today);
    const vorher = await company.loadCompany();

    await expect(
      einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "gmbh", kleinunternehmer: false, bereiche: { kasse: false } }, today),
    ).rejects.toThrow(/^Rechtsform: Es gibt schon Buchungen/);
    await expect(
      einrichtung.einrichtungSpeichern(actor, { ...nichts, kleinunternehmer: false, versteuerung: "soll", bereiche: { kasse: false } }, today),
    ).rejects.toThrow(/^Versteuerung: Im Jahr 2026 gibt es schon Buchungen/);
    const nachher = await company.loadCompany();
    expect(nachher).toMatchObject({ rechtsform: "einzelunternehmen", versteuerung: "ist", ausgeblendeteBereiche: [] });
    expect(nachher.einrichtungAt).toEqual(vorher.einrichtungAt);

    // Bereiche und unveränderte Angaben gehen auch nach der ersten Buchung
    await einrichtung.einrichtungSpeichern(actor, { ...nichts, selbstaendig: "freiberufler", kleinunternehmer: false, bereiche: { kasse: false } }, today);
    expect((await company.loadCompany()).ausgeblendeteBereiche).toEqual(["kasse"]);
  }, 30_000);

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

  it("Einstellungen › Bereiche speichert sortiert und ohne Doppelte", async () => {
    await company.saveBereiche(actor, ["personal", "kasse", "kasse"]);
    expect((await company.loadCompany()).ausgeblendeteBereiche).toEqual(["kasse", "personal"]);
    await company.saveBereiche(actor, []);
    expect((await company.loadCompany()).ausgeblendeteBereiche).toEqual([]);
  });
});
