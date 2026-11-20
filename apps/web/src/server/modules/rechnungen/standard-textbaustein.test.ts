import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DUNNING_TEXTS } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/** Text eines PDFs mit pdftotext (poppler-utils), Leerraum zusammengefasst; ohne das Werkzeug null */
function pdfText(pdf: Uint8Array): string | null {
  const dir = mkdtempSync(join(tmpdir(), "haben-standard-"));
  try {
    writeFileSync(join(dir, "beleg.pdf"), pdf);
    return execFileSync("pdftotext", [join(dir, "beleg.pdf"), "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Standard-Textbaustein je Belegart (#1494): füllt neue Belege vor, löst die Standard-Einleitung der Firmendaten ab
describe.skipIf(!testDatabaseUrl)("Standard-Textbaustein je Belegart (Postgres, #1494)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let dunning: typeof import("./dunning.ts");
  let docs: typeof import("./order-documents.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let withActor: typeof import("../../db/actor.ts").withActor;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    quotes = await import("./quotes.ts");
    dunning = await import("./dunning.ts");
    docs = await import("./order-documents.ts");
    stammdaten = await import("../stammdaten/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    ({ withActor } = await import("../../db/actor.ts"));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate dunnings, text_blocks, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "kunde@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  const lines = [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const }];
  type Standard = NonNullable<import("../stammdaten/index.ts").TextBlockInput["standardFuer"]>;
  const baustein = (kind: "kopf" | "fuss", text: string, standardFuer: Standard | null, name = text) =>
    stammdaten.createTextBlock(actor, { name, kind, text, contactId: null, standardFuer });

  it("ohne Standard beginnen Rechnung und Angebot ohne Einleitung und Hinweis, die Mahnung mit den Texten der Stufe", async () => {
    await baustein("kopf", "Nur zum Einfügen", null);
    expect(await invoices.newDraftDefaults("2026-11-04")).toMatchObject({ intro: "", note: "" });
    expect(await quotes.newQuoteDefaults("2026-11-04")).toMatchObject({ intro: "", note: "" });
  });

  it("füllt neue Rechnungen und Angebote mit Kopf- und Fußtext ihres Standards vor, Platzhalter bleiben stehen", async () => {
    await baustein("kopf", "Für die Leistungen {leistungszeitraum} berechne ich Ihnen:", "rechnung");
    await baustein("fuss", "Bitte {betrag} bis {faellig} überweisen.", "rechnung");
    await baustein("kopf", "Gerne biete ich Ihnen an:", "angebot");
    expect(await invoices.newDraftDefaults("2026-11-04")).toMatchObject({
      intro: "Für die Leistungen {leistungszeitraum} berechne ich Ihnen:",
      note: "Bitte {betrag} bis {faellig} überweisen.",
    });
    expect(await quotes.newQuoteDefaults("2026-11-04")).toMatchObject({ intro: "Gerne biete ich Ihnen an:", note: "" });
  });

  it("ein neuer Standard löst den alten derselben Belegart und Art ab; archiviert ist keiner mehr Standard", async () => {
    const alt = await baustein("kopf", "Alte Einleitung", "rechnung");
    const neu = await baustein("kopf", "Neue Einleitung", "rechnung");
    await baustein("fuss", "Fußtext bleibt", "rechnung");
    const standard = async () => Object.fromEntries((await sql`select id, standard_fuer from text_blocks`).map((r) => [r.id, r.standard_fuer]));
    expect((await standard())[alt.id]).toBeNull();
    expect((await standard())[neu.id]).toBe("rechnung");
    expect(await invoices.newDraftDefaults("2026-11-04")).toMatchObject({ intro: "Neue Einleitung", note: "Fußtext bleibt" });

    // Auch beim Bearbeiten: der alte wird wieder Standard, der neue verliert ihn
    await stammdaten.updateTextBlock(actor, alt.id, {
      name: "Alte Einleitung",
      kind: "kopf",
      text: "Alte Einleitung",
      contactId: null,
      standardFuer: "rechnung",
    });
    expect((await standard())[neu.id]).toBeNull();

    await stammdaten.setTextBlockArchived(actor, alt.id, true);
    expect((await standard())[alt.id]).toBeNull();
    expect((await invoices.newDraftDefaults("2026-11-04")).intro).toBe("");
    await stammdaten.setTextBlockArchived(actor, alt.id, false);
    expect((await standard())[alt.id]).toBeNull();
  });

  it("lehnt einen Standard für einen Kunden und einen Kopftext für den Lieferschein ab", async () => {
    await expect(stammdaten.createTextBlock(actor, { name: "Kunde", kind: "kopf", text: "x", contactId, standardFuer: "rechnung" })).rejects.toThrow(
      /für alle Kunden/,
    );
    await expect(baustein("kopf", "Lieferschein-Kopf", "lieferschein")).rejects.toThrow(/nur ein Fußtext/);
    expect(await sql`select id from text_blocks`).toHaveLength(0);
  });

  it("ein geänderter Standard ändert keinen schon angelegten Entwurf", async () => {
    const b = await baustein("kopf", "Vorgabe Rechnung", "rechnung");
    const entwurf = await invoices.createDraft(actor, { ...(await invoices.newDraftDefaults("2026-11-04")), contactId, lines });
    await stammdaten.updateTextBlock(actor, b.id, { name: "x", kind: "kopf", text: "Neue Vorgabe", contactId: null, standardFuer: "rechnung" });
    expect((await invoices.getInvoice(entwurf.id))?.invoice.intro).toBe("Vorgabe Rechnung");
  });

  it("die Mahnung nimmt Kopf- und Fußtext ihres Standards für jede Stufe, ohne Standard die Texte der Stufe", async () => {
    const rechnung = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, { ...(await invoices.newDraftDefaults("2026-10-01")), contactId, paymentTermDays: 14, lines })).id,
      kleinunternehmerStand,
    );
    expect((await dunning.dunningDraft(rechnung.id, "2026-11-20"))?.texts).toEqual(DUNNING_TEXTS);
    await baustein("kopf", "Unsere Rechnung ist noch offen.", "mahnung");
    const texts = (await dunning.dunningDraft(rechnung.id, "2026-11-20"))!.texts;
    expect([texts[1].intro, texts[3].intro]).toEqual(["Unsere Rechnung ist noch offen.", "Unsere Rechnung ist noch offen."]);
    // Ohne Fußtext-Standard bleibt der Schlusstext der Stufe
    expect(texts[3].closing).toBe(DUNNING_TEXTS[3].closing);
  });

  it("Auftragsbestätigung und Lieferschein nehmen ihren Standard beim Erzeugen", async () => {
    const angebot = await quotes.finalizeQuote(
      actor,
      (await quotes.createQuoteDraft(actor, { ...(await quotes.newQuoteDefaults("2026-11-02")), contactId, intro: "Einleitung des Angebots", lines })).id,
    );
    await quotes.setQuoteDecision(actor, angebot.id, "angenommen");
    const ohne = pdfText((await docs.confirmationPdf(angebot.id)).pdf);
    await baustein("kopf", "Vielen Dank für Ihren Auftrag {nummer}.", "auftragsbestaetigung");
    await baustein("fuss", "Ware vollständig erhalten:", "lieferschein");
    const bestaetigung = pdfText((await docs.confirmationPdf(angebot.id)).pdf);
    const lieferschein = pdfText((await docs.deliveryNotePdf("angebot", angebot.id)).pdf);
    if (ohne === null || bestaetigung === null || lieferschein === null) return; // ohne pdftotext nur die Erzeugung geprüft
    expect(ohne).toContain("Einleitung des Angebots");
    expect(bestaetigung).toContain(`Vielen Dank für Ihren Auftrag ${angebot.number}.`);
    expect(bestaetigung).not.toContain("Einleitung des Angebots");
    expect(lieferschein).toContain("Ware vollständig erhalten:");
  }, 60_000);

  it("übernimmt die Standard-Einleitungen einer älteren Exportdatei als Bausteine, ohne einen vorhandenen Standard zu überschreiben", async () => {
    await baustein("kopf", "Schon da", "angebot");
    await withActor(actor, (tx) => stammdaten.alteStandardEinleitungen(tx, { invoiceIntro: "Aus der alten Datei", quoteIntro: "Auch alt", name: "x" }));
    expect(await invoices.newDraftDefaults("2026-11-04")).toMatchObject({ intro: "Aus der alten Datei" });
    expect(await quotes.newQuoteDefaults("2026-11-04")).toMatchObject({ intro: "Schon da" });
    // Eine neue Datei ohne die Felder ändert nichts
    await withActor(actor, (tx) => stammdaten.alteStandardEinleitungen(tx, { name: "x" }));
    expect(await sql`select id from text_blocks`).toHaveLength(2);
  });
});
