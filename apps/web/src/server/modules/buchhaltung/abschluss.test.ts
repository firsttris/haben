import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Jahresabschluss (Postgres)", () => {
  let sql: postgres.Sql;
  let abschluss: typeof import("./abschluss.ts");
  let manual: typeof import("./manual.ts");
  let ledger: typeof import("./ledger.ts");
  const actor = "test-user";
  const today = "2027-02-10";

  beforeAll(async () => {
    sql = await setupTestDb();
    abschluss = await import("./abschluss.ts");
    manual = await import("./manual.ts");
    ledger = await import("./ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(rechtsform: "einzelunternehmen" | "gmbh", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, company cascade`;
    // year_closings ist nur anhängbar; für jeden Fall leer beginnen
    await sql.begin(async (tx) => {
      await tx`alter table year_closings disable trigger year_closings_append_only`;
      await tx`delete from year_closings`;
      await tx`alter table year_closings enable trigger year_closings_append_only`;
    });
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", gesellschafter: "0730", erloes: "8400", ust: "1776", aufwand: "4900" }],
    ["SKR04", { bank: "1800", kapital: "2900", gesellschafter: "3510", erloes: "4400", ust: "3806", aufwand: "6300" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: Bilanz und GuV der Kleinst-GmbH, Abschluss sperrt das Jahr",
      async (versteuerung) => {
        await setup("gmbh", kontenrahmen, versteuerung);
        await manual.createManualEntry(
          actor,
          {
            kind: "eroeffnung",
            date: "2026-01-01",
            description: "Eröffnungsbilanz",
            lines: [
              { account: k.bank, debit: 2_500_000, credit: 0 },
              { account: k.kapital, debit: 0, credit: 2_500_000 },
            ],
          },
          today,
        );
        await book("2026-03-01", [
          [k.bank, 1_190_000, 0],
          [k.erloes, 0, 1_000_000],
          [k.ust, 0, 190_000],
        ]);
        await book("2026-04-01", [
          [k.aufwand, 300_000, 0],
          [k.gesellschafter, 0, 300_000],
        ]);

        const result = await abschluss.jahresabschluss(2026, today);
        if (!result.kapitalgesellschaft) throw new Error("GmbH erwartet");
        expect(result.report.guv).toMatchObject({ umsatzerloese: 1_000_000, sonstigeAufwendungen: 300_000 });
        expect(result.report.jahresergebnis).toBe(700_000);
        expect(result.report.bilanz).toMatchObject({ "aktiva.B": 3_690_000, "passiva.A": 3_200_000, "passiva.C": 490_000 });
        expect(result.report.aktiva).toBe(result.report.passiva);
        expect(result.issues).toEqual([]);
        expect(result.status).toBeNull();

        await expect(abschluss.closeYear(actor, 2026, "2026-12-31")).rejects.toThrow("noch nicht vorbei");
        const status = await abschluss.closeYear(actor, 2026, today);
        expect(status).toMatchObject({ entries: 3, intact: true });
        await expect(abschluss.closeYear(actor, 2026, today)).rejects.toThrow("bereits abgeschlossen");

        // Danach keine Buchung mehr im Jahr, auch nicht an Haben vorbei; das Folgejahr bleibt offen
        await expect(
          book("2026-12-31", [
            [k.aufwand, 100, 0],
            [k.gesellschafter, 0, 100],
          ]),
        ).rejects.toThrow("Das Jahr 2026 ist abgeschlossen");
        await book("2027-01-05", [
          [k.aufwand, 100, 0],
          [k.gesellschafter, 0, 100],
        ]);
        // Auch an der App vorbei lehnt die Datenbank ab
        await expect(
          sql.begin(async (tx) => {
            const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
            values ('2026-06-01', 'SQL', 'document', gen_random_uuid(), ${kontenrahmen}) returning id`;
            await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, ${k.aufwand}, 1, 0), (${e!.id}, ${k.gesellschafter}, 0, 1)`;
            await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
          }),
        ).rejects.toThrow("Das Jahr 2026 ist abgeschlossen");
        await expect(sql`update year_closings set digest = 'x'`).rejects.toThrow("nur ergänzt");
        await expect(sql`delete from year_closings`).rejects.toThrow("nur ergänzt");

        // Der Vortrag ins Folgejahr: Gewinn auf dem Gewinnvortrag
        const next = await ledger.saldenliste(ledger.ledgerRange(2027));
        expect(next.find((r) => r.account === (kontenrahmen === "SKR03" ? "0860" : "2970"))?.eroeffnung).toBe(-700_000);
        expect((await abschluss.jahresabschluss(2026, today)).status).toMatchObject({ intact: true });
      },
      30_000,
    );
  });

  it("merkt, wenn Buchungen eines abgeschlossenen Jahres an Haben vorbei geändert werden", async () => {
    await setup("gmbh", "SKR04");
    const id = await book("2026-05-01", [
      ["6300", 1_000, 0],
      ["3510", 0, 1_000],
    ]);
    await abschluss.closeYear(actor, 2026, today);
    // Wer Trigger abschalten kann, kann auch ändern; der Prüfwert zeigt es
    await sql.begin(async (tx) => {
      await tx`alter table journal_entries disable trigger user`;
      await tx`update journal_entries set date = '2026-05-02' where id = ${id}`;
      await tx`alter table journal_entries enable trigger user`;
    });
    expect((await abschluss.jahresabschluss(2026, today)).status).toMatchObject({ intact: false });
  });

  it("offene Arbeit hindert den Abschluss; Einzelunternehmen schließen hier nicht ab", async () => {
    await setup("gmbh", "SKR04");
    await sql`insert into documents (filename, sha256, mime_type, size, status, document_date)
      values ('beleg.pdf', ${"a".repeat(64)}, 'application/pdf', 1, 'neu', '2026-11-30')`;
    await expect(abschluss.closeYear(actor, 2026, today)).rejects.toThrow("Ein Beleg mit Datum in 2026 ist noch nicht gebucht");

    await setup("einzelunternehmen", "SKR04");
    await expect(abschluss.closeYear(actor, 2026, today)).rejects.toThrow("nur in GmbH und UG");
    expect((await abschluss.jahresabschluss(2026, today)).kapitalgesellschaft).toBe(false);
  });

  it("meldet nicht ausgeglichene Vorträge", async () => {
    await setup("gmbh", "SKR04");
    await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2026-01-01",
        description: "Nur die Bank übernommen",
        lines: [
          { account: "1800", debit: 100_000, credit: 0 },
          { account: "9000", debit: 0, credit: 100_000 },
        ],
      },
      today,
    );
    const result = await abschluss.jahresabschluss(2026, today);
    if (!result.kapitalgesellschaft) throw new Error("GmbH erwartet");
    expect(result.issues).toEqual([{ tone: "hinweis", text: expect.stringContaining("Konto 9000") }]);
  });
});
