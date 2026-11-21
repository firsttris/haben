import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #1504: Ein Beleg, dessen Datei in der Sicherung fehlt, wurde bis 0.12.0 gar nicht angelegt. `importVoucher` lud
 * erst alle Dateien und schrieb den Beleg danach; ein Fehler beim Laden brach den ganzen Beleg ab. Jetzt steht der
 * Beleg, die fehlende Datei hängt als Stand an ihm, und der Abgleich nennt ihn als offenen Punkt. Entwürfe und
 * Vorgänge ohne Belegart tauchen nicht mehr ohne Zahl auf.
 */

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

const VOUCHER = fixture("voucher-gross.json");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
/** Steuert, ob der Abruf die Anhangsdatei herausgibt; der zweite Lauf holt sie damit nach (#1504) */
let dateiKlappt = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page(content: unknown[]) {
  return { content, first: true, last: true, totalPages: 1, totalElements: content.length, number: 0, size: 250, numberOfElements: content.length };
}

const listItem = (id: string, voucherStatus: string, voucherNumber: string) => ({
  id,
  voucherType: "purchaseinvoice",
  voucherStatus,
  voucherNumber,
  voucherDate: "2023-02-21T00:00:00.000+01:00",
  createdDate: "2023-02-21T14:43:28.000+01:00",
  updatedDate: "2023-02-21T14:45:01.000+01:00",
  contactName: "Berliner Kindl GmbH",
  totalAmount: 100,
  openAmount: 0,
  currency: "EUR",
  archived: false,
});

/** Nachgebaute Lexware-API: ein Ausgabebeleg, dessen Datei nicht kommt, und ein Entwurf */
function fakeApi() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") return json([]);
    if (path === "/contacts") return json(page([]));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(page([listItem(String(VOUCHER.id), "paid", "2023-4711"), listItem("00000000-0000-4000-8000-000000000001", "draft", "")]));
    }
    if (path === `/vouchers/${VOUCHER.id}`) return json(VOUCHER);
    // Genau der Fall aus #1504: Der Beleg führt eine Datei, der Abruf liefert sie nicht
    if (path.startsWith("/files/")) {
      if (!dateiKlappt) return json({ message: "Datei nicht in der Sicherung" }, 500);
      return new Response(JPEG, { headers: { "content-type": "image/jpeg", "content-disposition": "attachment; filename=Quittung.jpg" } });
    }
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
}

describe.skipIf(!testDatabaseUrl)("Lexoffice: fehlende Belegdatei (#1504)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  const actor = "test-user";
  let sql: postgres.Sql;
  let voucherId = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    const importPkg = await import("@haben/import");
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: fakeApi(), minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    await lexoffice.saveApiKey(actor, "schluessel-1234567890-abcdefghij");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt den Beleg trotzdem an, vermerkt die fehlende Datei und zählt den Entwurf", async () => {
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();

    // Der Lauf bleibt grün: eine fehlende Datei ist kein fehlgeschlagener Beleg
    expect(run!.progress).toMatchObject({ listed: 1, imported: 1, files: 0, failed: [] });
    // Der Entwurf stand in der Liste, ist aber kein Beleg; er wird gezählt statt still übergangen
    expect(run!.progress.ignored).toEqual({ drafts: 1, types: [] });

    const [voucher] = await sql`select id, number, gross from lexoffice_vouchers where number = '2023-4711'`;
    expect(voucher).toMatchObject({ number: "2023-4711", gross: 12_970 });
    voucherId = String(voucher!.id);

    // Der Stand hängt am Beleg, mit Grund und Kennung der Datei
    const [stand] = await sql`select state, role, source_file_id, message from legacy_file_states where voucher_id = ${voucher!.id}`;
    expect(stand).toMatchObject({ state: "abruf_fehlgeschlagen", role: "anhang" });
    expect(String(stand!.message)).toContain("Datei fehlt in der Sicherung");
    expect(stand!.source_file_id).toBeTruthy();

    // Ansicht: offener Punkt, kein Knopf zum Bestätigen — das Merkmal ohne Beleg trägt der Beleg nicht
    const detail = await lexoffice.legacyVoucherDetail(String(voucher!.id));
    expect(detail!.fileState).toMatchObject({ status: "abruf_fehlgeschlagen", canConfirmWithoutFile: false });
    const { confirmWithoutFile } = await import("./dateistand.ts");
    await expect(confirmWithoutFile(actor, String(voucher!.id), "probe")).rejects.toThrow();

    // Abgleich: „Jeder Beleg hat eine Datei“ bleibt offen und beziffert den fehlenden Beleg
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    const check = jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")!;
    expect(check).toMatchObject({ ok: false, detail: "1 Abruf fehlgeschlagen" });
  });

  it("holt die fehlende Datei aus einem späteren Lauf nach und löst den offenen Punkt", async () => {
    // Eine neue Sicherung enthält die Datei: der Beleg ist schon da, die Datei kommt jetzt
    dateiKlappt = true;
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ nachgeladen: 1, failed: [] });

    const [datei] =
      await sql`select role, mime_type from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id where v.number = '2023-4711'`;
    expect(datei).toMatchObject({ role: "anhang", mime_type: "image/jpeg" });

    // Der Stand am Beleg ist aufgelöst, der Abgleich wieder grün
    const [stand] = await sql`select state from legacy_file_states where voucher_id = ${voucherId} order by created_at desc, id desc limit 1`;
    expect(stand!.state).toBe("nachgeladen");
    const jahr = (await lexoffice.reconciliation()).years.find((y) => y.year === 2023)!;
    expect(jahr.checks.find((c) => c.label === "Jeder Beleg hat eine Datei")).toMatchObject({ ok: true, detail: "alle mit Datei" });
  });

  it("fasst übergangene Arten zusammen und lässt Leeres weg", () => {
    expect(lexoffice.ignoredSummary(0, [])).toBeUndefined();
    expect(lexoffice.ignoredSummary(2, [])).toEqual({ drafts: 2, types: [] });
    expect(
      lexoffice.ignoredSummary(1, [
        { type: "quotation", number: "AN-1" },
        { type: "quotation", number: "AN-2" },
        { type: "unbekannt", number: "" },
      ]),
    ).toEqual({
      drafts: 1,
      types: [
        { type: "quotation", count: 2 },
        { type: "unbekannt", count: 1 },
      ],
    });
  });
});

describe("Sicherung: was keine Belegart hat", () => {
  it("meldet die übergangenen Vorgänge mit ihrer Art", async () => {
    const { webExportSource } = await import("@haben/import");
    const quotation = JSON.parse(
      readFileSync(new URL("../../../../../../packages/import/test-fixtures/lexoffice-web/list-quotation.json", import.meta.url), "utf8"),
    ) as { entityId: string };
    type WebExport = Parameters<typeof webExportSource>[0];
    const data = {
      createdAt: "",
      contacts: [],
      entries: new Map([[quotation.entityId, { list: quotation, files: [], details: {} }]]),
      files: new Map(),
      failures: new Map(),
    } as unknown as WebExport;
    expect(
      webExportSource(data)
        .ignoredVouchers?.()
        .map((e) => e.type),
    ).toEqual(["quotation"]);
  });
});
