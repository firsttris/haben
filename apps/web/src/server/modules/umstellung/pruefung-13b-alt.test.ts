import type { SelfAssessedTax } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1396: Belege mit § 13b oder Erwerb, gebucht vor #551 (bis v0.6), tragen im Journal die Steuer ohne Abzug in der
 * Aufwandszeile mit dem Steuerschlüssel bzw. das private Netto ohne Steuerschlüssel auf den Entnahmen. Gesendet wurde die
 * richtige Bemessungsgrundlage aus dem Beleg. Die Prüfung beim Update darf daran nicht scheitern, und die Voranmeldung aus dem
 * Journal muss dasselbe ergeben wie mit einer heutigen Buchung. Je SKR03 und SKR04, Ist und Soll.
 */

describe.skipIf(!testDatabaseUrl)("Prüfung beim Update: § 13b und Erwerb aus Versionen vor #551 (Postgres)", () => {
  let sql: postgres.Sql;
  let umstellung: typeof import("./index.ts");
  let documents: typeof import("../belege/documents.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  const actor = "test-user";
  const today = "2026-10-04";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    umstellung = await import("./index.ts");
    documents = await import("../belege/documents.ts");
    vat = await import("../umsatzsteuer/index.ts");
    cancellation = await import("../belege/cancellation.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04", v: "ist" | "soll") {
    await leeren(
      sql,
    )`truncate journal_umstellung, document_cancellations, vat_return_submissions, vat_returns, journal_lines, journal_entries, document_amounts,
      documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${v}, ${kr})`;
    await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis) values (2027, 'offen')`;
  }

  /** Beleg über 100 € netto (oder `amounts`), privat bezahlt; ohne Vorsteuerabzug mit Anteil 0 */
  async function beleg(
    art: SelfAssessedTax,
    vorsteuerAbzug: boolean,
    privateShare: number,
    amounts: { taxRate: 1900 | 700; net: number; tax: number }[] = [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
  ) {
    docSeq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq, 3, 96]), filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "IE6388047V",
      invoiceNumber: `R${docSeq}`,
      documentDate: "2026-04-02",
      dueDate: null,
      category: art === "ig_erwerb" ? "wareneinkauf" : "edv",
      payment: "privat",
      note: "",
      amounts,
      privateShare,
      reverseCharge: art,
      ...(vorsteuerAbzug ? {} : { vorsteuerAnteil: 0 }),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Gesendete Voranmeldung April mit den Werten aus der heutigen Buchung */
  async function gesendet() {
    const werte = await vat.computedValues({ year: 2026, month: 4 });
    await sql`insert into vat_returns ${sql({ year: 2026, month: 4, ...werte, status: "sent", source: "berechnet", sent_at: new Date().toISOString() } as never)}`;
    return werte;
  }

  /**
   * Die Zeilen der Belegbuchung so, wie Haben sie bis v0.6 schrieb (git show 0c2bab5e): Steuer ohne Abzug in die Aufwandszeile
   * mit dem Steuerschlüssel, privates Netto zur privaten Steuer ohne Steuerschlüssel. Salden je Konto bleiben gleich. `vorUpdate`:
   * angelegt vor dem Update auf das Journal (vor der Zeile, die die Migration in journal_umstellung schreibt), wie bei einer
   * Instanz, die mit v0.6 gebucht hat.
   */
  async function wieVor551(kr: "SKR03" | "SKR04", vorUpdate = true) {
    const privatentnahmen = kr === "SKR03" ? "1800" : "2100";
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      // Nur die Belegbuchung selbst; ein Storno nach dem Update behält seinen Zeitpunkt
      if (vorUpdate) await tx`update journal_entries set created_at = (select min(at) from journal_umstellung) - interval '30 days' where reverses_id is null`;
      // Soll oder Haben, damit es auch für einen Storno gilt
      for (const k of await tx`select id, entry_id, account, debit, credit from journal_lines where tax_code = 'keineVSt'`) {
        // Die Zeile des Satzes direkt davor; bei zwei Sätzen auf einem Konto ist sie hier nicht eindeutig (die Reihenfolge der
        // Zeilen steht nicht in der Tabelle), das deckt alte-belegbuchung.test.ts ab
        const ziel = await tx`update journal_lines set debit = debit + ${k.debit}, credit = credit + ${k.credit} where entry_id = ${k.entry_id}
          and account = ${k.account} and tax_code in ('RC13bEU', 'RC13bDrittland', 'IGE19', 'IGE7') returning id`;
        if (ziel.length !== 1) throw new Error(`wieVor551: ${ziel.length} Zeilen für die Steuer ohne Abzug, erwartet eine`);
        await tx`delete from journal_lines where id = ${k.id}`;
      }
      for (const p of await tx`select id, entry_id, debit, credit from journal_lines where account = ${privatentnahmen} and tax_code is not null`) {
        await tx`update journal_lines set debit = debit + ${p.debit}, credit = credit + ${p.credit} where entry_id = ${p.entry_id} and account = ${privatentnahmen} and tax_code is null`;
        await tx`delete from journal_lines where id = ${p.id}`;
      }
    });
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const v of ["ist", "soll"] as const)
      for (const [art, abzug, anteil] of [
        ["eu", false, 0],
        ["drittland", true, 25],
        ["ig_erwerb", false, 0],
      ] as const)
        it(`${art}, Vorsteuerabzug ${abzug}, Privatanteil ${anteil} Prozent: besteht, Voranmeldung wie gesendet (${kr}, ${v})`, async () => {
          await reset(kr, v);
          await beleg(art, abzug, anteil);
          const werte = await gesendet();
          const feld = art === "eu" ? "kz46" : art === "drittland" ? "kz84" : "kz89";
          expect(werte[feld]).toBe(10_000);
          const vorher = await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account order by account`;
          await wieVor551(kr);
          // Die Umformung trifft wirklich etwas, die Salden bleiben
          expect(await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account order by account`).toEqual(vorher);
          expect(
            (await sql`select count(*)::int as n from journal_lines where tax_code = 'keineVSt' or (account in ('1800', '2100') and tax_code is not null)`)[0]!
              .n,
          ).toBe(0);
          expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
          expect(await vat.computedValues({ year: 2026, month: 4 })).toEqual(werte);
        }, 60_000);

  // Erwerb zu 19 % und 7 % mit Privatanteil: Den privaten Teil beider Sätze buchte v0.6 in einer Summe auf die Entnahmen.
  // Aufgeteilt wird er mit Beträgen und Privatanteil des Belegs (belegeWieHeute); im Update-Test mit Daten aus v0.6.6 blieb
  // dieser Beleg sonst als einziger Befund (#1502). Ohne Vorsteuerabzug: alte-belegbuchung.test.ts
  for (const kr of ["SKR03", "SKR04"] as const)
    for (const [v, abzug, anteil] of [
      ["ist", true, 10],
      ["soll", true, 33],
    ] as const)
      it(`ig_erwerb zu 19 % und 7 %, Vorsteuerabzug ${abzug}, Privatanteil ${anteil} Prozent: besteht, Voranmeldung wie gesendet (${kr}, ${v})`, async () => {
        await reset(kr, v);
        await beleg("ig_erwerb", abzug, anteil, [
          { taxRate: 1900, net: 30_001, tax: 5_700 },
          { taxRate: 700, net: 9_999, tax: 700 },
        ]);
        const werte = await gesendet();
        // In vollen Euro, wie gemeldet
        expect(werte).toMatchObject({ kz89: 30_000, kz93: 9_900 });
        await wieVor551(kr);
        expect((await sql`select count(*)::int as n from journal_lines where account in ('1800', '2100') and tax_code is null`)[0]!.n).toBe(1);
        expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
        expect(await vat.computedValues({ year: 2026, month: 4 })).toEqual(werte);
      }, 60_000);

  // Dieselbe Zeilenform in einer Buchung nach dem Update hat keine alte Version geschrieben: Sie bleibt, wie gebucht, und die
  // Abweichung fällt auf, statt umgedeutet zu werden
  for (const kr of ["SKR03", "SKR04"] as const)
    it(`Zeilenform von vor #551 in einer Buchung nach dem Update: wie gebucht, Befund (${kr})`, async () => {
      await reset(kr, "soll");
      await beleg("eu", false, 0);
      await gesendet();
      await wieVor551(kr, false);
      expect(await umstellung.umstellungBefunde(2027, today)).toEqual([
        expect.objectContaining({ bereich: "ustva", schluessel: "gesendet:2026-04:Kz 46", journal: 11_900, quelle: 10_000 }),
      ]);
    }, 60_000);

  // Storno eines alten Belegs nach dem Update: Ergeben die heutigen Zeilen nicht auf jedem Konto dasselbe (zeilenWieHeute),
  // kehrt er die gebuchten in der alten Form um. Er gehört zur alten Buchung und wird wie sie gelesen (Hinweis aus der
  // Selbstprüfung)
  for (const kr of ["SKR03", "SKR04"] as const)
    it(`Storno nach dem Update in der Form von vor #551: mindert Kz 46 um das Netto (${kr})`, async () => {
      await reset(kr, "soll");
      const id = await beleg("eu", false, 0);
      await gesendet();
      await wieVor551(kr);
      await cancellation.cancelDocument(actor, id, { reason: "Doppelt erfasst" } as never, "2026-05-10");
      // Die Gegenbuchung liegt im Mai (April ist gemeldet) und trägt die alte Form
      await wieVor551(kr, false);
      const [storno] =
        await sql`select date::text, created_at > (select min(at) from journal_umstellung) as nach_update from journal_entries where reverses_id is not null`;
      expect(storno).toEqual({ date: "2026-05-10", nach_update: true });
      expect((await vat.computedValues({ year: 2026, month: 5 })).kz46).toBe(-10_000);
      expect(await umstellung.umstellungBefunde(2027, today)).toEqual([]);
    }, 60_000);
});
