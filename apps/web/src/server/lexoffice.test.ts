import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../../../packages/import/test-fixtures/lexoffice/${name}`, import.meta.url), "utf8"));

const INVOICE = fixture("invoice-two-rates.json");
const CREDIT_NOTE = fixture("creditnote.json");
const VOUCHER = fixture("voucher-gross.json");
const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung RE1019\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page(content: unknown[]) {
  return { content, first: true, last: true, totalPages: 1, totalElements: content.length, number: 0, size: 250, numberOfElements: content.length };
}

function listItem(id: string, voucherType: string, voucherStatus: string, voucherNumber: string) {
  return {
    id,
    voucherType,
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
  };
}

/** Nachgebaute Lexware-API mit einer Rechnung, einer Gutschrift, einem Ausgabebeleg und einem Entwurf */
function fakeApi(options: { failVoucher?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push(path);
    if (new Headers(init?.headers).get("authorization") !== "Bearer schluessel-1234567890-abcdefghij") return json({ message: "Unauthorized" }, 401);
    if (path === "/profile") return json(fixture("profile.json"));
    if (path === "/posting-categories") {
      return json([
        { id: "16d04a28-b1d0-11e6-b4e8-8f6d5b2f9e0a", name: "Bürobedarf", type: "outgo", contactRequired: false, splitAllowed: true, groupName: "Büro" },
      ]);
    }
    if (path === "/contacts") return json(page(url.searchParams.get("page") === "0" ? [fixture("contact-company.json"), fixture("contact-person.json")] : []));
    if (path === "/voucherlist") {
      if (url.searchParams.get("archived") === "true") return json(page([]));
      return json(
        page([
          listItem(String(INVOICE.id), "invoice", "paid", "RE1019"),
          listItem(String(CREDIT_NOTE.id), "creditnote", "open", "GS0007"),
          listItem(String(VOUCHER.id), "purchaseinvoice", "paid", "2023-4711"),
          listItem("00000000-0000-4000-8000-000000000001", "invoice", "draft", ""),
        ]),
      );
    }
    if (path === `/invoices/${INVOICE.id}`) return json(INVOICE);
    if (path === `/credit-notes/${CREDIT_NOTE.id}`) return json(CREDIT_NOTE);
    if (path.endsWith("/file") && accept.includes("xml")) return new Response("", { status: 406 });
    if (path === `/invoices/${INVOICE.id}/file` || path === `/credit-notes/${CREDIT_NOTE.id}/file`) {
      return new Response(PDF, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="RE1019.pdf"' } });
    }
    if (path === `/vouchers/${VOUCHER.id}`) return options.failVoucher ? json({ message: "kaputt" }, 500) : json(VOUCHER);
    if (path.startsWith("/files/")) {
      return new Response(JPEG, { headers: { "content-type": "image/jpeg", "content-disposition": "attachment; filename*=UTF-8''Quittung%20B%C3%BCro.jpg" } });
    }
    if (path === `/payments/${INVOICE.id}`) return json(fixture("payments.json"));
    if (path.startsWith("/payments/")) return json({ message: "not found" }, 404);
    return json({ message: `unbekannt ${path}` }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe.skipIf(!testDatabaseUrl)("Lexoffice-Übernahme (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let archive: typeof import("./archive.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";
  const key = "schluessel-1234567890-abcdefghij";

  function useApi(options: { failVoucher?: boolean } = {}) {
    const api = fakeApi(options);
    lexoffice.setLexofficeClientFactory(
      (o) => new importPkg.LexofficeClient({ ...o, fetch: api.fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    return api;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    archive = await import("./archive.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lehnt einen falschen Schlüssel ab und speichert den richtigen verschlüsselt", async () => {
    useApi();
    await expect(lexoffice.saveApiKey(actor, "falsch-falsch-falsch-falsch")).rejects.toThrow(/lehnt den Schlüssel ab: API-Schlüssel ungültig/);
    expect(await lexoffice.saveApiKey(actor, key)).toEqual({ organizationName: "Testfirma Teufel" });
    const [row] = await sql`select ciphertext from lexoffice_connection`;
    expect(Buffer.from(row!.ciphertext as Uint8Array).includes(Buffer.from(key))).toBe(false);
    expect((await lexoffice.connectionStatus())?.organizationName).toBe("Testfirma Teufel");
  });

  it("übernimmt Kontakte, Rechnungen, Gutschriften und Belege mit Dateien; ein Fehler hält den Lauf nicht auf", async () => {
    await sql`insert into contacts (name) values ('Berliner Kindl GmbH')`;
    useApi({ failVoucher: true });
    const id = await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run).toMatchObject({ id, status: "fertig" });
    expect(run!.progress).toMatchObject({ contacts: 1, contactsLinked: 1, listed: 3, imported: 2, files: 2 });
    expect(run!.progress.failed).toEqual([expect.objectContaining({ number: "2023-4711", message: expect.stringContaining("500") })]);

    const contacts = await sql`select name, lexoffice_id from contacts order by name`;
    expect(contacts.every((c) => c.lexoffice_id)).toBe(true);

    const vouchers = await sql`select number, type, direction, net, tax, gross, contact_id, payment from lexoffice_vouchers order by number`;
    expect(vouchers.map((v) => [v.number, v.direction, v.gross])).toEqual([
      ["GS0007", "einnahme", -11900],
      ["RE1019", "einnahme", 117250],
    ]);
    expect(vouchers.every((v) => v.contact_id)).toBe(true);
    expect(vouchers[1]!.payment).toMatchObject({ status: "balanced", items: [{ amount: 100000 }, { amount: 17250 }] });
    const [file] = await sql`select filename, mime_type, role from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id where v.number = 'RE1019'`;
    expect(file).toMatchObject({ filename: "RE1019.pdf", mime_type: "application/pdf", role: "pdf" });
  });

  it("setzt beim nächsten Abruf fort und überspringt Übernommenes", async () => {
    const api = useApi();
    await lexoffice.startImport(actor, { wait: true });
    const run = await lexoffice.latestImport();
    expect(run!.progress).toMatchObject({ imported: 1, skipped: 2, contacts: 0, failed: [] });
    expect(api.calls.filter((c) => c.startsWith("/invoices/"))).toEqual([]);
    const [voucher] = await sql`select categories, taxes from lexoffice_vouchers where number = '2023-4711'`;
    expect(voucher!.categories[0]).toMatchObject({ name: "Bürobedarf", rate: 1900 });
    const [attachment] = await sql`select filename, mime_type from lexoffice_voucher_files where role = 'anhang'`;
    expect(attachment).toMatchObject({ filename: "Quittung Büro.jpg", mime_type: "image/jpeg" });
  });

  it("hält die Übernahme unveränderlich", async () => {
    await expect(sql`update lexoffice_vouchers set gross = 0`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`delete from lexoffice_voucher_files`).rejects.toThrow(/darf nur ergänzt werden/);
  });

  it("archiviert einen DATEV-Stapel, verknüpft Belegnummern und lehnt Doppeltes ab", async () => {
    const header = `"EXTF";700;21;"Buchungsstapel";13;20240102120000000;;"LO";"";"";1001;12345;20230101;4;20230101;20231231;"Lexoffice Export";"";1;0;0;"EUR";;"";;;"03";;;"";""`;
    const columns = `Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext`;
    const rows = [
      `1172,50;"S";"EUR";;;;1200;8400;"";2802;"RE1019";"";;"Zahlung RE1019"`,
      `129,70;"H";"EUR";;;;1200;4930;"9";3107;"2023-4711";"";;"Bürobedarf"`,
      `50,00;"S";"EUR";;;;1800;1200;"";1508;"";"";;"Privatentnahme"`,
      `80,00;"H";"EUR";;;;1200;4900;"9";1608;"X-404";"";;"Unbekannt"`,
    ];
    const bytes = new TextEncoder().encode([header, columns, ...rows].join("\r\n"));
    const result = await archive.addArchiveFile(actor, { bytes, filename: "DATEV_2023.csv", kind: "sonstiges", year: null });
    expect(result.bookings).toBe(4);
    const [file] = await sql`select kind, year, meta->>'dateFrom' as from, meta->>'dateTo' as to from archive_files`;
    expect(file).toMatchObject({ kind: "datev", year: 2023, from: "2023-02-28", to: "2023-08-16" });

    await expect(archive.addArchiveFile(actor, { bytes, filename: "nochmal.csv", kind: "datev", year: null })).rejects.toThrow(/liegt schon im Archiv/);
    const overlapping = new TextEncoder().encode([header, columns, rows[0]!.replace("Zahlung", "Andere Zahlung")].join("\r\n"));
    await expect(archive.addArchiveFile(actor, { bytes: overlapping, filename: "teil.csv", kind: "datev", year: null })).rejects.toThrow(/überschneidet sich/);

    const unmatched = await archive.listDatevBookings({ year: 2023, search: "", unmatched: true, page: 0 });
    expect(unmatched.rows.map((r) => r.voucherField1)).toEqual(["", "X-404"]);
    const totals = await archive.accountTotals(2023);
    expect(totals.find((t) => t.account === "1200")).toEqual({ account: "1200", debit: 117_250, credit: 12_970 + 5_000 + 8_000 });
  });

  it("zeigt den Abgleich je Jahr mit offenen Punkten", async () => {
    await archive.addArchiveFile(actor, { bytes: new TextEncoder().encode("IDEA"), filename: "idea-2023.zip", kind: "idea", year: 2023 });
    const { years, versteuerung } = await lexoffice.reconciliation();
    const year = years.find((y) => y.year === 2023)!;
    expect(versteuerung).toBe("ist");
    expect(year.einnahmen).toMatchObject({ count: 2, gross: 117_250 - 11_900 });
    expect(year.bookings).toEqual({ total: 4, unmatched: 1, withoutNumber: 1 });
    const open = year.checks.filter((c) => !c.ok).map((c) => c.label);
    expect(open).toEqual(["Jede Buchung mit Belegnummer findet ihren Beleg", "ELSTER-Protokolle archiviert", "Kontoauszüge archiviert"]);
    expect(year.ready).toBe(false);
    expect(year.lastInvoiceNumber).toBe("RE1019");
    // Ist: Zahlungen der Rechnung im Februar und März 2023
    expect(year.vat.map((m) => m.month)).toEqual(["2023-02", "2023-03", "2023-07"]);
  });

  it("legt den Altbestand ins Jahresarchiv", async () => {
    const { exportYear } = await import("./export.ts");
    const { unzipSync } = await import("fflate");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportYear(2023, new Date("2026-10-02T10:00:00Z"))) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const names = Object.keys(files).filter((n) => n.startsWith("lexoffice/")).sort();
    expect(names).toEqual([
      "lexoffice/belege.csv",
      expect.stringMatching(/^lexoffice\/belege\/2023-02-21_RE1019_[0-9a-f]{8}\.pdf$/),
      expect.stringMatching(/^lexoffice\/belege\/2023-06-17_GS0007_[0-9a-f]{8}\.pdf$/),
      expect.stringMatching(/^lexoffice\/belege\/2023-07-31_2023-4711_[0-9a-f]{8}\.jpg$/),
      "lexoffice/datev-buchungen.csv",
      "lexoffice/originale/datev/DATEV_2023.csv",
      "lexoffice/originale/idea/idea-2023.zip",
    ]);
    expect(new TextDecoder().decode(files["lexoffice/belege.csv"]!)).toContain("RE1019");
    expect(new TextDecoder().decode(files["pruefsummen.sha256"]!)).toContain("lexoffice/datev-buchungen.csv");
  });
});
