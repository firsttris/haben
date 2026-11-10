import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today as heute } from "../../today.ts";

/*
 * Freie Buchungen mit Steuerschlüssel (#502; docs/adr/journal-als-quelle.md, Entscheidung 4): manuelle Buchungen ab dem
 * Stichjahr, im Einzelunternehmen und mit USt19, USt7 oder frei auf dem Erlöskonto des Schlüssels. Haben teilt brutto in
 * Netto und Steuer; Voranmeldung und EÜR zählen sie aus dem Journal, die Gegenprobe im Abgleich auch.
 */

const KONTEN = {
  SKR03: { privat: "1800", erloese19: "8400", erloese7: "8300", erloese0: "8200", ust19: "1776", ust7: "1771", gesellschafter: "0730", aufwand: "4900" },
  SKR04: { privat: "2100", erloese19: "4400", erloese7: "4300", erloese0: "4200", ust19: "3806", ust7: "3801", gesellschafter: "3510", aufwand: "6300" },
} as const;

describe.skipIf(!testDatabaseUrl)("Freie Buchungen mit Steuerschlüssel (Postgres)", () => {
  let sql: postgres.Sql;
  let manual: typeof import("./manual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    manual = await import("./manual.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function setup(opts: {
    rechtsform?: "einzelunternehmen" | "gmbh";
    kontenrahmen: "SKR03" | "SKR04";
    versteuerung?: "ist" | "soll";
    journalAb?: number;
    kleinunternehmer?: boolean;
  }) {
    await sql`truncate vat_return_submissions, vat_returns, annual_submissions, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, kleinunternehmer, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${opts.kontenrahmen}, ${opts.versteuerung ?? "ist"}, ${opts.rechtsform ?? "einzelunternehmen"}, ${opts.kleinunternehmer ?? false},
              ${opts.journalAb ?? 2026})`;
  }

  const linesOf = async (entryId: string) =>
    (await sql`select account, debit, credit, tax_code, basis from journal_lines where entry_id = ${entryId} order by account`).map((l) => ({ ...l }));
  const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) =>
    Object.fromEntries(JOURNAL_KENNZAHLEN.filter((k) => f[k] !== 0).map((k) => [k, f[k]]));
  const euerZeile = (e: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) =>
    [...e.einnahmen, ...e.ausgaben].find((l) => l.key === key)?.amount ?? 0;

  /** Privatentnahme einer Leistung, brutto 119 € bzw. 107 €: Privat an Erlöse mit Steuerschlüssel */
  const entnahme = (kr: "SKR03" | "SKR04", date: string, code: "USt19" | "USt7" | "frei" = "USt19", brutto = 11_900) => ({
    date,
    description: "Private Nutzung der Werkstatt",
    lines: [
      { account: KONTEN[kr].privat as string, debit: brutto, credit: 0 },
      {
        account: code === "USt19" ? KONTEN[kr].erloese19 : code === "USt7" ? KONTEN[kr].erloese7 : KONTEN[kr].erloese0,
        debit: 0,
        credit: brutto,
        taxCode: code,
      },
    ],
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Einzelunternehmen: brutto geteilt, in Voranmeldung und EÜR, ohne Abweichung im Abgleich (${kontenrahmen}, ${versteuerung})`, async () => {
        await setup({ kontenrahmen, versteuerung });
        const id = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-09-10"), today);
        const sieben = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-09-11", "USt7", 10_700), today);
        expect(await linesOf(id)).toEqual(
          [
            { account: k.privat, debit: 11_900, credit: 0, tax_code: null, basis: null },
            { account: k.erloese19, debit: 0, credit: 10_000, tax_code: "USt19", basis: null },
            { account: k.ust19, debit: 0, credit: 1_900, tax_code: "USt19", basis: null },
          ].sort((a, b) => a.account.localeCompare(b.account)),
        );
        expect((await linesOf(sieben)).find((l) => l.account === k.ust7)).toMatchObject({ credit: 700, tax_code: "USt7" });
        const va = await figures.computeVatFigures({ year: 2026, month: 9 });
        expect(kennzahlen(va)).toEqual({ kz81: 10_000, tax81: 1_900, kz86: 10_000, tax86: 700 });
        expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([]);
        const euer = await reports.euerForYear(2026);
        expect(euerZeile(euer, "einnahmenSteuerpflichtig")).toBe(20_000);
        expect(euerZeile(euer, "vereinnahmteUst")).toBe(2_600);
        expect(euer.gewinn).toBe(22_600);
        expect(euer.monthly.einnahmen[8]).toBe(20_000);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      }, 60_000);
    }

    it(`frei: auf das Erlöskonto zu 0 %, ohne Steuerzeile, nicht in einer gemeldeten Kennzahl (${kontenrahmen})`, async () => {
      await setup({ kontenrahmen });
      const id = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-09-10", "frei", 5_000), today);
      expect((await linesOf(id)).map((l) => [l.account, l.tax_code])).toEqual(
        [
          [k.privat, null],
          [k.erloese0, "frei"],
        ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
      );
      const va = await figures.computeVatFigures({ year: 2026, month: 9 });
      expect(kennzahlen(va)).toEqual({ steuerfrei: 5_000 });
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([]);
      expect(euerZeile(await reports.euerForYear(2026), "einnahmenSteuerfrei")).toBe(5_000);
    }, 60_000);

    it(`Storno vor der Meldung am selben Tag; nach der Meldung im laufenden Zeitraum, Schlüssel bleiben (${kontenrahmen})`, async () => {
      await setup({ kontenrahmen });
      const id = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-08-10"), today);
      const storno = await manual.reverseManualEntry(actor, id, undefined, today);
      const [vorher] = await sql`select date from journal_entries where id = ${storno}`;
      expect(vorher!.date).toBe("2026-08-10");
      expect(await linesOf(storno)).toEqual(
        [
          { account: k.privat, debit: 0, credit: 11_900, tax_code: null, basis: null },
          { account: k.erloese19, debit: 10_000, credit: 0, tax_code: "USt19", basis: null },
          { account: k.ust19, debit: 1_900, credit: 0, tax_code: "USt19", basis: null },
        ].sort((a, b) => a.account.localeCompare(b.account)),
      );
      expect(kennzahlen(await figures.computeVatFigures({ year: 2026, month: 8 }))).toEqual({});

      const zweite = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-08-12"), today);
      await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 8, 'sent', 0, 0, 0, 0, now())`;
      const spaeter = await manual.reverseManualEntry(actor, zweite, undefined, today);
      const [nachher] = await sql`select date from journal_entries where id = ${spaeter}`;
      expect(nachher!.date).toBe(today);
      expect(kennzahlen(await figures.computeVatFigures({ year: 2026, month: 8 }))).toEqual({ kz81: 10_000, tax81: 1_900 });
      expect(kennzahlen(await figures.computeVatFigures({ year: 2026, month: 10 }))).toEqual({ kz81: -10_000, tax81: -1_900 });
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 10 })).zeilen)).toEqual([]);
      expect(await sql`select art, befund from haben_integrity_problems(100) where zeile in (${id}, ${storno}, ${zweite}, ${spaeter})`).toEqual([]);
    }, 60_000);

    it(`Storno nach einem Wechsel des Kontenrahmens mit den Konten derselben Rolle (${kontenrahmen})`, async () => {
      const anderer = kontenrahmen === "SKR03" ? "SKR04" : "SKR03";
      await setup({ kontenrahmen, journalAb: 2025 });
      const id = await manual.createManualEntry(actor, entnahme(kontenrahmen, "2025-12-10"), today);
      await sql`update company set kontenrahmen = ${anderer}`;
      const storno = await manual.reverseManualEntry(actor, id, undefined, "2026-01-20");
      const [entry] = await sql`select date, kontenrahmen from journal_entries where id = ${storno}`;
      expect(entry).toEqual({ date: "2026-01-20", kontenrahmen: anderer });
      const n = KONTEN[anderer];
      expect((await linesOf(storno)).map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual(
        [
          [n.privat, 0, 11_900, null],
          [n.erloese19, 10_000, 0, "USt19"],
          [n.ust19, 1_900, 0, "USt19"],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
      expect(kennzahlen(await figures.computeVatFigures({ year: 2026, month: 1 }))).toEqual({ kz81: -10_000, tax81: -1_900 });
    }, 60_000);

    it(`lehnt ab: vor dem Stichjahr, Kleinunternehmer, gemeldeter Zeitraum, falsches Konto oder Gegenkonto (${kontenrahmen})`, async () => {
      await setup({ kontenrahmen, journalAb: 2027 });
      await expect(manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-09-10"), today)).rejects.toThrow("erst ab dem Stichjahr");
      // Der Stand als Kleinunternehmer gilt ab dem Tag der Änderung im Protokoll, hier dem Anlegen der Firma heute
      await setup({ kontenrahmen, kleinunternehmer: true, journalAb: 2000 });
      await expect(manual.createManualEntry(actor, entnahme(kontenrahmen, heute()), heute())).rejects.toThrow("Kleinunternehmer");
      await setup({ kontenrahmen });
      await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 9, 'sent', 0, 0, 0, 0, now())`;
      await expect(manual.createManualEntry(actor, entnahme(kontenrahmen, "2026-09-10"), today)).rejects.toThrow("schon gemeldet");
      const falschesKonto = entnahme(kontenrahmen, "2026-10-01");
      falschesKonto.lines[1]!.account = k.erloese7;
      await expect(manual.createManualEntry(actor, falschesKonto, today)).rejects.toThrow(`Mit USt19 bucht die Zeile auf ${k.erloese19}`);
      const gegenkonto = entnahme(kontenrahmen, "2026-10-01");
      gegenkonto.lines[0]!.account = k.gesellschafter;
      await expect(manual.createManualEntry(actor, gegenkonto, today)).rejects.toThrow("Gegenkonto");
      expect(await sql`select id from journal_entries`).toEqual([]);
    }, 60_000);

    it(`GmbH: Gegenkonto Gesellschafter-Verrechnungskonto, nicht Privat (${kontenrahmen})`, async () => {
      await setup({ kontenrahmen, rechtsform: "gmbh" });
      const privat = entnahme(kontenrahmen, "2026-09-10");
      await expect(manual.createManualEntry(actor, privat, today)).rejects.toThrow("Privatkonto");
      const gesellschafter = entnahme(kontenrahmen, "2026-09-10");
      gesellschafter.lines[0]!.account = k.gesellschafter;
      await manual.createManualEntry(actor, gesellschafter, today);
      expect(kennzahlen(await figures.computeVatFigures({ year: 2026, month: 9 }))).toEqual({ kz81: 10_000, tax81: 1_900 });
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([]);
      // Vor dem Stichjahr bleibt die Umbuchung ohne Schlüssel erlaubt, mit Schlüssel nicht
      await sql`update company set journal_ab = 2027`;
      await expect(manual.createManualEntry(actor, gesellschafter, today)).rejects.toThrow("erst ab dem Stichjahr");
      await manual.createManualEntry(
        actor,
        {
          date: "2026-09-12",
          description: "Umbuchung",
          lines: [
            { account: k.aufwand, debit: 100, credit: 0 },
            { account: k.gesellschafter, debit: 0, credit: 100 },
          ],
        },
        today,
      );
    }, 60_000);
  }
});
