import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/*
 * Körperschaft- und Gewerbesteuererklärung einer GmbH aus den Buchungen: Angaben, Prüfen mit ERiC (wenn vorhanden,
 * test-eric.ts), Protokoll, echt erst nach dem Abschluss des Jahres und nur einmal.
 */
describe.skipIf(!testDatabaseUrl)("Erklärungen der GmbH (Postgres)", () => {
  let sql: postgres.Sql;
  let erklaerung: typeof import("./kapg-erklaerung.ts");
  let kst: typeof import("./koerperschaft.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let abschluss: typeof import("../buchhaltung/abschluss.ts");
  let crypto: typeof import("../../crypto.ts");
  const actor = "test-user";
  const today = "2026-02-10";

  beforeAll(async () => {
    sql = await setupTestDb();
    erklaerung = await import("./kapg-erklaerung.ts");
    kst = await import("./koerperschaft.ts");
    ledger = await import("../buchhaltung/ledger.ts");
    abschluss = await import("../buchhaltung/abschluss.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, corporate_tax_inputs,
      elster_certificates, company cascade`;
    await sql.begin(async (tx) => {
      for (const table of ["year_closings", "annual_submissions"]) {
        await tx.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
        await tx.unsafe(`delete from ${table}`);
        await tx.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
      }
    });
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, taetigkeit)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 'gmbh', 'Entwicklung von Software')`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: globalThis.crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  const anteilseigner = {
    name: "Erika Gesellschafter",
    strasse: "Hafenallee 3",
    plzOrt: "93047 Regensburg",
    idnr: "86095742719",
    beteiligung: 2_500_000,
    anteil: 10_000,
    geaendert: false,
  };

  describe.each([
    ["SKR03", { bank: "1200", erloes: "8400", ust: "1776", miete: "4210", bewirtung: "4650" }],
    ["SKR04", { bank: "1800", erloes: "4400", ust: "3806", miete: "6310", bewirtung: "6640" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: Körperschaft- und Gewerbesteuererklärung prüfen, echt erst nach dem Abschluss",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        await book("2025-03-01", [
          [k.bank, 7_140_000, 0],
          [k.erloes, 0, 6_000_000],
          [k.ust, 0, 1_140_000],
        ]);
        await book("2025-04-01", [
          [k.miete, 1_200_000, 0],
          [k.bank, 0, 1_200_000],
        ]);
        await book("2025-05-01", [
          [k.bewirtung, 100_000, 0],
          [k.bank, 0, 100_000],
        ]);

        let stand = await erklaerung.kapgErklaerungen(2025, today);
        expect(stand?.kst.issues.map((i) => i.text)).toEqual(
          expect.arrayContaining(["Hebesatz und Verlustvorträge fehlen; sie stehen beim Jahresabschluss.", "Die Anteilseigner fehlen."]),
        );
        await kst.saveKapgAngaben(actor, 2025, { hebesatz: 400, verlustvortragKst: 500_000, verlustvortragGewst: 0 });
        await expect(kst.saveKapgErklaerungAngaben(actor, 2025, { anteilseigner: [{ ...anteilseigner, anteil: 5000 }] })).rejects.toThrow("nicht 100 %");
        await kst.saveKapgErklaerungAngaben(actor, 2025, {
          anteilseigner: [anteilseigner],
          vertraege: [{ art: "Geschäftsführervertrag", datum: "2024-01-02", partner: "Erika Gesellschafter", verguetung: 0 }],
        });

        stand = await erklaerung.kapgErklaerungen(2025, today);
        expect(stand?.kst.issues).toEqual([expect.objectContaining({ tone: "hinweis", text: expect.stringContaining("erst, wenn 2025 abgeschlossen") })]);
        // 60.000 − 12.000 − 1.000 = 47.000; + 300 Bewirtung; − 5.000 Vortrag; 15 %
        expect(stand?.kst.werte).toMatchObject({ einkuenfte: 47_300, zvE: 42_300, kst: 6345, verlust: { anfang: 5000, ende: 0 } });

        const client = new EricGeprueftClient();
        for (const form of ["kst", "gewst"] as const) {
          expect((await erklaerung.submitKapg(actor, form, 2025, client, { kind: "validate", today })).ok).toBe(true);
        }
        const rows = await sql`select form, request_xml from annual_submissions order by created_at`;
        expect(rows.map((r) => r.form)).toEqual(["kst", "gewst"]);
        // Miete in voller Höhe; den Hinzurechnungsbetrag ermittelt das Finanzamt
        expect(rows[1]!.request_xml).toContain("<E4003602>12000</E4003602>");
        expect(rows[0]!.request_xml).toContain("<E8101301>300</E8101301>");

        await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1, 2, 3]))})`;
        const realClient = {
          validate: client.validate.bind(client),
          send: client.send.bind(client),
          fetchPostfach: client.fetchPostfach.bind(client),
          fetchBelege: client.fetchBelege.bind(client),
        };
        const send = () => erklaerung.submitKapg(actor, "kst", 2025, realClient, { kind: "send", pin: "1234", herstellerId: "12345", today });
        await expect(send()).rejects.toThrow("Das Jahr 2025 ist noch nicht abgeschlossen.");
        await abschluss.closeYear(actor, 2025, today);
        expect((await send()).ok).toBe(true);
        await expect(send()).rejects.toThrow("schon übermittelt");
        expect((await erklaerung.kapgErklaerungen(2025, today))?.kst.sent).toBe(true);

        // 2026 übernimmt Anteilseigner und Verträge aus 2025, kennt das Formular aber noch nicht
        const folge = await erklaerung.kapgErklaerungen(2026, "2027-02-10");
        expect(folge?.angaben.anteilseigner).toHaveLength(1);
        expect(folge?.kst.issues.map((i) => i.text)).toContain("Die Körperschaftsteuererklärung kennt Haben für 2025, nicht für 2026.");
      },
      60_000,
    );
  });

  it("Einzelunternehmen haben diese Erklärungen nicht", async () => {
    await setup("SKR04", "ist");
    await sql`update company set rechtsform = 'einzelunternehmen'`;
    expect(await erklaerung.kapgErklaerungen(2025, today)).toBeNull();
    await expect(erklaerung.submitKapg(actor, "gewst", 2025, new EricGeprueftClient(), { kind: "validate", today })).rejects.toThrow("nur für GmbH und UG");
  });
});
