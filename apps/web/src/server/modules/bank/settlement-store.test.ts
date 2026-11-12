import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

it("Zahlungen und Ausbuchungen gehen immer durch den gemeinsamen Steuerschreiber (#622)", () => {
  const writes = /\.insert\(schema\.(allocations|cashEntries|writeOffs)\)|(insert\s+into)\s+(allocations|cash_entries|write_offs)\b/i;
  const files = sources(fileURLToPath(new URL("../../", import.meta.url)));
  expect(files.some((file) => file.endsWith(join("bank", "bank.ts")))).toBe(true);
  expect(files.filter((file) => !file.endsWith(join("bank", "settlement-store.ts")) && writes.test(readFileSync(file, "utf8")))).toEqual([]);
  expect(writes.test("tx.insert(schema.cashEntries).values(entry)")).toBe(true);
  expect(writes.test("insert into allocations (invoice_id) values ($1)")).toBe(true);
  expect(writes.test("tx.select().from(schema.writeOffs)")).toBe(false);
});
