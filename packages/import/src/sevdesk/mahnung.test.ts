import { describe, expect, it } from "vitest";
import mahnungen10 from "../../test-fixtures/sevdesk/buchhaltung-1.0/mahnung-mit-rechnung.json" with { type: "json" };
import mahnung20 from "../../test-fixtures/sevdesk/buchhaltung-2.0/mahnung-mit-rechnung.json" with { type: "json" };
import { isSevInvoiceImportable } from "./map.ts";
import { isSevDunning, mapSevDunning } from "./mahnung.ts";
import { sevInvoiceSchema } from "./types.ts";

/* Mahnungen aus den anonymisierten Antworten beider Buchhaltungsversionen (README in test-fixtures/sevdesk). */

const stufen10 = mahnungen10.filter((e) => "invoice" in e).map((e) => sevInvoiceSchema.parse((e as { invoice: unknown }).invoice));
const rechnung10 = sevInvoiceSchema.parse((mahnungen10.find((e) => "gemahnteRechnung" in e) as { gemahnteRechnung: unknown }).gemahnteRechnung);
const stufe20 = sevInvoiceSchema.parse(mahnung20.mahnung);
const rechnung20 = sevInvoiceSchema.parse(mahnung20.gemahnte_rechnung[0]);

describe("sevDesk-Mahnungen", () => {
  it("erkennt jede Stufe als Mahnung und keine als Rechnung", () => {
    for (const m of [...stufen10, stufe20]) {
      expect(isSevDunning(m)).toBe(true);
      expect(isSevInvoiceImportable(m)).toBe(false);
    }
    expect(isSevDunning(rechnung10)).toBe(false);
    expect(isSevDunning(rechnung20)).toBe(false);
  });

  it("lässt eine ungespeicherte Mahnung (Status 100) draußen", () => {
    expect(isSevDunning({ ...stufen10[0]!, status: "100" })).toBe(false);
  });

  it("verknüpft beide Stufen aus 1.0 mit der Rechnung aus origin, Betrag aus reminderTotal", () => {
    expect(stufen10.map(mapSevDunning)).toEqual([
      expect.objectContaining({
        externalId: `invoice/${stufen10[0]!.id}`,
        invoiceExternalId: `invoice/${rechnung10.id}`,
        level: 1,
        date: "2024-01-15",
        dueDate: "2024-01-15",
        sentDate: "2024-01-15",
        status: "500",
        total: 100,
      }),
      expect.objectContaining({ invoiceExternalId: `invoice/${rechnung10.id}`, level: 2, total: 100 }),
    ]);
    // Die Rechnung trägt die höchste Stufe
    expect(rechnung10.dunningLevel).toBe("2");
  });

  it("liest die bezahlte Mahnung aus 2.0; die maskierte Frist bleibt leer", () => {
    expect(mapSevDunning(stufe20)).toMatchObject({
      invoiceExternalId: `invoice/${rechnung20.id}`,
      level: 1,
      date: "2021-08-05",
      dueDate: null,
      status: "1000",
      total: 10_000,
    });
  });

  it("rät nicht: ohne Verweis auf eine Rechnung keine Verknüpfung, ohne lesbare Stufe keine Stufe", () => {
    const m = mapSevDunning({ ...stufe20, origin: { id: "5", objectName: "Order" }, dunningLevel: "x", reminderTotal: null } as never);
    expect(m).toMatchObject({ invoiceExternalId: null, level: null, total: null });
    expect(mapSevDunning({ ...stufe20, origin: [] } as never).invoiceExternalId).toBeNull();
  });
});
