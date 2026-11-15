import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import vorlagen from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/beleg-wiederkehrend-rv.json";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472: Vorlagen wiederkehrender Belege (RV) aus sevDesk kommen als Dauerbelege an, angehalten bis zur Prüfung, mit
 * abgelaufenem Ende beendet. Ohne Datei lassen sie sich nicht fortsetzen. Ein zweiter Abruf legt nichts doppelt an und
 * ändert nichts, was der Nutzer geändert hat; was sich nicht abbilden lässt, nennt der Fortschritt.
 */

type Vorlage = { voucher: Record<string, unknown>; positions: unknown[] };
const [ohneTermin, mitTermin, mitEnde] = vorlagen as unknown as Vorlage[];
const TOKEN = "0123456789abcdef0123456789abcdef";
const PDF = "%PDF-1.4\n% Mietvertrag\n";

describe.skipIf(!testDatabaseUrl)("sevDesk: Vorlagen wiederkehrender Belege als Dauerbelege (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let belege: typeof import("../belege/index.ts");
  let importPkg: typeof import("@haben/import");
  const calls: string[] = [];
  let rv: Vorlage[] = [];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const dauerbelege = async () =>
    (await sql`select sevdesk_id as "sevdeskId", status, name, supplier_contact_id as "contactId", next_date as "nextDate", end_date as "endDate",
      interval_months as "intervalMonths", category, amounts, filename from recurring_documents order by sevdesk_id`) as unknown as Record<string, unknown>[];

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    belege = await import("../belege/index.ts");
    importPkg = await import("@haben/import");
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR04', 'soll', 'einzelunternehmen')`;
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: (async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            const path = url.pathname.replace(/^\/api\/v1/, "");
            calls.push(`${path}${url.searchParams.get("voucherType") ? `?${url.searchParams.get("voucherType")}` : ""}`);
            const first = url.searchParams.get("offset") === "0";
            const list = (objects: unknown[]) => json({ objects: first ? objects : [] });
            switch (path) {
              case "/Tools/bookkeepingSystemVersion":
                return json({ objects: { version: "1.0" } });
              case "/Voucher":
                return list(url.searchParams.get("voucherType") === "RV" ? rv.map((r) => r.voucher) : []);
              case "/VoucherPos":
                return list(rv.find((r) => r.voucher.id === url.searchParams.get("voucher[id]"))?.positions ?? []);
              case "/Document/ID_5/download":
                return json({
                  objects: { base64Encoded: true, content: Buffer.from(PDF).toString("base64"), filename: "mietvertrag.pdf", mimetype: "application/pdf" },
                });
              case "/Contact":
                return list([{ id: "ID_9", objectName: "Contact", name: "Hausverwaltung Beispiel", category: { id: "2", objectName: "Category" } }]);
              case "/ContactAddress":
              case "/CommunicationWay":
              case "/Invoice":
              case "/CreditNote":
              case "/Order":
              case "/CheckAccount":
              case "/CheckAccountTransactionLog":
                return list([]);
            }
            return json({ error: { message: `unbekannt ${path}` } }, 404);
          }) as typeof fetch,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("übernimmt die Vorlagen angehalten, mit abgelaufenem Ende beendet, und nennt nicht Abbildbares", async () => {
    rv = [
      ohneTermin!,
      {
        ...mitTermin!,
        voucher: {
          ...mitTermin!.voucher,
          supplier: { id: "ID_9", objectName: "Contact" },
          supplierName: "Hausverwaltung Beispiel",
          document: { id: "ID_5", objectName: "Document" },
          recurringNextVoucher: "2026-12-01T00:00:00+01:00",
        },
      },
      mitEnde!,
      { ...mitTermin!, voucher: { ...mitTermin!.voucher, id: "ID_50", description: "WOCHE", recurringInterval: "P0Y0M1W" } },
    ];
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const latest = (await sevdesk.latestSevdeskImport())!;
    expect(latest.status).toBe("fertig");
    expect(latest.progress.recurring).toBe(3);
    expect(latest.progress.failed).toEqual([
      { lexofficeId: "recurring/ID_50", number: "WOCHE", message: expect.stringMatching(/^Nicht als Dauerbeleg übernommen: Intervall P0Y0M1W/) },
    ]);
    const [kontakt] = await sql`select id from contacts where sevdesk_id = 'ID_9'`;
    expect(await dauerbelege()).toEqual([
      expect.objectContaining({ sevdeskId: "ID_32", status: "pausiert", nextDate: "2024-01-15", filename: null, category: "sonstiges" }),
      expect.objectContaining({
        sevdeskId: "ID_37",
        status: "pausiert",
        name: "Hausverwaltung Beispiel",
        contactId: kontakt!.id,
        nextDate: "2026-12-01",
        intervalMonths: 1,
        amounts: [{ taxRate: 0, net: 10000, tax: 0 }],
        filename: "mietvertrag.pdf",
      }),
      expect.objectContaining({ sevdeskId: "ID_43", status: "beendet", endDate: "2024-01-15", intervalMonths: 3 }),
    ]);
    // keine Belege angelegt, auch nicht beim Lauf der Dauerbelege
    await belege.runDueDauerbelege("2027-06-01");
    expect(await sql`select id from documents`).toHaveLength(0);
  });

  it("legt beim zweiten Abruf nichts doppelt an und ändert keine geprüfte Vorlage", async () => {
    await sql`select set_config('haben.actor', 'test-user', false)`;
    await sql`update recurring_documents set name = 'Büromiete' where sevdesk_id = 'ID_37'`;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect((await sevdesk.latestSevdeskImport())!.progress.recurring ?? 0).toBe(0);
    expect(await dauerbelege()).toHaveLength(3);
    expect((await dauerbelege())[1]).toMatchObject({ name: "Büromiete" });
    // übernommene Vorlagen fragt der Abruf nicht erneut an
    expect(calls.filter((c) => c.startsWith("/VoucherPos") || c.startsWith("/Document"))).toEqual(["/VoucherPos"]);
  });

  it("zeigt die Hinweise und lässt eine Vorlage ohne Datei erst nach dem Hochladen fortsetzen", async () => {
    const [ohne] = await sql`select id from recurring_documents where sevdesk_id = 'ID_32'`;
    const detail = (await belege.getDauerbeleg(ohne!.id as string))!;
    expect(detail.sevdesk).toEqual({
      id: "ID_32",
      hinweise: expect.arrayContaining(["In sevDesk ohne Datei: Vor dem Fortsetzen den Vertrag oder die Dauerrechnung hochladen."]),
    });
    expect(detail.vorlage).not.toHaveProperty("sevdeskRaw");
    await expect(belege.setDauerbelegStatus("test-user", ohne!.id as string, "fortsetzen", "2026-11-15")).rejects.toThrow(
      "Lade zuerst den Vertrag oder die Dauerrechnung hoch.",
    );
    await expect(sql`update recurring_documents set status = 'aktiv' where id = ${ohne!.id as string}`).rejects.toThrow(/recurring_documents_active_file/);

    const [mit] = await sql`select id from recurring_documents where sevdesk_id = 'ID_37'`;
    const fortgesetzt = await belege.setDauerbelegStatus("test-user", mit!.id as string, "fortsetzen", "2026-11-15");
    expect(fortgesetzt).toMatchObject({ status: "aktiv", nextDate: "2026-12-01" });
    const lauf = await belege.runDueDauerbelege("2026-12-01");
    expect(lauf).toEqual({ created: 1, errors: [] });
    const [beleg] = await sql`select filename, gross, category from documents`;
    expect(beleg).toEqual({ filename: "mietvertrag.pdf", gross: 10000, category: "sonstiges" });
  });

  it("schreibt die Übernahme ins Änderungsprotokoll", async () => {
    const audit = await sql`select actor from audit_log where table_name = 'recurring_documents' and action = 'INSERT'`;
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.actor === "test-user")).toBe(true);
  });

  it("setzt eine Vorlage ohne Betrag nicht fort, auch wenn sie eine Datei hat", async () => {
    // Review #1130: Der Import umgeht die Prüfung des Formulars (dauerbelegProbleme); Fortsetzen darf daraus keine Belege über 0 € machen
    rv = [
      {
        voucher: {
          ...mitTermin!.voucher,
          id: "ID_60",
          sumNet: "0",
          sumGross: "0",
          document: { id: "ID_5", objectName: "Document" },
          recurringNextVoucher: "2026-12-01T00:00:00+01:00",
        },
        positions: [],
      },
    ];
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    const [ohneBetrag] = await sql`select id, filename from recurring_documents where sevdesk_id = 'ID_60'`;
    expect(ohneBetrag).toMatchObject({ filename: "mietvertrag.pdf" });
    expect((await belege.getDauerbeleg(ohneBetrag!.id as string))!.sevdesk!.hinweise).toContain("In sevDesk ohne Betrag.");
    await expect(belege.setDauerbelegStatus("test-user", ohneBetrag!.id as string, "fortsetzen", "2026-11-15")).rejects.toThrow("Beträge fehlen.");
  });
});
