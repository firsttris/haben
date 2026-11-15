import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/${name}`, import.meta.url), "utf8"));

type Template = {
  invoice: Record<string, unknown> & { id: string };
  positions: unknown[];
};

describe.skipIf(!testDatabaseUrl)("sevDesk-Vorlagen wiederkehrender Rechnungen (Postgres)", () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let rechnungen: typeof import("../rechnungen/index.ts");
  const calls: string[] = [];
  const fixtures = fixture("rechnungsvorlage-wkr.json") as Template[];
  // ID_26 rechnet laut den erzeugten Rechnungen nachfällig ab; der nächste Termin liegt hier am Monatsende
  const templates: Template[] = [
    ...fixtures.map((t) =>
      t.invoice.id === "ID_26"
        ? {
            ...t,
            invoice: {
              ...t.invoice,
              accountNextInvoice: "2026-11-30T12:00:00+01:00",
            },
          }
        : t,
    ),
    // beendet: Enddatum vor dem nächsten Termin
    {
      invoice: {
        ...fixtures[1]!.invoice,
        id: "ID_40",
        status: "1000",
        accountEndDate: "2023-12-31T00:00:00+01:00",
        header: "Beendet",
      },
      positions: fixtures[1]!.positions,
    },
  ];
  const generated = (fixture("rechnungen-aus-vorlage.json") as Record<string, unknown>[]).map((r, i) => ({
    ...r,
    id: `G${i + 1}`,
    invoiceNumber: `RE-${i + 1}`,
    contact: { id: "ID_27", objectName: "Contact" },
    currency: "EUR",
    sumNet: "100",
    sumTax: "19",
    sumGross: "119",
    paidAmount: r.status === "1000" ? 119 : 0,
    payDate: r.status === "1000" ? r.invoiceDate : null,
  }));
  const contacts = ["ID_16", "ID_21", "ID_27"].map((id) => ({
    id,
    objectName: "Contact",
    name: `Kunde ${id}`,
    category: { id: "3" },
  }));

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban)
      values (1, 'Test', 'Straße 1', '93047', 'Regensburg', 'test@example.com', '', '198/113/10010', 'DE123456789', 'BY', '')`;
    sevdesk = await import("./sevdesk.ts");
    rechnungen = await import("../rechnungen/index.ts");
    const { SevdeskClient } = await import("@haben/import");
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname.replace("/api/v1", "");
      calls.push(`${path}${url.searchParams.get("invoiceType") ? `?invoiceType=${url.searchParams.get("invoiceType")}` : ""}`);
      const first = url.searchParams.get("offset") === "0";
      if (path.endsWith("/getPdf") || path.endsWith("/getXml")) return new Response("{}", { status: 404 });
      const template = templates.find((t) => path === `/Invoice/${t.invoice.id}/getPositions`);
      const objects =
        path === "/Tools/bookkeepingSystemVersion"
          ? { version: "1.0" }
          : path === "/Contact"
            ? first
              ? contacts
              : []
            : path === "/Invoice"
              ? !first
                ? []
                : url.searchParams.get("invoiceType") === "WKR"
                  ? templates.map((t) => t.invoice)
                  : generated
              : template
                ? template.positions
                : [];
      return new Response(JSON.stringify({ objects }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    sevdesk.setSevdeskClientFactory(
      (options) =>
        new SevdeskClient({
          ...options,
          fetch: fetchFn,
          minIntervalMs: 0,
          maxRetries: 0,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", "0123456789abcdef0123456789abcdef");
    await sevdesk.startSevdeskImport("test-user", { wait: true });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("ruft die Vorlagen mit dem Filter WKR ab und übernimmt sie pausiert als Entwurf", async () => {
    expect(calls).toContain("/Invoice?invoiceType=WKR");
    const rows = await sql`
      select s.sevdesk_id, s.status, s.billing, s.billing_evidence, r.active, r.mode, r.send_by_mail, r.interval_months, r.anchor_day,
        r.next_date, r.end_date, r.service_period, r.price_mode, r.note, c.name as contact
      from sevdesk_recurring_templates s join recurring_invoices r on r.id = s.recurring_id join contacts c on c.id = r.contact_id
      order by s.sevdesk_id`;
    expect(rows.map((r) => r.sevdesk_id)).toEqual(["ID_20", "ID_26", "ID_40"]);
    for (const r of rows)
      expect(r).toMatchObject({
        active: false,
        mode: "entwurf",
        send_by_mail: false,
        interval_months: 1,
      });
    expect(rows[0]).toMatchObject({
      status: "100",
      billing: "vorschuessig",
      billing_evidence: 1,
      service_period: "laufend",
      contact: "Kunde ID_21",
    });
    expect(rows[1]).toMatchObject({
      billing: "nachfaellig",
      billing_evidence: 2,
      next_date: "2026-11-30",
      anchor_day: 31,
      service_period: "laufend",
      note: "<anon> [%ZAHLUNGSZIEL%] [%KONTAKTPERSON%]",
    });
    expect(rows[2]).toMatchObject({
      status: "1000",
      end_date: "2023-12-31",
      next_date: "2024-01-15",
      billing: "unklar",
      service_period: "keiner",
    });
  });

  it("nennt die Wochenvorlage als offenen Punkt und listet die Platzhalter", async () => {
    const [run] = await sql`select progress from lexoffice_imports where source = 'sevdesk' order by started_at desc limit 1`;
    expect(run!.progress.failed).toEqual([
      {
        lexofficeId: "wkr/ID_15",
        number: "<anon> [%Rechnungsnummer%]",
        message: expect.stringContaining("P0Y0M1W"),
      },
    ]);
    expect(run!.progress.sevdeskRecurring).toEqual({
      imported: 3,
      known: 0,
      placeholders: ["[%KONTAKTPERSON%]", "[%Rechnungsnummer%]", "[%ZAHLUNGSZIEL%]"],
    });
  });

  it("erzeugt aus übernommenen Vorlagen keine Rechnung, solange sie pausiert sind", async () => {
    const result = await rechnungen.runDueRecurring("2030-01-01");
    expect(result.created).toBe(0);
    expect(Number((await sql`select count(*) as n from invoices`)[0]!.n)).toBe(0);
  });

  it("protokolliert die Übernahme im Audit-Log", async () => {
    const audit = await sql`select count(*) as n from audit_log where table_name = 'sevdesk_recurring_templates'`;
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(3);
  });

  it("übernimmt beim erneuten Abruf nichts doppelt, auch nicht nach dem Löschen in Haben", async () => {
    const [ended] = await sql`select recurring_id from sevdesk_recurring_templates where sevdesk_id = 'ID_40'`;
    await rechnungen.deleteRecurring("test-user", ended!.recurring_id);
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    expect(Number((await sql`select count(*) as n from recurring_invoices`)[0]!.n)).toBe(2);
    const links = await sql`select sevdesk_id, recurring_id from sevdesk_recurring_templates order by sevdesk_id`;
    expect(links.map((l) => [l.sevdesk_id, l.recurring_id === null])).toEqual([
      ["ID_20", false],
      ["ID_26", false],
      ["ID_40", true],
    ]);
    const [run] = await sql`select progress from lexoffice_imports where source = 'sevdesk' order by started_at desc limit 1`;
    expect(run!.progress.sevdeskRecurring).toMatchObject({
      imported: 0,
      known: 3,
    });
  });
});
