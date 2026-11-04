import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/*
 * Gewinnausschüttung einer GmbH aus den Büchern: Gesellschafter aus den Angaben zur Erklärung, Steuerabzug mit und ohne
 * Kirchensteuer, Buchung, Einlagekonto, Storno und Kapitalertragsteuer-Anmeldung (mit ERiC, wenn vorhanden).
 */
describe.skipIf(!testDatabaseUrl)("Ausschüttungen (Postgres)", () => {
  let sql: postgres.Sql;
  let a: typeof import("./ausschuettung.ts");
  let kst: typeof import("../jahreserklaerung/koerperschaft.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let crypto: typeof import("../../crypto.ts");
  const actor = "test-user";
  const today = "2026-07-15";

  beforeAll(async () => {
    sql = await setupTestDb();
    a = await import("./ausschuettung.ts");
    kst = await import("../jahreserklaerung/koerperschaft.ts");
    manual = await import("../buchhaltung/manual.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", k: { bank: string; kapital: string; vortrag: string }) {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, corporate_tax_inputs, elster_certificates, company cascade`;
    await sql.begin(async (tx) => {
      for (const table of ["year_closings", "kapest_submissions", "dividends"]) {
        await tx.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
        await tx.unsafe(`delete from ${table}`);
        await tx.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
      }
    });
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '0941 12345', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 'gmbh')`;
    // Eröffnung: Bank 50.000 €, Stammkapital 25.000 €, Gewinnvortrag 25.000 €
    await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2026-01-01",
        description: "Eröffnungsbilanz",
        lines: [
          { account: k.bank, debit: 5_000_000, credit: 0 },
          { account: k.kapital, debit: 0, credit: 2_500_000 },
          { account: k.vortrag, debit: 0, credit: 2_500_000 },
        ],
      },
      today,
    );
  }

  const erika = { name: "Erika", strasse: "Weg 1", plzOrt: "93047 Regensburg", idnr: "86095742719", beteiligung: 1_500_000, anteil: 6000 };
  const max = { name: "Max", strasse: "Weg 2", plzOrt: "93047 Regensburg", idnr: "86095742719", beteiligung: 1_000_000, anteil: 4000 };

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", vortrag: "0860", gesellschafter: "0730", einbehalt: "1746" }],
    ["SKR04", { bank: "1800", kapital: "2900", vortrag: "2970", gesellschafter: "3510", einbehalt: "3760" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: Steuerabzug je Gesellschafter, Buchung, Anmeldung, Storno",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung, k);
        const input = { geschaeftsjahr: 2025, beschluss: "2026-06-15", auszahlungstag: "2026-06-30", brutto: 1_000_000 };
        await expect(a.createAusschuettung(actor, input, today)).rejects.toThrow("keine Anteilseigner");
        await kst.saveKapgErklaerungAngaben(actor, 2026, {
          anteilseigner: [
            { ...erika, kirchensteuer: 9, religionsschluessel: "010100" },
            { ...max, kirchensteuer: 0 },
          ],
        });

        const v = await a.ausschuettungVorschlag(input);
        expect(v.issues).toEqual([]);
        // Erika 6.000 €: 6.000 / 4,09 = 1.466,99 € KapESt, 9 % KiSt 132,02 €, Soli 80,68 €; Max 4.000 €: 1.000 € KapESt, 55 € Soli
        expect(v.empfaenger.map((e) => [e.name, e.brutto, e.kapest, e.kist, e.soli, e.netto])).toEqual([
          ["Erika", 600_000, 146_699, 13_202, 8_068, 600_000 - 146_699 - 13_202 - 8_068],
          ["Max", 400_000, 100_000, 0, 5_500, 400_000 - 105_500],
        ]);
        expect(v.zufluss).toBe("2026-06-30");

        await expect(a.createAusschuettung(actor, { ...input, brutto: 3_000_000 }, today)).rejects.toThrow("Gewinnvortrag");
        const id = await a.createAusschuettung(actor, input, today);
        const steuern = 146_699 + 13_202 + 8_068 + 100_000 + 5_500;
        const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
          where e.source_type = 'ausschuettung' order by l.account`;
        expect(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)]).sort()).toEqual(
          [
            [k.vortrag, 1_000_000, 0],
            [k.gesellschafter, 0, 1_000_000 - steuern],
            [k.einbehalt, 0, steuern],
          ].sort(),
        );
        expect((await a.dividendsOfYear(2026)).map((d) => [d.id, d.storniert, d.angemeldet])).toEqual([[id, false, false]]);
        // In der Fristenliste: bis 10. Juli (Freitag), offen bis zur Echtübermittlung
        const { listFristen } = await import("../finanzamt/fristen.ts");
        const frist = () => listFristen(today).then((l) => l.find((f) => f.id === `kapest-${id}`));
        expect(await frist()).toMatchObject({ datum: "2026-07-10", status: "offen", link: "/ausschuettungen?jahr=2026" });

        // Anmeldung prüfen (ERiC, wenn vorhanden), testweise senden; danach kein Storno mehr
        const client = new EricGeprueftClient();
        expect((await a.submitKapESt(actor, id, client, { kind: "validate" })).ok).toBe(true);
        const [row] = await sql`select request_xml from kapest_submissions where dividend_id = ${id}`;
        expect(row!.request_xml).toContain("<K010100>132.02</K010100>");
        expect(row!.request_xml).toContain("<KapESch25>10000</KapESch25>");
        await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1, 2, 3]))})`;
        const realClient = {
          validate: client.validate.bind(client),
          send: client.send.bind(client),
          fetchPostfach: client.fetchPostfach.bind(client),
          fetchBelege: client.fetchBelege.bind(client),
        };
        const send = () => a.submitKapESt(actor, id, realClient, { kind: "send", pin: "1234", herstellerId: "12345" });
        expect((await send()).ok).toBe(true);
        await expect(send()).rejects.toThrow("schon übermittelt");
        await expect(a.reverseAusschuettung(actor, id)).rejects.toThrow("schon angemeldet");
        expect((await a.dividendsOfYear(2026))[0]).toMatchObject({ angemeldet: true });
        expect(await frist()).toMatchObject({ status: "erledigt" });
      },
      60_000,
    );

    it("Storno vor der Anmeldung; Leistung über dem ausschüttbaren Gewinn aus dem Einlagekonto", async () => {
      await setup(kontenrahmen, "ist", k);
      await kst.saveKapgErklaerungAngaben(actor, 2026, { einlagekonto: 500_000, anteilseigner: [{ ...erika, anteil: 10_000 }] });
      const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 500_000 }, today);
      await a.reverseAusschuettung(actor, id);
      await expect(a.reverseAusschuettung(actor, id)).rejects.toThrow("schon storniert");
      expect((await a.dividendsOfYear(2026))[0]).toMatchObject({ storniert: true });
      const saldo = await sql`select sum(l.debit - l.credit)::int as s from journal_lines l where l.account = ${k.vortrag}`;
      expect(saldo[0]!.s).toBe(-2_500_000);

      // Ausschüttbarer Gewinn: 50.000 € Eigenkapital − 25.000 € Stammkapital − 5.000 € Einlagekonto = 20.000 €
      const v = await a.ausschuettungVorschlag({ geschaeftsjahr: 2025, beschluss: "2026-04-01", brutto: 2_200_000 });
      expect(v.ausschuettbarerGewinn).toBe(2_000_000);
      expect(v.ausEinlagekonto).toBe(200_000);
      expect(v.empfaenger[0]).toMatchObject({ ertrag: 2_000_000, kapest: 500_000 });
      expect(v.zufluss).toBe("2026-04-02");

      // Für die Anlage KSt 1 F: nur die gültige Ausschüttung, mit dem Teil aus dem Einlagekonto
      await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-04-01", brutto: 2_200_000 }, today);
      const { loadCompany } = await import("../stammdaten/index.ts");
      expect(await a.einlagekontoJahr(await loadCompany(), 2026)).toEqual({
        eigenkapital: 5_000_000,
        nennkapital: 2_500_000,
        leistungen: [{ beschluss: "2026-04-01", abfluss: "2026-04-02", brutto: 2_200_000, ausEinlagekonto: 200_000 }],
      });
    }, 30_000);
  });

  it("Rückdatierter Beschluss: nicht mehr als der Gewinnvortrag, auch wenn eine spätere Ausschüttung schon gebucht ist", async () => {
    const k = { bank: "1200", kapital: "0800", vortrag: "0860" };
    await setup("SKR03", "ist", k);
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [{ ...erika, anteil: 10_000 }] });
    // Der ganze Gewinnvortrag von 25.000 € ist am 1. Juni ausgeschüttet
    await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-06-01", brutto: 2_500_000 }, today);
    // Ein Beschluss vom 1. März sieht am Beschlusstag noch 25.000 €, darf sie aber nicht ein zweites Mal ausschütten
    await expect(a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 2_500_000 }, today)).rejects.toThrow("Gewinnvortrag");
    const saldo = await sql`select sum(l.debit - l.credit)::int as s from journal_lines l where l.account = ${k.vortrag}`;
    expect(saldo[0]!.s).toBe(0);
  }, 30_000);

  it("Gleichzeitiges Storno bucht nur eine Gegenbuchung", async () => {
    await setup("SKR03", "ist", { bank: "1200", kapital: "0800", vortrag: "0860" });
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [{ ...erika, anteil: 10_000 }] });
    const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 1_000_000 }, today);
    const results = await Promise.allSettled([a.reverseAusschuettung(actor, id), a.reverseAusschuettung(actor, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const stornos = await sql`select count(*)::int as n from journal_entries where source_type = 'ausschuettung' and reverses_id is not null`;
    expect(stornos[0]!.n).toBe(1);
  }, 30_000);

  it("Einzelunternehmen haben keine Ausschüttungen", async () => {
    await setup("SKR04", "ist", { bank: "1800", kapital: "2900", vortrag: "2970" });
    await sql.begin(async (tx) => {
      await tx`alter table company disable trigger user`;
      await tx`update company set rechtsform = 'einzelunternehmen'`;
      await tx`alter table company enable trigger user`;
    });
    await expect(a.ausschuettungVorschlag({ geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 100 })).rejects.toThrow("nur in GmbH und UG");
  });
});
