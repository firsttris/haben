import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Abrechenbare Leistungen (#417), zweiter Teil: aus den offenen Einträgen eines Kunden und Zeitraums wird ein Rechnungsentwurf.
 * Eine Position je Stundensatz, der Zeitraum aus dem ersten und letzten Arbeitstag. Ein Eintrag lässt sich nicht zweimal
 * abrechnen, ist mit der festgeschriebenen Rechnung gesperrt und nach deren Storno wieder frei; eine Korrektur gibt ihn nicht frei.
 * Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Leistungen abrechnen (Postgres, #417)", () => {
  let sql: postgres.Sql;
  let entries: typeof import("./service-entries.ts");
  let abrechnen: typeof import("./abrechnen.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  const heute = "2026-04-01";
  let kunde: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    entries = await import("./service-entries.ts");
    abrechnen = await import("./abrechnen.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate service_entries, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    kunde = await neuerKunde("Nordwerk Software GmbH", 9500);
  });

  async function neuerKunde(name: string, rateCents: number | null) {
    const { id } = await contacts.createContact(actor, {
      kundennummer: "",
      name,
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    await sql`update contacts set hourly_rate_cents = ${rateCents} where id = ${id}`;
    return id;
  }

  const eintrag = (overrides: Record<string, unknown> = {}) =>
    entries.createServiceEntry(actor, { contactId: kunde, workedOn: "2026-03-02", minutes: 90, description: "Konzept Datenmodell", ...overrides });

  const zeitraum = { from: "2026-03-01", to: "2026-03-31" };
  const abrechnen_ = (contactId = kunde) => abrechnen.billServiceEntries(actor, { contactId, ...zeitraum }, heute);
  const zeilen = (invoiceId: string) =>
    sql`select description, detail, quantity, unit, unit_price, tax_rate, net from invoice_lines where invoice_id = ${invoiceId} order by position`;

  it("legt einen Entwurf an: eine Position, Menge die Summe der abrechenbaren Stunden, Leistungszeitraum erster bis letzter Tag", async () => {
    await eintrag({ workedOn: "2026-03-02", minutes: 90, project: "Relaunch Shop" });
    // abrechenbare Dauer geht vor der erfassten
    await eintrag({ workedOn: "2026-03-20", minutes: 120, billableMinutes: 90, project: "Relaunch Shop" });
    // nicht abrechenbar und außerhalb des Zeitraums: nie dabei
    await eintrag({ workedOn: "2026-03-10", minutes: 45, nonBillable: true });
    await eintrag({ workedOn: "2026-04-02", minutes: 60 });

    const { invoiceId, entries: count } = await abrechnen_();
    expect(count).toBe(2);
    const [invoice] =
      await sql`select status, contact_id, issue_date::text, service_from::text, service_to::text, net, tax, gross from invoices where id = ${invoiceId}`;
    expect(invoice).toMatchObject({ status: "draft", contact_id: kunde, issue_date: heute, service_from: "2026-03-02", service_to: "2026-03-20" });
    // 3 Std. zu 95,00 € = 285,00 € netto, 19 % USt
    expect(await zeilen(invoiceId)).toEqual([
      { description: "Leistungen", detail: "Projekt: Relaunch Shop", quantity: 3000, unit: "Std.", unit_price: 9500, tax_rate: 1900, net: 28_500 },
    ]);
    expect(invoice).toMatchObject({ net: 28_500, tax: 5_415, gross: 33_915 });

    const liste = await entries.listServiceEntries({});
    expect(liste.filter((e) => e.invoiceId === invoiceId).length).toBe(2);
    expect(liste.find((e) => e.workedOn === "2026-03-10")).toMatchObject({ invoiceId: null, nonBillable: true });
    expect(liste.find((e) => e.workedOn === "2026-04-02")!.invoiceId).toBeNull();
    expect(liste.find((e) => e.workedOn === "2026-03-02")).toMatchObject({ invoiceStatus: "draft", invoiceNumber: null });
    expect((await abrechnen.serviceEntriesOfInvoice(invoiceId)).map((e) => e.workedOn)).toEqual(["2026-03-02", "2026-03-20"]);
  });

  it("eine Position je Stundensatz; die Menge wird einmal gerundet, nicht je Eintrag", async () => {
    await eintrag({ minutes: 50 });
    await eintrag({ minutes: 50, workedOn: "2026-03-03" });
    await eintrag({ minutes: 60, workedOn: "2026-03-04", hourlyRateCents: 12_000 });
    const { invoiceId } = await abrechnen_();
    // 100 Minuten = 1,667 Std. zu 95,00 €; 60 Minuten = 1 Std. zu 120,00 €
    expect(await zeilen(invoiceId)).toMatchObject([
      { quantity: 1667, unit_price: 9500, net: 15_837 },
      { quantity: 1000, unit_price: 12_000, net: 12_000 },
    ]);
  });

  it("ein Eintrag lässt sich nicht zweimal abrechnen, auch nicht von zwei gleichzeitigen Aufrufen", async () => {
    await eintrag();
    await abrechnen_();
    await expect(abrechnen_()).rejects.toThrow(/keine offenen/);

    await leeren(sql)`truncate service_entries, invoice_lines, invoices cascade`;
    await eintrag();
    const ergebnisse = await Promise.allSettled([abrechnen_(), abrechnen_()]);
    expect(ergebnisse.filter((e) => e.status === "fulfilled").length).toBe(1);
    expect((await sql`select count(*)::int as n from invoices`)[0]!.n).toBe(1);
  });

  it("fehlt bei einem Eintrag der Stundensatz, wird nichts angelegt", async () => {
    const ohneSatz = await neuerKunde("Rheinpixel GmbH", null);
    await eintrag({ contactId: ohneSatz });
    await expect(abrechnen_(ohneSatz)).rejects.toThrow(/fehlt der Stundensatz/);
    expect((await sql`select count(*)::int as n from invoices`)[0]!.n).toBe(0);
    expect((await entries.listServiceEntries({}))[0]!.invoiceId).toBeNull();
  });

  it("ohne offene Einträge, für einen Lieferanten und mit falschem Zeitraum kein Entwurf", async () => {
    await expect(abrechnen_()).rejects.toThrow(/keine offenen/);
    await expect(abrechnen.billServiceEntries(actor, { contactId: kunde, from: "2026-03-31", to: "2026-03-01" }, heute)).rejects.toThrow(/endet vor/);
    const [lieferant] = await sql`insert into contacts (name, is_customer, is_supplier) values ('Papier AG', false, true) returning id`;
    await expect(abrechnen_(lieferant!.id)).rejects.toThrow();
  });

  it("auf einem Entwurf ist der Eintrag nicht änderbar und nicht löschbar; löscht man den Entwurf, ist er wieder frei", async () => {
    const id = await eintrag();
    const { invoiceId } = await abrechnen_();
    const neu = { contactId: kunde, workedOn: "2026-03-02", minutes: 30, description: "x" };
    await expect(entries.updateServiceEntry(actor, id, neu)).rejects.toThrow(/Rechnungsentwurf/);
    await expect(entries.deleteServiceEntry(actor, id)).rejects.toThrow(/Rechnungsentwurf/);

    await invoices.deleteDraft(actor, invoiceId);
    expect((await entries.getServiceEntry(id))!.invoiceId).toBeNull();
    await entries.updateServiceEntry(actor, id, neu);
    // und wieder abrechenbar
    expect((await abrechnen_()).entries).toBe(1);
  });

  it("von außen erneut gesendet: ein abgerechneter Eintrag bleibt, wie er ist, ohne Fehler", async () => {
    const { id } = await entries.upsertExternalServiceEntry(actor, {
      contactId: kunde,
      workedOn: "2026-03-02",
      minutes: 60,
      source: "kimai",
      externalId: "17",
    });
    await abrechnen_();
    const erneut = await entries.upsertExternalServiceEntry(actor, {
      contactId: kunde,
      workedOn: "2026-03-02",
      minutes: 120,
      source: "kimai",
      externalId: "17",
    });
    expect(erneut).toEqual({ id, created: false });
    expect((await entries.getServiceEntry(id))!.minutes).toBe(60);
  });

  describe("festgeschriebene Rechnung", () => {
    it("sperrt den Eintrag: Dienst und Datenbank lehnen Ändern und Löschen ab", async () => {
      const id = await eintrag();
      const { invoiceId } = await abrechnen_();
      const final = await invoices.finalizeInvoice(actor, invoiceId);
      expect(await entries.getServiceEntry(id)).toMatchObject({ invoiceId, invoiceNumber: final.number, invoiceStatus: "final" });

      await expect(entries.updateServiceEntry(actor, id, { contactId: kunde, workedOn: "2026-03-02", minutes: 30, description: "x" })).rejects.toThrow(
        new RegExp(`Rechnung ${final.number}`),
      );
      await expect(entries.deleteServiceEntry(actor, id)).rejects.toThrow(/abgerechnet/);
      // die Datenbank sperrt auch ohne den Dienst, jedes der geschützten Felder
      await expect(sql`update service_entries set minutes = 30 where id = ${id}`).rejects.toThrow(/unveränderlich/);
      await expect(sql`update service_entries set hourly_rate_cents = 1 where id = ${id}`).rejects.toThrow(/unveränderlich/);
      await expect(sql`update service_entries set description = 'x' where id = ${id}`).rejects.toThrow(/unveränderlich/);
      await expect(sql`update service_entries set invoice_id = null where id = ${id}`).rejects.toThrow(/unveränderlich/);
      await expect(sql`delete from service_entries where id = ${id}`).rejects.toThrow(/nicht löschen/);
    });

    it("nach dem Storno ist der Eintrag wieder offen, änderbar und lässt sich neu abrechnen", async () => {
      const id = await eintrag();
      const { invoiceId } = await abrechnen_();
      await invoices.finalizeInvoice(actor, invoiceId);
      await invoices.cancelInvoice(actor, invoiceId, heute);

      expect(await entries.getServiceEntry(id)).toMatchObject({ invoiceId: null, invoiceNumber: null, invoiceStatus: null });
      expect((await entries.listServiceEntries({ status: "offen" })).map((e) => e.id)).toEqual([id]);
      await entries.updateServiceEntry(actor, id, { contactId: kunde, workedOn: "2026-03-02", minutes: 60, description: "korrigiert" });

      const zweite = await abrechnen_();
      expect(zweite.invoiceId).not.toBe(invoiceId);
      expect((await entries.getServiceEntry(id))!.invoiceId).toBe(zweite.invoiceId);
    });

    it("eine Korrektur gibt den Eintrag nicht frei", async () => {
      const id = await eintrag();
      const { invoiceId } = await abrechnen_();
      await invoices.finalizeInvoice(actor, invoiceId);
      await invoices.createCorrection(actor, invoiceId, heute);
      expect((await entries.getServiceEntry(id))!.invoiceId).toBe(invoiceId);
      await expect(abrechnen_()).rejects.toThrow(/keine offenen/);
    });
  });

  it("Filter nach Stand: offen, abgerechnet, nicht abrechenbar", async () => {
    const offen = await eintrag({ workedOn: "2026-02-10" });
    const nicht = await eintrag({ workedOn: "2026-02-11", nonBillable: true });
    const abgerechnet = await eintrag({ workedOn: "2026-03-05" });
    await abrechnen_();
    const ids = async (status: "offen" | "abgerechnet" | "nicht-abrechenbar") => (await entries.listServiceEntries({ status })).map((e) => e.id);
    expect(await ids("offen")).toEqual([offen]);
    expect(await ids("abgerechnet")).toEqual([abgerechnet]);
    expect(await ids("nicht-abrechenbar")).toEqual([nicht]);
  });

  it("die Vorschau legt nichts an und zählt Einträge ohne Satz", async () => {
    await eintrag();
    const ohneSatz = await neuerKunde("Rheinpixel GmbH", null);
    await eintrag({ contactId: ohneSatz });
    expect(await abrechnen.previewBilling({ contactId: kunde, ...zeitraum })).toMatchObject({
      entries: 1,
      minutes: 90,
      net: 14_250,
      withoutRate: 0,
      from: "2026-03-02",
      to: "2026-03-02",
    });
    expect(await abrechnen.previewBilling({ contactId: ohneSatz, ...zeitraum })).toMatchObject({ entries: 0, withoutRate: 1 });
    expect((await sql`select count(*)::int as n from invoices`)[0]!.n).toBe(0);
  });
});
