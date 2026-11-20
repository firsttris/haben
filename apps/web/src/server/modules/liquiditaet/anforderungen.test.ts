import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { ACTOR, firma, kunde } from "./test-liquiditaet.ts";

/*
 * Liquiditätsvorschau (#1381): In der GmbH führt das neue Anzahlungsverfahren (advanceAccounting „deferred“) Rechnungen mit Leistung
 * nach heute als Anforderung, nicht als Forderung (`openPositions().advanceRequests`). Das Geld kommt trotzdem.
 */

describe.skipIf(!testDatabaseUrl)("Liquiditätsvorschau: Anforderungen der GmbH (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let offene: typeof import("./offene-posten.ts");
  let kontext: typeof import("./kontext.ts");

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    offene = await import("./offene-posten.ts");
    kontext = await import("./kontext.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "eine unbezahlte Rechnung für Leistung im Dezember steht als Eingang zur Fälligkeit (%s, %s)",
    async (kontenrahmen, versteuerung) => {
      await firma(sql, { rechtsform: "gmbh", kontenrahmen, versteuerung });
      const contactId = await kunde(contacts);
      const draft = await invoices.createDraft(ACTOR, {
        contactId,
        issueDate: "2026-11-16",
        serviceFrom: "2026-12-01",
        serviceTo: "2026-12-31",
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description: "Wartung Dezember", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
      });
      const rechnung = await invoices.finalizeInvoice(ACTOR, draft.id, kleinunternehmerStand);
      const k = await kontext.ladeKontext("2026-11-20", "13w");
      const posten = await offene.offenePostenPosten(k, { ueberfaellige: true });
      expect(posten.map((p) => [p.quelle.id, p.datum, p.betrag, p.richtung])).toEqual([[rechnung.id, "2026-11-30", 119_000, "ein"]]);
    },
    30_000,
  );
});
