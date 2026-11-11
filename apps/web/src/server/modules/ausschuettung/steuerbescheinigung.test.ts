import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Steuerbescheinigungen nach § 45a Abs. 2 EStG zu einer gebuchten Ausschüttung: je Gesellschafter mit Anschrift und
 * Identifikationsnummer aus den Angaben zur Erklärung, Teil aus dem Einlagekonto, Kirchensteuer, fehlende Angaben,
 * erst ab dem Zahlungstag, nicht nach einem Storno.
 */
describe.skipIf(!testDatabaseUrl)("Steuerbescheinigungen (Postgres)", () => {
  let sql: postgres.Sql;
  let a: typeof import("./ausschuettung.ts");
  let s: typeof import("./steuerbescheinigung.ts");
  let kst: typeof import("../jahreserklaerung/koerperschaft.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  const actor = "test-user";
  const today = "2026-07-15";

  beforeAll(async () => {
    sql = await setupTestDb();
    a = await import("./ausschuettung.ts");
    s = await import("./steuerbescheinigung.ts");
    kst = await import("../jahreserklaerung/koerperschaft.ts");
    manual = await import("../buchhaltung/manual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", k: { bank: string; kapital: string; vortrag: string }) {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, corporate_tax_inputs,
      elster_certificates, company cascade`;
    await sql.begin(async (tx) => {
      for (const table of ["year_closings", "kapest_submissions", "dividends"]) {
        await tx.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
        await tx.unsafe(`delete from ${table}`);
        await tx.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
      }
    });
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
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
  // Nur mit Steuernummer: für die Körperschaftsteuererklärung genug, für die Bescheinigung fehlt die IdNr.
  const max = { name: "Max", strasse: "Weg 2", plzOrt: "93047 Regensburg", steuernummer13: "9198011310010", beteiligung: 1_000_000, anteil: 4000 };

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", vortrag: "0860" }],
    ["SKR04", { bank: "1800", kapital: "2900", vortrag: "2970" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: je Gesellschafter, mit Einlagekonto und Kirchensteuer, fehlende IdNr. gemeldet",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung, k);
        await kst.saveKapgErklaerungAngaben(actor, 2026, {
          einlagekonto: 500_000,
          anteilseigner: [{ ...erika, kirchensteuer: 9, religionsschluessel: "010100", religionsgemeinschaft: "evangelisch" }, max],
        });
        // Ausschüttbarer Gewinn 20.000 €: von 22.000 € kommen 2.000 € aus dem Einlagekonto (60 : 40)
        const id = await a.createAusschuettung(
          actor,
          { geschaeftsjahr: 2025, beschluss: "2026-04-01", auszahlungstag: "2026-04-10", brutto: 2_200_000 },
          today,
        );

        const status = await s.steuerbescheinigungenDesJahres(2026, today);
        expect(status[id]).toEqual([
          { nr: 0, name: "Erika", fehlend: [] },
          { nr: 1, name: "Max", fehlend: ["Steuerliche Identifikationsnummer von Max fehlt (Jahreserklärung › Angaben zu den Erklärungen)."] },
        ]);

        const pdf = await s.loadSteuerbescheinigungPdf(id, 0, today);
        expect(pdf!.filename).toBe("Steuerbescheinigung-2026-04-10-Erika.pdf");
        expect(Buffer.from(pdf!.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
        await expect(s.loadSteuerbescheinigungPdf(id, 1, today)).rejects.toThrow("Identifikationsnummer von Max fehlt");
        expect(await s.loadSteuerbescheinigungPdf(id, 2, today)).toBeNull();
        expect(await s.loadSteuerbescheinigungPdf(crypto.randomUUID(), 0, today)).toBeNull();

        // Die Beträge der Bescheinigung sind die gebuchten des Gesellschafters
        const [d] = await sql`select empfaenger, geschaeftsjahr from dividends where id = ${id}`;
        expect(d!.geschaeftsjahr).toBe(2025);
        expect(d!.empfaenger[0]).toMatchObject({ brutto: 1_320_000, ausEinlagekonto: 120_000, ertrag: 1_200_000, kirchensteuer: 9 });
        expect(d!.empfaenger[1]).toMatchObject({ brutto: 880_000, ausEinlagekonto: 80_000, ertrag: 800_000, kist: 0 });
      },
      30_000,
    );
  });

  it("erst ab dem Zahlungstag, nach einem Storno keine", async () => {
    await setup("SKR04", "ist", { bank: "1800", kapital: "2900", vortrag: "2970" });
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [{ ...erika, anteil: 10_000 }] });
    const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-07-01", auszahlungstag: "2026-08-03", brutto: 1_000_000 }, today);
    expect((await s.steuerbescheinigungenDesJahres(2026, today))[id]![0]!.fehlend).toEqual([
      "Die Ausschüttung fließt erst am 03.08.2026 zu; die Bescheinigung gibt es ab diesem Tag.",
    ]);
    await expect(s.loadSteuerbescheinigungPdf(id, 0, today)).rejects.toThrow("erst am 03.08.2026");
    expect(await s.loadSteuerbescheinigungPdf(id, 0, "2026-08-03")).not.toBeNull();

    await a.reverseAusschuettung(actor, id);
    expect((await s.steuerbescheinigungenDesJahres(2026, "2026-08-03"))[id]).toBeUndefined();
    await expect(s.loadSteuerbescheinigungPdf(id, 0, "2026-08-03")).rejects.toThrow("storniert");
  }, 30_000);

  it("zwei Gesellschafter mit gleichem Namen: jeder mit seinen eigenen Angaben", async () => {
    await setup("SKR04", "soll", { bank: "1800", kapital: "2900", vortrag: "2970" });
    // Vater und Sohn heißen gleich; nur der Vater hat eine IdNr. eingetragen
    const vater = { ...erika, name: "Max Muster", anteil: 5000, beteiligung: 1_250_000 };
    const sohn = { ...max, name: "Max Muster", anteil: 5000, beteiligung: 1_250_000 };
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [vater, sohn] });
    const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 100_000 }, today);
    expect((await s.steuerbescheinigungenDesJahres(2026, today))[id]).toEqual([
      { nr: 0, name: "Max Muster", fehlend: [] },
      { nr: 1, name: "Max Muster", fehlend: ["Steuerliche Identifikationsnummer von Max Muster fehlt (Jahreserklärung › Angaben zu den Erklärungen)."] },
    ]);
    await expect(s.loadSteuerbescheinigungPdf(id, 1, today)).rejects.toThrow("Identifikationsnummer von Max Muster fehlt");
  }, 30_000);

  it("Kirchensteuer ohne Namen der Religionsgemeinschaft gemeldet; Geschäftsjahr nach dem Beschluss abgelehnt", async () => {
    await setup("SKR03", "soll", { bank: "1200", kapital: "0800", vortrag: "0860" });
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [{ ...erika, anteil: 10_000, kirchensteuer: 8, religionsschluessel: "026300" }] });
    await expect(a.createAusschuettung(actor, { geschaeftsjahr: 2027, beschluss: "2026-03-01", brutto: 100_000 }, today)).rejects.toThrow(
      "Das Geschäftsjahr 2027 liegt nach dem Jahr des Beschlusses.",
    );
    // Ein Zwischenstand aus dem Formular wie „1“ wird auf Deutsch abgelehnt
    await expect(a.createAusschuettung(actor, { geschaeftsjahr: 1, beschluss: "2026-03-01", brutto: 100_000 }, today)).rejects.toThrow(
      "Geschäftsjahr der Ausschüttung ist kein gültiges Jahr",
    );
    const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 100_000 }, today);
    expect((await s.steuerbescheinigungenDesJahres(2026, today))[id]![0]!.fehlend).toEqual([
      "Kirchensteuererhebende Religionsgemeinschaft von Erika fehlt (Jahreserklärung › Angaben zu den Erklärungen).",
    ]);
  }, 30_000);

  it("fehlende Anschrift der Gesellschaft", async () => {
    await setup("SKR03", "ist", { bank: "1200", kapital: "0800", vortrag: "0860" });
    await kst.saveKapgErklaerungAngaben(actor, 2026, { anteilseigner: [{ ...erika, anteil: 10_000 }] });
    const id = await a.createAusschuettung(actor, { geschaeftsjahr: 2025, beschluss: "2026-03-01", brutto: 100_000 }, today);
    await sql.begin(async (tx) => {
      await tx`alter table company disable trigger user`;
      await tx`update company set strasse = ''`;
      await tx`alter table company enable trigger user`;
    });
    expect((await s.steuerbescheinigungenDesJahres(2026, today))[id]![0]!.fehlend).toEqual([
      "Anschrift der Gesellschaft ist unvollständig (Einstellungen › Firmendaten).",
    ]);
  }, 30_000);
});
