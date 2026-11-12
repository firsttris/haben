import type { EuerResult } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Unabhängige Gegenprobe: Teilzuordnungen, wiederholte Rücknahmen und echte Gegenrichtung.
 * EÜR-Anleitung 2025, Zeilen 18 und 58: https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025 */
describe.skipIf(!testDatabaseUrl)("Review #706: USt-Teile und Rechtsformen (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("./reports.ts");
  let journal: typeof import("./euer-journal.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/bank.ts");
    reports = await import("./reports.ts");
    journal = await import("./euer-journal.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  const amounts = (r: EuerResult) => {
    const lines = [...r.einnahmen, ...r.ausgaben];
    return {
      paid: lines.find((l) => l.key === "gezahlteUst")?.amount ?? 0,
      refunded: lines.find((l) => l.key === "erstatteteUst")?.amount ?? 0,
    };
  };

  async function transaction(amount: string, date: string) {
    const columns = [
      "Buchungsdatum",
      "Wertstellung",
      "Status",
      "Zahlungspflichtige*r",
      "Zahlungsempfänger*in",
      "Verwendungszweck",
      "Umsatztyp",
      "IBAN",
      "Betrag (€)",
      "Gläubiger-ID",
      "Mandatsreferenz",
      "Kundenreferenz",
    ];
    const row = [date, date, "Gebucht", "Finanzamt", "Reviewbetrieb", crypto.randomUUID(), "Überweisung", "DE02100100100006820101", amount, "", "", ""];
    const csv = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n\n${[columns, row].map((r) => r.map((v) => `"${v}"`).join(";")).join("\n")}`;
    await bank.importStatement("test-user", { bytes: new TextEncoder().encode(csv), filename: "review.csv" }, null);
    const [t] = await sql<{ id: string }[]>`select id from bank_transactions where purpose = ${row[5]!}`;
    return t!.id;
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const vat of ["ist", "soll"] as const)
      for (const rechtsform of ["einzelunternehmen", "gmbh"] as const)
        for (const sign of [-1, 1] as const) {
          it(`${kr}, ${vat}, ${rechtsform}, ${sign}: verrechnete USt-Zahlung und Erstattung behalten beide Richtungen`, async () => {
            await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
            await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, journal_ab)
              values (1, 'Reviewbetrieb', 'Ring 1', '93047', 'Regensburg', 'review@example.com', '198/113/10010', 'BY', ${kr}, ${vat}, ${rechtsform}, 2026)`;
            const id = await transaction(sign < 0 ? "-190,01" : "190,01", "03.06.26");
            // Das Finanzamt verrechnet 25,00 € Erstattung mit 215,01 € Zahllast (bzw. umgekehrt).
            await bank.allocateSplit("test-user", {
              transactionId: id,
              parts: [
                { kind: "ustVorauszahlung", amount: -sign * 2500 },
                { kind: "ustVorauszahlung", amount: sign * 21501 },
              ],
            });
            const expected = sign < 0 ? { paid: 21501, refunded: 2500 } : { paid: 2500, refunded: 21501 };
            const check = async (value: { paid: number; refunded: number }) => {
              expect(amounts(await reports.euerAusNebenbuechern(2026))).toEqual(value);
              expect(amounts(await reports.euerForYear(2026))).toEqual(value);
              const j = (await journal.euerAusJournal(2026)).summe.zeilen;
              expect({ paid: j.gezahlteUst ?? 0, refunded: j.erstatteteUst ?? 0 }).toEqual(value);
            };
            await check(expected);
            const [part] = await sql<{ id: string }[]>`select id from allocations where transaction_id = ${id} limit 1`;
            await bank.reverseAllocation("test-user", part!.id);
            await check({ paid: 0, refunded: 0 });
            // Neu zugeordnet in umgekehrter Reihenfolge: dieselben EÜR-Zeilen.
            await bank.allocateSplit("test-user", {
              transactionId: id,
              parts: [
                { kind: "ustVorauszahlung", amount: sign * 21501 },
                { kind: "ustVorauszahlung", amount: -sign * 2500 },
              ],
            });
            await check(expected);
          });
        }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const vat of ["ist", "soll"] as const)
      for (const rechtsform of ["einzelunternehmen", "gmbh"] as const)
        for (const kind of ["ustVorauszahlung", "sondervorauszahlung"] as const)
          for (const sign of [-1, 1] as const) {
            it(`${kr}, ${vat}, ${rechtsform}, ${kind}, ${sign}: Teilrücknahmen bleiben in ihrer Zeile`, async () => {
              await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
              await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform, journal_ab)
                values (1, 'Reviewbetrieb', 'Ring 1', '93047', 'Regensburg', 'review@example.com', '198/113/10010', 'BY', ${kr}, ${vat}, ${rechtsform}, 2026)`;
              const first = await transaction(sign < 0 ? "-190,01" : "190,01", "03.06.26");
              const opposite = await transaction(sign < 0 ? "37,03" : "-37,03", "04.06.26");
              const allocate = async (transactionId: string, amount: number) => {
                await bank.allocate("test-user", { kind, transactionId, amount });
                const [a] = await sql<
                  { id: string }[]
                >`select id from allocations where transaction_id = ${transactionId} and amount = ${amount} and reverses_id is null order by created_at desc limit 1`;
                return a!.id;
              };
              const check = async (remaining: number) => {
                const expected = sign < 0 ? { paid: remaining, refunded: 3703 } : { paid: 3703, refunded: remaining };
                expect(amounts(await reports.euerAusNebenbuechern(2026))).toEqual(expected);
                expect(amounts(await reports.euerForYear(2026))).toEqual(expected);
                const j = (await journal.euerAusJournal(2026)).summe.zeilen;
                expect({ paid: j.gezahlteUst ?? 0, refunded: j.erstatteteUst ?? 0 }).toEqual(expected);
              };
              await allocate(opposite, -sign * 3703);
              const part = await allocate(first, sign * 10001);
              await allocate(first, sign * 9000);
              await check(19001);
              await bank.reverseAllocation("test-user", part);
              await check(9000);
              const second = await allocate(first, sign * 7777);
              await allocate(first, sign * 2224);
              await check(19001);
              await bank.reverseAllocation("test-user", second);
              await check(11224);
              await allocate(first, sign * 7777);
              await check(19001);
            });
          }
});
