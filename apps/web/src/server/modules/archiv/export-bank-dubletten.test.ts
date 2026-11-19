import { sql as query } from "drizzle-orm";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

it.skipIf(!testDatabaseUrl)(
  "Jahresarchiv zeigt Dublette und Rücknahme mit unverändertem Umsatz und Import (#865)",
  async () => {
    const sql = await setupTestDb();
    try {
      const { exportYear } = await import("./export.ts");
      const { decideDuplicate } = await import("../bank/duplicate-review.ts");
      const { withActor } = await import("../../db/actor.ts");
      const [calendar] = await sql<{ year: number }[]>`select extract(year from now() at time zone 'Europe/Berlin')::int as year`;
      const year = calendar!.year;
      const date = `${year}-10-05`;
      const iban = "DE89370400440532013000";
      const [account] = await sql`insert into bank_accounts (name, iban) values ('Musterkonto', ${iban}) returning id`;
      const movements: string[] = [];
      for (const [i, purpose] of ["MUSTER K UND ENREFERENZ X0", "MUSTER KUNDENREFERENZ X"].entries()) {
        const [source] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
        values (${account!.id}, ${`abruf-${i}.json`}, ${String(i).repeat(64)}, 'enablebanking', 1, 0) returning id`;
        const [movement] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
        values (${account!.id}, ${source!.id}, ${date}, -4999, ${purpose}, ${`umsatz-${i}`}) returning id`;
        movements.push(String(movement!.id));
      }
      const [review] = await withActor("system:bank-import", (tx) =>
        tx.execute<{ id: string }>(query`insert into bank_duplicate_reviews (transaction_id, original_transaction_id)
        values (${movements[1]}, ${movements[0]}) returning id`),
      );

      const archive = async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of exportYear(year)) chunks.push(chunk);
        const files = unzipSync(Buffer.concat(chunks));
        return (path: string) => new TextDecoder().decode(files[path]);
      };
      const csvPath = `bank/${iban}/umsaetze.csv`;
      const actor = "test-dubletten-archiv";
      await decideDuplicate(actor, { id: review!.id, decision: "duplicate", requestId: crypto.randomUUID() });
      const confirmed = await archive();
      const [header, ...rows] = confirmed(csvPath).trimEnd().split("\r\n");
      expect(header).toContain(";Umsatz-ID;Dublette");
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.includes("MUSTER K UND ENREFERENZ X0"))).toContain(`;0,00;-49,99;nein;abruf-0.json;${movements[0]};nein`);
      const duplicate = rows.find((row) => row.includes("MUSTER KUNDENREFERENZ X"));
      expect(duplicate).toContain(";-49,99;EUR;");
      expect(duplicate).toContain(`;0,00;0,00;nein;abruf-1.json;${movements[1]};ja`);
      expect(confirmed("bank/importe.csv")).toContain(`;abruf-1.json;${"1".repeat(64)};enablebanking;`);
      expect(confirmed("index.xml")).toContain("<Name>Dublette</Name>");
      expect(confirmed("protokoll/audit.csv")).toContain(`;${actor};bank_duplicate_decisions;`);

      const [decision] = await sql<{ id: string }[]>`select id from bank_duplicate_decisions where review_id = ${review!.id}`;
      await decideDuplicate(actor, { id: review!.id, decision: "pending", decisionId: decision!.id });
      const restored = await archive();
      expect(restored(csvPath)).toContain(`;0,00;-49,99;nein;abruf-1.json;${movements[1]};nein`);
      expect(restored("protokoll/audit.csv").split(`;${actor};bank_duplicate_decisions;`)).toHaveLength(3);
    } finally {
      await sql.end();
    }
  },
  60_000,
);
