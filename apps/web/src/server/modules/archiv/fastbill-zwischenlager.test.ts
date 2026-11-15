import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Das Zwischenlager fastbill_receipts hält Entscheidungen fest („ohne Beleg übernehmen“) und Dateien vor dem Archiv. Wie jede
// neue Tabelle mit Audit-Trigger und Trigger vor TRUNCATE (docs/entwicklung.md, Konventionen, „Audit-Log“ und
// „Unveränderlichkeit“); die DOCUMENT_URL ist ein Link mit eigenem Schlüssel und liegt deshalb nur verschlüsselt in
// ciphertext, das haben_audit auslässt („Geheimnisse“).
const URL_MIT_SCHLUESSEL = "https://my.fastbill.com/download/beleg-8101?key=geheim-0123456789";

describe.skipIf(!testDatabaseUrl)("FastBill-Zwischenlager (Postgres)", () => {
  let belege: typeof import("./fastbill-belege.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    belege = await import("./fastbill-belege.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("schreibt Vormerken und „ohne Beleg“ ins Audit-Log, ohne die Download-Adresse", async () => {
    const voucher = { number: "L-9", date: "2024-02-15", contactName: "Software Beispiel", gross: 595 };
    expect(await belege.waitingReceipt(actor, "8101", voucher, URL_MIT_SCHLUESSEL)).toBe("wartet");
    expect(await belege.markFastbillWithoutReceipt(actor, ["8101"])).toBe(1);

    const audit = await sql`select actor, action, old_value, new_value from audit_log where table_name = 'fastbill_receipts' order by seq`;
    expect(audit.map((a) => [a.actor, a.action])).toEqual([
      [actor, "INSERT"],
      [actor, "UPDATE"],
    ]);
    expect(audit.at(-1)!.new_value).toMatchObject({ expense_id: "8101", status: "ohne_beleg" });
    expect(JSON.stringify(audit)).not.toContain("geheim-0123456789");

    // Im Klartext steht die Adresse nirgends in der Tabelle; die Liste für das Browser-Skript entschlüsselt sie
    const [row] = await sql`select to_jsonb(r)::text as zeile from fastbill_receipts r where expense_id = '8101'`;
    expect(row!.zeile).not.toContain("geheim-0123456789");
  });

  it("gibt dem Browser-Skript die entschlüsselte Adresse der wartenden Ausgaben", async () => {
    const voucher = { number: "L-10", date: "2024-03-01", contactName: "Hosting Beispiel", gross: 1190 };
    await belege.waitingReceipt(actor, "8102", voucher, URL_MIT_SCHLUESSEL);
    expect(await belege.fastbillReceiptScriptList()).toEqual([{ id: "8102", url: URL_MIT_SCHLUESSEL }]);
  });

  it("lässt sich nicht per TRUNCATE leeren", async () => {
    await expect(sql`truncate fastbill_receipts`).rejects.toThrow();
  });
});
