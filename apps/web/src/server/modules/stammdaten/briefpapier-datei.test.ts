import { buildEInvoice } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleDocument } from "../../../../../../packages/einvoice/src/samples.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** TDD-Review #420: Ein angenommenes Briefpapier darf kein PDF verhindern */
// 4×4 Pixel JPEG im Farbraum CMYK, wie Druckereien sie liefern
const CMYK_JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/8AAFAgABAAEBEMRAE0RAFkRAEsRAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAA4EQwBNAFkASwAAPwD6cr6Pr6Br6pr/2Q==",
    "base64",
  ),
);
const NUR_PNG_KOPF = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe.skipIf(!testDatabaseUrl)("Briefpapier: nur Dateien annehmen, aus denen ein PDF wird (Postgres)", () => {
  let letterhead: typeof import("./letterhead.ts");
  let background: typeof import("./background.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    letterhead = await import("./letterhead.ts");
    background = await import("./background.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate letterhead_profiles, letterhead_background, company_logo, company cascade`;
    await sql`insert into company (id, name) values (1, 'Testfirma')`;
  });

  it.each([
    ["ein CMYK-JPEG", CMYK_JPEG],
    ["eine Datei, die nur den PNG-Kopf hat", NUR_PNG_KOPF],
  ])("%s wird abgelehnt oder lässt sich als Rechnung ausgeben", async (_name, data) => {
    const accepted = await background.saveBackground(actor, data).then(
      () => true,
      () => false,
    );
    if (!accepted) return;
    await expect(buildEInvoice({ ...sampleDocument(), ...(await letterhead.loadLetterhead()) })).resolves.toBeTruthy();
  });
});
