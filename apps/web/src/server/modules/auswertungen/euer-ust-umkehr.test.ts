import type { EuerResult } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Eine technische Rücknahme ist keine Finanzamtserstattung (amtliche EÜR-Anleitung 2025, Zeilen 18 und 58).
 * https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025 */
describe.skipIf(!testDatabaseUrl)("USt-Zuordnung in der EÜR aufheben (Postgres)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("./reports.ts");
  let abgleich: typeof import("./abgleich.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/bank.ts");
    reports = await import("./reports.ts");
    abgleich = await import("./abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, journal_ab)
      values (1, 'Musterbetrieb', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 2026)`;
  }

  async function transactions(rows: [string, string][]) {
    const text =
      `"Girokonto";"DE12 1203 0000 1234 5678 90"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      rows
        .map(([date, amount]) =>
          [
            date,
            date,
            "Gebucht",
            amount.startsWith("-") ? "Musterbetrieb" : "Finanzamt",
            amount.startsWith("-") ? "Finanzamt" : "Musterbetrieb",
            "Umsatzsteuer",
            "Überweisung",
            "DE02100100100006820101",
            amount,
            "",
            "",
            "",
          ]
            .map((c) => `"${c}"`)
            .join(";"),
        )
        .join("\n");
    await bank.importStatement("test-user", { bytes: new TextEncoder().encode(text), filename: "umsatzsteuer.csv" }, null);
    return sql<{ id: string; amount: number; booking_date: string }[]>`select id, amount, booking_date::text from bank_transactions order by booking_date`;
  }

  async function reverseAndReassign(transaction: { id: string; amount: number }) {
    await bank.allocate("test-user", { kind: "ustVorauszahlung", transactionId: transaction.id, amount: transaction.amount });
    const [allocation] = await sql`select id from allocations where transaction_id = ${transaction.id} and reverses_id is null`;
    await bank.reverseAllocation("test-user", allocation!.id);
    await bank.allocate("test-user", { kind: "ustVorauszahlung", transactionId: transaction.id, amount: transaction.amount });
  }

  async function expectAmounts(year: number, paid: number, refunded: number) {
    const amounts = (result: EuerResult) => {
      const lines = [...result.einnahmen, ...result.ausgaben];
      return { paid: lines.find((l) => l.key === "gezahlteUst")?.amount ?? 0, refunded: lines.find((l) => l.key === "erstatteteUst")?.amount ?? 0 };
    };
    expect(amounts(await reports.euerAusNebenbuechern(year))).toEqual({ paid, refunded });
    expect(amounts(await reports.euerForYear(year))).toEqual({ paid, refunded });
    const result = await abgleich.euerAbgleich(year);
    expect(result.hinweise).toEqual([]);
    expect(abgleich.abweichungen(result.zeilen)).toEqual([]);
  }

  for (const kr of ["SKR03", "SKR04"] as const)
    for (const vat of ["ist", "soll"] as const) {
      it(`eine aufgehobene und neu zugeordnete USt-Zahlung zählt einmal; echte Erstattung bleibt (${kr}, ${vat})`, async () => {
        await reset(kr, vat);
        const [payment, refund] = await transactions([
          ["10.03.26", "-190,00"],
          ["10.04.26", "50,00"],
        ]);
        await reverseAndReassign(payment!);
        await bank.allocate("test-user", { kind: "ustVorauszahlung", transactionId: refund!.id, amount: refund!.amount });
        await expectAmounts(2026, 19_000, 5_000);
      });

      it(`eine aufgehobene und neu zugeordnete echte Erstattung erzeugt keine USt-Zahlung (${kr}, ${vat})`, async () => {
        await reset(kr, vat);
        const [refund, payment] = await transactions([
          ["10.03.26", "190,00"],
          ["10.04.26", "-50,00"],
        ]);
        await reverseAndReassign(refund!);
        await bank.allocate("test-user", { kind: "ustVorauszahlung", transactionId: payment!.id, amount: payment!.amount });
        await expectAmounts(2026, 5_000, 19_000);
      });

      it(`Dezember-Zuordnung aufheben und neu zuordnen verschiebt nichts ins Erstattungsjahr (${kr}, ${vat})`, async () => {
        await reset(kr, vat);
        const [payment, refund] = await transactions([
          ["10.12.26", "-190,00"],
          ["15.01.27", "50,00"],
        ]);
        await reverseAndReassign(payment!);
        await bank.allocate("test-user", { kind: "ustVorauszahlung", transactionId: refund!.id, amount: refund!.amount });
        await expectAmounts(2026, 19_000, 0);
        await expectAmounts(2027, 0, 5_000);
      });
    }
});
