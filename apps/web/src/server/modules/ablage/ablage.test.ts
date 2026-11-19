import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { empfaengerStarten, type Empfaenger } from "./test-empfaenger.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/**
 * Ablage festgeschriebener Rechnungen im Archiv gegen zwei nachgebaute Empfänger mit verschiedenen Feldnamen und
 * Kopfzeilen: einer antwortet mit dem neuen Dokument als JSON samt id, der andere nur mit einer Kennung als Text, wie
 * ein Archiv, das Dokumente erst später verarbeitet.
 */
describe.skipIf(!testDatabaseUrl)("Ablage im Archiv (Postgres)", () => {
  let ablage: typeof import("./index.ts");
  let lauf: typeof import("./lauf.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let mitId: Empfaenger;
  let ohneId: Empfaenger;
  let umleitung: Empfaenger;
  const actor = "test-user";
  let contactId: string;

  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  const zielMitId = () => ({
    url: mitId.url,
    fileField: "datei",
    headerName: "Authorization",
    headerValue: "Bearer archiv_geheim_1",
    fields: [],
    file: "original" as const,
    linkTemplate: "https://archiv.example/dokumente/{id}",
    enabled: true,
  });

  const zielOhneId = () => ({
    url: ohneId.url,
    fileField: "document",
    headerName: "Authorization",
    headerValue: "Token archiv_geheim_2",
    fields: [{ name: "title", value: "{art} {nummer} · {kunde}" }],
    file: "pdf" as const,
    linkTemplate: "",
    enabled: true,
  });

  const festschreiben = async (format: "zugferd" | "xrechnung-cii" = "zugferd") => {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-10-02",
      serviceFrom: "2026-09-01",
      serviceTo: "2026-09-30",
      paymentTermDays: 14,
      format,
      note: "",
      lines: [{ description: "Beratung", quantity: 2000, unit: "Std." as const, unitPrice: 9500, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  };

  const zeile = async (invoiceId: string) => (await sql`select * from archive_deliveries where invoice_id = ${invoiceId}`)[0];

  beforeAll(async () => {
    sql = await setupTestDb();
    ablage = await import("./index.ts");
    lauf = await import("./lauf.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    mitId = await empfaengerStarten({ status: 201, body: { id: "0b5e3c1a-7d2f-4e8a-9b61-2f4d8c0a1e77", sha256: "egal" } });
    ohneId = await empfaengerStarten({ status: 200, body: "c4a1f0d2-task" });
    umleitung = await empfaengerStarten({ status: 302, headers: { location: mitId.url } });
  }, 30_000);

  afterAll(async () => {
    await Promise.all([mitId?.close(), ohneId?.close(), umleitung?.close()]);
    await sql?.end();
  });

  beforeEach(async () => {
    mitId.received.length = 0;
    ohneId.received.length = 0;
    umleitung.received.length = 0;
    mitId.queue.length = 0;
    await leeren(sql)`truncate archive_deliveries, archive_target, seals, audit_log, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 14)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "einkauf@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  it("legt den Wert der Kopfzeile nur verschlüsselt ab, nicht im Änderungsprotokoll und nicht in der Übersicht", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const [row] = await sql`select header_name, ciphertext, fields from archive_target`;
    expect(row!.header_name).toBe("Authorization");
    expect(Buffer.from(row!.ciphertext).toString("latin1")).not.toContain("archiv_geheim_1");
    const audit = await sql`select coalesce(new_value, old_value)::text as data from audit_log where table_name = 'archive_target'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).not.toContain("archiv_geheim_1");
    expect(audit[0]!.data).not.toContain("ciphertext");
    const summary = await ablage.archiveTargetSummary();
    expect(JSON.stringify(summary)).not.toContain("archiv_geheim_1");
    expect(summary.target).toMatchObject({ headerName: "Authorization", headerSet: true });

    // Leer gelassen: der gespeicherte Wert bleibt
    await ablage.saveArchiveTarget(actor, { ...zielMitId(), headerValue: "" });
    await festschreiben();
    await ablage.deliverInvoices(actor);
    expect(mitId.received[0]!.headers.authorization).toBe("Bearer archiv_geheim_1");
  });

  it("schickt die festgeschriebene Rechnung einmal, mit Feldname, Kopfzeile und Link aus der Antwort", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const invoice = await festschreiben();
    expect(await ablage.deliveryForInvoice(invoice)).toEqual({ status: "wartet" });

    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 1, fehler: 0 });
    expect(mitId.received).toHaveLength(1);
    const { headers, files } = mitId.received[0]!;
    expect(headers.authorization).toBe("Bearer archiv_geheim_1");
    expect(files.datei!.name).toBe(`Rechnung-${invoice.number}.pdf`);
    expect(files.datei!.type).toBe("application/pdf");
    expect(sha256(files.datei!.bytes)).toBe(invoice.pdfSha256);

    const status = await ablage.deliveryForInvoice(invoice);
    expect(status).toMatchObject({ status: "uebertragen", httpStatus: 201, link: "https://archiv.example/dokumente/0b5e3c1a-7d2f-4e8a-9b61-2f4d8c0a1e77" });
    expect(await zeile(invoice.id)).toMatchObject({ sha256: invoice.pdfSha256, archive_id: "0b5e3c1a-7d2f-4e8a-9b61-2f4d8c0a1e77", attempts: 1 });

    // Idempotent: ein zweiter Lauf schickt nichts mehr
    expect(await ablage.deliverInvoices(actor, true)).toEqual({ uebertragen: 0, fehler: 0 });
    expect(mitId.received).toHaveLength(1);
    const audit = await sql`select action from audit_log where table_name = 'archive_deliveries'`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT"]);
  });

  it("schickt einer zweiten Adresse andere Felder: Dateifeld, Token-Kopfzeile, Titel mit Platzhaltern, PDF statt XML", async () => {
    await ablage.saveArchiveTarget(actor, zielOhneId());
    const invoice = await festschreiben("xrechnung-cii");
    await ablage.deliverInvoices(actor);
    const { headers, fields, files } = ohneId.received[0]!;
    expect(headers.authorization).toBe("Token archiv_geheim_2");
    expect(fields).toEqual({ title: `Rechnung ${invoice.number} · Nordwerk Software GmbH` });
    expect(Object.keys(files)).toEqual(["document"]);
    expect(sha256(files.document!.bytes)).toBe(invoice.pdfSha256);
    // Die Antwort ist keine JSON-Antwort mit id: übertragen, aber ohne Link
    expect(await ablage.deliveryForInvoice(invoice)).toMatchObject({ status: "uebertragen", httpStatus: 200, link: null });
    expect(mitId.received).toHaveLength(0);
  });

  it("schickt eine XRechnung im Original als XML", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const invoice = await festschreiben("xrechnung-cii");
    await ablage.deliverInvoices(actor);
    const file = mitId.received[0]!.files.datei!;
    expect(file.name).toBe(`Rechnung-${invoice.number}-cii.xml`);
    expect(file.type).toBe("application/xml");
    expect(sha256(file.bytes)).toBe(invoice.xmlSha256);
  });

  it("wiederholt nach einem Fehler und überträgt dann einmal", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const invoice = await festschreiben();
    mitId.queue.push({ status: 503, body: { fehler: "Wartung" } });
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 0, fehler: 1 });
    expect(await ablage.deliveryForInvoice(invoice)).toMatchObject({ status: "fehler", httpStatus: 503, attempts: 1 });
    expect((await ablage.deliveryForInvoice(invoice)) as { error: string }).toMatchObject({ error: expect.stringContaining("HTTP 503") });

    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 1, fehler: 0 });
    expect(mitId.received).toHaveLength(2);
    expect(await zeile(invoice.id)).toMatchObject({ status: "uebertragen", attempts: 2, error: null });
    const audit = await sql`select action from audit_log where table_name = 'archive_deliveries' order by id`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT", "UPDATE"]);
  });

  it("folgt keiner Weiterleitung: die Kopfzeile geht nur an die eingestellte Adresse", async () => {
    await ablage.saveArchiveTarget(actor, { ...zielMitId(), url: umleitung.url });
    const invoice = await festschreiben();
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 0, fehler: 1 });
    expect(umleitung.received).toHaveLength(1);
    expect(mitId.received).toHaveLength(0);
    expect(await ablage.deliveryForInvoice(invoice)).toMatchObject({ status: "fehler", httpStatus: 302, error: expect.stringContaining("Weiterleitung") });
  });

  it("meldet eine Adresse, die nicht antwortet, als Fehler", async () => {
    await ablage.saveArchiveTarget(actor, { ...zielMitId(), url: "http://127.0.0.1:9/api/upload" });
    const invoice = await festschreiben();
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 0, fehler: 1 });
    expect(await ablage.deliveryForInvoice(invoice)).toMatchObject({ status: "fehler", httpStatus: null, error: expect.stringContaining("Nicht erreichbar") });
  });

  it("nimmt Storno und Korrektur mit, aber nichts von vor dem Einschalten und nichts Ausgeschaltetes", async () => {
    const vorher = await festschreiben();
    await ablage.saveArchiveTarget(actor, zielMitId());
    const original = await festschreiben();
    const storno = await invoices.cancelInvoice(actor, original.id, "2026-10-05");
    const korrektur = await invoices.finalizeInvoice(actor, (await invoices.createCorrection(actor, vorher.id, "2026-10-06")).id, kleinunternehmerStand);
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 3, fehler: 0 });
    expect(mitId.received.map((r) => r.files.datei!.name)).toEqual([original, storno, korrektur].map((i) => `Rechnung-${i.number}.pdf`));
    expect(await ablage.deliveryForInvoice(vorher)).toBeNull();

    await ablage.saveArchiveTarget(actor, { ...zielMitId(), enabled: false });
    await festschreiben();
    expect(await ablage.runDueArchiveDeliveries()).toBeNull();
    expect(mitId.received).toHaveLength(3);
  });

  it("wiederholt stündlich nur bis zur Grenze, von Hand und nach dem Speichern wieder", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const invoice = await festschreiben();
    await sql`insert into archive_deliveries (invoice_id, url, filename, sha256, status, attempts, error)
      values (${invoice.id}, ${mitId.url}, 'x.pdf', ${invoice.pdfSha256}, 'fehler', ${lauf.MAX_VERSUCHE}, 'HTTP 401')`;
    expect(await ablage.runDueArchiveDeliveries()).toEqual({ uebertragen: 0, fehler: 0 });
    expect(mitId.received).toHaveLength(0);
    // Mit korrigierter Kopfzeile gespeichert: Die Zählung beginnt neu
    await ablage.saveArchiveTarget(actor, zielMitId());
    expect(await zeile(invoice.id)).toMatchObject({ attempts: 0 });
    expect(await ablage.runDueArchiveDeliveries()).toEqual({ uebertragen: 1, fehler: 0 });
  });

  it("beginnt bei einer neuen Adresse neu und schickt dorthin nur Neues", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const alt = await festschreiben();
    await ablage.deliverInvoices(actor);
    await ablage.saveArchiveTarget(actor, zielOhneId());
    // Die Kopie liegt an der früheren Adresse
    expect(await ablage.deliveryForInvoice(alt)).toMatchObject({ status: "uebertragen", link: expect.stringContaining("/dokumente/") });
    const neu = await festschreiben();
    await ablage.deliverInvoices(actor);
    expect(ohneId.received.map((r) => r.files.document!.name)).toEqual([`Rechnung-${neu.number}.pdf`]);
  });

  it("schickt nach Aus- und Wiedereinschalten auch, was in der Pause festgeschrieben wurde", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const [{ since }] = (await sql`select since from archive_target`) as unknown as [{ since: Date }];
    await ablage.saveArchiveTarget(actor, { ...zielMitId(), enabled: false });
    const inDerPause = await festschreiben();
    await ablage.saveArchiveTarget(actor, zielMitId());
    expect((await sql`select since from archive_target`)[0]!.since).toEqual(since);
    expect(await ablage.deliveryForInvoice(inDerPause)).toEqual({ status: "wartet" });
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 1, fehler: 0 });
    expect(mitId.received.map((r) => r.files.datei!.name)).toEqual([`Rechnung-${inDerPause.number}.pdf`]);
  });

  it("speichert keinen Wert der Kopfzeile, den das Archiv in seiner Fehlerantwort wiederholt", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const invoice = await festschreiben();
    // Ganz oder nur das Token nach „Bearer“
    mitId.queue.push({ status: 401, body: { kopfzeile: "Bearer archiv_geheim_1", fehler: "Token archiv_geheim_1 ungültig" } });
    expect(await ablage.deliverInvoices(actor)).toEqual({ uebertragen: 0, fehler: 1 });
    const status = (await ablage.deliveryForInvoice(invoice)) as { error: string };
    expect(status.error).toContain("HTTP 401");
    expect(status.error).not.toContain("archiv_geheim_1");
    expect((await zeile(invoice.id))!.error).not.toContain("archiv_geheim_1");
  });

  it("schickt bei gleichzeitigem Lauf nach dem Festschreiben und stündlichem Lauf jede Rechnung einmal", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    await festschreiben();
    await festschreiben();
    const [a, b, c] = await Promise.all([ablage.runDueArchiveDeliveries(), ablage.runDueArchiveDeliveries(), ablage.deliverInvoices(actor, true)]);
    expect([a, b, c].reduce((sum, r) => sum + (r?.uebertragen ?? 0), 0)).toBe(2);
    expect(mitId.received).toHaveLength(2);
  });

  it("zeigt an einer festgeschriebenen Rechnung ohne eingerichtete Ablage keinen Stand", async () => {
    const invoice = await festschreiben();
    expect(await ablage.deliveryForInvoice(invoice)).toBeNull();
  });

  it("entfernt Ziel und Geheimnis, behält erfolgreiche Weitergaben und schickt keine neue Rechnung", async () => {
    await ablage.saveArchiveTarget(actor, zielMitId());
    const alt = await festschreiben();
    await ablage.deliverInvoices(actor);
    const bisher = await ablage.deliveryForInvoice(alt);
    expect(bisher).toMatchObject({ status: "uebertragen", httpStatus: 201, link: expect.stringContaining("/dokumente/") });
    expect((await sql`select ciphertext from archive_target`)[0]!.ciphertext).not.toBeNull();

    await ablage.deleteArchiveTarget(actor);
    expect(await sql`select * from archive_target`).toHaveLength(0);
    expect((await ablage.archiveTargetSummary()).target).toBeNull();
    expect(await ablage.deliveryForInvoice(alt)).toEqual(bisher);
    const audit = await sql`select old_value::text as data from audit_log where table_name = 'archive_target' and action = 'DELETE'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.data).not.toContain("ciphertext");
    expect(audit[0]!.data).not.toContain("archiv_geheim_1");

    const neu = await festschreiben();
    expect(await ablage.runDueArchiveDeliveries()).toBeNull();
    expect(await ablage.deliverInvoices(actor, true)).toEqual({ uebertragen: 0, fehler: 0 });
    expect(mitId.received).toHaveLength(1);
    expect(await zeile(neu.id)).toBeUndefined();
    expect(await ablage.deliveryForInvoice(neu)).toBeNull();
    expect(await ablage.deliveryForInvoice(alt)).toEqual(bisher);
  });

  it("lehnt ungültige Einstellungen ab", async () => {
    const fehler = (input: object) => ablage.saveArchiveTarget(actor, { ...zielMitId(), ...input });
    await expect(fehler({ url: "ftp://archiv.example/upload" })).rejects.toThrow(/http/);
    await expect(fehler({ url: "https://nutzer:pass@archiv.example/upload" })).rejects.toThrow(/Zugangsdaten/);
    await expect(fehler({ headerName: "Content-Type" })).rejects.toThrow(/setzt Haben selbst/);
    await expect(fehler({ headerName: "Authorization: Bearer" })).rejects.toThrow(/Kopfzeile/);
    await expect(fehler({ headerValue: "Bearer a\r\nX-Evil: 1" })).rejects.toThrow(/einer Zeile/);
    await expect(fehler({ fields: [{ name: "datei", value: "x" }] })).rejects.toThrow(/wie das Dateifeld/);
    await expect(fehler({ linkTemplate: "https://archiv.example/dokumente/" })).rejects.toThrow(/\{id\}/);
    await expect(fehler({ headerValue: undefined })).rejects.toThrow(/Wert der Kopfzeile fehlt/);
    expect(await sql`select * from archive_target`).toHaveLength(0);
  });
});
