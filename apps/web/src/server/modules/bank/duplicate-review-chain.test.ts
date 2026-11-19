import { expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

it.skipIf(!testDatabaseUrl).each(["original-zuerst", "dublette-zuerst", "gleichzeitig", "gemeinsames-original"] as const)(
  "erhält zwei gemeinsam gelieferte Zahlungen bei überlappenden Dublettenverdachten (%s)",
  async (order) => {
    const sql = await setupTestDb();
    try {
      const { decideDuplicate, duplicateReviewsForTransaction } = await import("./duplicate-review.ts");
      const { listAccounts } = await import("./index.ts");
      const { userMessage } = await import("../../errors.ts");
      const [account] = await sql`insert into bank_accounts (name, purpose, provider, ledger_index)
        values ('Zahlungsdienstkonto', 'zahlungsdienstleister', 'sonstige', 1) returning id`;
      const insert = async (letter: string) => {
        const [source] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
          values (${account!.id}, ${letter}, ${letter}, 'enablebanking', 1, 0) returning id`;
        const [row] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, dedup_hash)
          values (${account!.id}, ${source!.id}, '2026-10-05', -4999, ${letter}, ${letter}) returning id`;
        return { id: String(row!.id), importId: String(source!.id) };
      };
      const a = await insert("A");
      const b = await insert("B");
      const c = await insert("C");
      await sql`insert into bank_import_transactions (bank_import_id, transaction_id) values (${c.importId}, ${a.id})`;
      const review = async (candidate: string, original: string) => {
        const [row] = await sql`insert into bank_duplicate_reviews (transaction_id, original_transaction_id)
          values (${candidate}, ${original}) returning id`;
        return String(row!.id);
      };
      const first = order === "gemeinsames-original" ? await review(a.id, b.id) : await review(b.id, a.id);
      const second = await review(c.id, b.id);
      const confirm = (id: string) => decideDuplicate("test-bearbeiter", { id, decision: "duplicate", requestId: crypto.randomUUID() });
      const attempt = (id: string) =>
        confirm(id).then(
          () => null,
          (error: unknown) => {
            const message = userMessage(error);
            if (message === undefined) throw error;
            return message;
          },
        );

      let results: (string | null)[];
      if (order === "gleichzeitig") {
        results = await Promise.all([attempt(first), attempt(second)]);
      } else if (order === "dublette-zuerst") {
        results = [await attempt(second), await attempt(first)];
      } else {
        results = [await attempt(first), await attempt(second)];
      }

      expect((await listAccounts()).find(({ id }) => id === account!.id)).toMatchObject({ providerBalance: -9998, openCount: 2 });
      expect(results.filter((message) => message === null)).toHaveLength(1);
      const blocked = results.find((message) => message !== null);
      expect(blocked).toMatch(/Dublette/);
      const detail = (await Promise.all([a, b, c].map((row) => duplicateReviewsForTransaction(row.id)))).flat();
      expect(detail).toContainEqual(expect.objectContaining({ decision: "pending", confirmationBlockReason: blocked }));
    } finally {
      await sql.end();
    }
  },
);
