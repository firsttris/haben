import { gzipSync, strToU8, zipSync } from "fflate";
import { generateKeyPairSync } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppStoreClient, GooglePlayClient } from "@haben/import";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Rechnungsentwurf je Monatsabrechnung an die Store-Gesellschaft: Reverse Charge an eine Gesellschaft in Irland, nach
 * Festschreiben und Zuordnung in Kz 21 und der Zusammenfassenden Meldung. Je Kontenrahmen und Versteuerungsart.
 */

const p8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const serviceAccountJson = JSON.stringify({ type: "service_account", client_email: "haben@projekt.iam.gserviceaccount.com", private_key: rsa });

const googleReport = zipSync({
  "earnings_202609.csv": strToU8(
    [
      "Transaction Date,Transaction Type,Merchant Currency,Amount (Merchant Currency)",
      '"Sep 3, 2026",Charge,EUR,100.00',
      '"Sep 3, 2026",Google fee,EUR,-15.00',
    ].join("\n"),
  ),
});
const appleReport = gzipSync(
  strToU8(
    [
      "Vendor Name\tStart Date\tEnd Date\tExtended Partner Share\tPartner Share Currency\tSale or Return",
      "Muster\t09/28/2026\t11/01/2026\t7.00\tEUR\tS",
      "Muster\t09/28/2026\t11/01/2026\t10.81\tUSD\tS",
    ].join("\n"),
  ),
);

const google = new Map([["earnings/earnings_202609.zip", googleReport]]);
const googleClient: GooglePlayClient = {
  listEarnings: async () => [...google.keys()].map((name) => ({ name, month: "2026-09", size: 1 })),
  download: async (name) => google.get(name)!,
};
const appleClient: AppStoreClient = { financeDetail: async (month) => (month === "2026-10" ? appleReport : null) };

const CASES = [
  { kontenrahmen: "SKR03", versteuerung: "ist" },
  { kontenrahmen: "SKR04", versteuerung: "soll" },
] as const;

describe.skipIf(!testDatabaseUrl).each(CASES)("Rechnungsentwürfe an die Store-Gesellschaft ($kontenrahmen, $versteuerung, Postgres)", (c) => {
  let stores: typeof import("./index.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const NOW = new Date("2026-11-10T10:00:00Z");
  let googleContact = "";

  beforeAll(async () => {
    sql = await setupTestDb();
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${c.versteuerung}, ${c.kontenrahmen})`;
    stores = await import("./index.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    const stammdaten = await import("../stammdaten/index.ts");
    stores.setStoreClientFactories({ googleplay: () => googleClient, appstore: () => appleClient });
    const contact = (name: string) =>
      stammdaten.createContact(actor, {
        kundennummer: "",
        name,
        strasse: "Gordon House, Barrow Street",
        plz: "D04",
        ort: "Dublin",
        land: "IE",
        email: "",
        ustId: "IE9825613N",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      });
    googleContact = (await contact("Google Commerce Ltd")).id;
    await bank.createProviderAccount(actor, { name: "Google Play", provider: "googleplay" });
    await bank.createProviderAccount(actor, { name: "App Store", provider: "appstore" });
    await sql`insert into exchange_rates (currency, month, rate, source) values ('USD', '2026-10', 1.0810, 'manuell')`;
    await stores.saveStoreConnection(actor, { store: "googleplay", bucket: "pubsite_prod_rev_1", serviceAccountJson, fetchFrom: "2026-09" });
    await stores.saveStoreConnection(actor, {
      store: "appstore",
      issuerId: "57246542-96fe-1a63-e053-0824d011072a",
      keyId: "2X9R4HXF34",
      vendorNumber: "85012345",
      privateKey: p8,
      fetchFrom: "2026-10",
    });
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("legt ohne gewählten Kontakt keinen Entwurf an und sagt es", async () => {
    const result = await stores.syncStore(actor, "appstore", NOW);
    expect(result.imported).toMatchObject({ added: 2, drafts: 0 });
    expect(result.imported.messages).toEqual([expect.stringContaining("Wähle unter Einstellungen › Bank den Kontakt der Store-Gesellschaft")]);
  });

  it("lehnt einen Kontakt in Deutschland ab", async () => {
    const [de] = await sql`insert into contacts (name, land) values ('Inland GmbH', 'DE') returning id`;
    await expect(stores.setStoreContact(actor, { store: "googleplay", contactId: de!.id })).rejects.toThrow(/im Ausland/);
  });

  it("lehnt einen Kontakt ohne die Rolle Kunde ab", async () => {
    const [lieferant] = await sql`insert into contacts (name, land, is_customer, is_supplier) values ('Hosting Irland Ltd', 'IE', false, true) returning id`;
    await expect(stores.setStoreContact(actor, { store: "googleplay", contactId: lieferant!.id })).rejects.toThrow(/Hosting Irland Ltd“ ist kein Kunde/);
  });

  it("legt beim Übernehmen je Monat einen Reverse-Charge-Entwurf an, nur einmal", async () => {
    await stores.setStoreContact(actor, { store: "googleplay", contactId: googleContact });
    const result = await stores.syncStore(actor, "googleplay", NOW);
    expect(result.imported).toMatchObject({ added: 1, drafts: 1, messages: [] });

    const [draft] = await sql`select * from invoices where external_source = 'googleplay'`;
    expect(draft).toMatchObject({
      status: "draft",
      external_id: "googleplay-earnings-2026-09",
      contact_id: googleContact,
      tax_treatment: "reverse_charge",
      currency: "EUR",
      language: "en",
    });
    expect(String(draft!.service_from)).toContain("2026-09-01");
    expect(String(draft!.service_to)).toContain("2026-09-30");
    const lines = await sql`select description, quantity, unit_price, tax_rate from invoice_lines where invoice_id = ${draft!.id}`;
    expect(lines).toEqual([
      {
        description: "Apps and in-app products distributed via Google Play, earnings 09/2026 (net of Google service fee)",
        quantity: 1000,
        unit_price: 8500,
        tax_rate: 0,
      },
    ]);

    // Wiederholt: kein zweiter Entwurf, auch über „für alle Monate“
    expect((await stores.syncStore(actor, "googleplay", NOW)).imported.drafts).toBe(0);
    expect(await stores.createAllStoreDrafts(actor, "googleplay")).toEqual({ created: 0, messages: [] });
  });

  it("legt für ältere Monate auf Wunsch Entwürfe an, Fremdwährung mit dem Kurs des Umsatzes", async () => {
    await stores.setStoreContact(actor, { store: "appstore", contactId: googleContact });
    expect((await stores.createAllStoreDrafts(actor, "appstore")).created).toBe(2);
    const drafts = await sql`select external_id, currency, exchange_rate::text as rate from invoices where external_source = 'appstore' order by external_id`;
    expect(drafts).toEqual([
      { external_id: "appstore-finance-2026-10-EUR", currency: "EUR", rate: null },
      { external_id: "appstore-finance-2026-10-USD", currency: "USD", rate: "1.081000" },
    ]);
  });

  it("nach Festschreiben und Zuordnung: Kz 21 und Zusammenfassende Meldung, Store-Umsatz erledigt", async () => {
    const [draft] = await sql`select id from invoices where external_source = 'googleplay'`;
    const final = await invoices.finalizeInvoice(actor, draft!.id);
    const [revenue] = await sql`select id from bank_transactions where bank_reference = 'googleplay-earnings-2026-09'`;
    await bank.allocate(actor, { kind: "invoice", transactionId: revenue!.id, invoiceId: final.id, amount: 8500 });

    const month = Number(final.issueDate.slice(5, 7));
    const year = Number(final.issueDate.slice(0, 4));
    expect((await vat.computeVatFigures({ year, month })).kz21).toBe(8500);
    const zm = await vat.zmOverview({ year, month: 40 + Math.ceil(month / 3) });
    expect(zm.zeilen).toEqual([expect.objectContaining({ ustId: "IE9825613N", betrag: 8500 })]);
    const [open] = await sql`select amount - coalesce((select sum(amount) from allocations a where a.transaction_id = t.id), 0) as open
      from bank_transactions t where t.id = ${revenue!.id}`;
    expect(Number(open!.open)).toBe(0);
  });
});
