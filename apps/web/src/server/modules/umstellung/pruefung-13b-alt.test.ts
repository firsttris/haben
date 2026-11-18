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
  const actor = "test-user";
  const today = "2026-10-04";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    umstellung = await import("./index.ts");
    documents = await import("../belege/documents.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04", v: "ist" | "soll") {
    await leeren(sql)`truncate journal_umstellung, vat_return_submissions, vat_returns, journal_lines, journal_entries, document_amounts,
      documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${v}, ${kr})`;
    await sql`insert into journal_umstellung (stichjahr_vorher, ergebnis) values (2027, 'offen')`;
  }

  /** Beleg über 100 € netto, privat bezahlt; ohne Vorsteuerabzug mit Anteil 0 */
  async function beleg(art: SelfAssessedTax, vorsteuerAbzug: boolean, privateShare: number) {
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
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      privateShare,
      reverseCharge: art,
      ...(vorsteuerAbzug ? {} : { vorsteuerAnteil: 0 }),
    });
    await documents.bookDocument(actor, id);
  }

  /** Gesendete Voranmeldung April mit den Werten aus der heutigen Buchung */
  async function gesendet() {
    const werte = await vat.computedValues({ year: 2026, month: 4 });
    await sql`insert into vat_returns ${sql({ year: 2026, month: 4, ...werte, status: "sent", source: "berechnet", sent_at: new Date().toISOString() } as never)}`;
    return werte;
  }

  /**
   * Die Zeilen der Belegbuchung so, wie Haben sie bis v0.6 schrieb (git show 0c2bab5e): Steuer ohne Abzug in die Aufwandszeile
   * mit dem Steuerschlüssel, privates Netto zur privaten Steuer ohne Steuerschlüssel. Salden je Konto bleiben gleich.
   */
  async function wieVor551(kr: "SKR03" | "SKR04") {
    const privatentnahmen = kr === "SKR03" ? "1800" : "2100";
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const k of await tx`select id, entry_id, account, debit from journal_lines where tax_code = 'keineVSt'`) {
        await tx`update journal_lines set debit = debit + ${k.debit} where entry_id = ${k.entry_id} and account = ${k.account}
          and tax_code in ('RC13bEU', 'RC13bDrittland', 'IGE19', 'IGE7')`;
        await tx`delete from journal_lines where id = ${k.id}`;
      }
      for (const p of await tx`select id, entry_id, debit from journal_lines where account = ${privatentnahmen} and tax_code is not null`) {
        await tx`update journal_lines set debit = debit + ${p.debit} where entry_id = ${p.entry_id} and account = ${privatentnahmen} and tax_code is null`;
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
});
