import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { schema, Tx } from "../../db/index.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

type Invoice = typeof schema.invoices.$inferSelect;
type Shares = { rate: number; base: number; tax: number }[];
type Fixture = Partial<typeof schema.invoices.$inferInsert>;

/**
 * #750: Das neue Verfahren ändert keinen Altbeleg. Eine Ersatzrechnung ist nur dann dieselbe Leistung, wenn Bezüge,
 * Leistungsdatum und gespeicherte Centbeträge je Satz eindeutig übereinstimmen; ein Papierstorno nimmt sie nicht zurück.
 * Quelle: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
describe.skipIf(!testDatabaseUrl)("Bilanzverfahren und eindeutiger Schlussrechnungsersatz (Postgres)", () => {
  let sql: postgres.Sql;
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let procedure: typeof import("./advance-procedure.ts")["advanceProcedure"];
  let contactId: string;
  let otherContactId: string;
  let number: number;
  const actor = "advance-procedure-test";
  const rest = [{ rate: 1900, base: 70_000, tax: 13_300 }];

  beforeAll(async () => {
    sql = await setupTestDb();
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
    ({ advanceProcedure: procedure } = await import("./advance-procedure.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    await leeren(sql)`truncate seals, audit_log, company, invoices, contacts, journal_entries cascade`;
    await sql`insert into company (id, name, rechtsform) values (1, 'Muster GmbH', 'gmbh')`;
    const contacts = await sql`insert into contacts (name) values ('Kunde A'), ('Kunde B') returning id`;
    contactId = contacts[0]!.id;
    otherContactId = contacts[1]!.id;
    number = 0;
  });

  async function invoice(tx: Tx, values: Fixture = {}, deductions: string[] = [], shares: Shares = rest, final = true): Promise<Invoice> {
    const s = database.schema;
    const [row] = await tx
      .insert(s.invoices)
      .values({
        contactId,
        issueDate: "2027-01-20",
        dueDate: "2027-02-03",
        serviceFrom: "2027-01-20",
        variant: "schluss",
        advanceAccounting: "deferred",
        net: shares.reduce((sum, t) => sum + t.base, 0),
        tax: shares.reduce((sum, t) => sum + t.tax, 0),
        gross: shares.reduce((sum, t) => sum + t.base + t.tax, 0),
        ...values,
      })
      .returning();
    if (shares.length) await tx.insert(s.invoiceTaxes).values(shares.map((t) => ({ invoiceId: row!.id, ...t })));
    if (deductions.length)
      await tx.insert(s.invoiceLines).values(
        deductions.map((deductionOf, position) => ({
          invoiceId: row!.id,
          position,
          description: "Abzug",
          quantity: 1000,
          unit: "Psch.",
          unitPrice: -30_000,
          taxRate: 1900,
          net: -30_000,
          deductionOf,
        })),
      );
    if (!final) return row!;
    const [locked] = await tx
      .update(s.invoices)
      .set({ status: "final", number: `TEST-${++number}`, lockedAt: new Date() })
      .where(eq(s.invoices.id, row!.id))
      .returning();
    return locked!;
  }

  const advance = (tx: Tx, values: Fixture = {}) =>
    invoice(tx, { variant: "abschlag", advanceType: "anzahlung", serviceFrom: null, ...values }, [], [{ rate: 1900, base: 30_000, tax: 5700 }]);
  const lines = (ids: string[]) => ids.map((deductionOf) => ({ deductionOf }));
  const cancel = (tx: Tx, original: Invoice) => invoice(tx, { kind: "storno", variant: null, correctsId: original.id }, [], []);
  async function previous(tx: Tx, ids: string[]) {
    const original = await invoice(tx, {}, ids);
    await cancel(tx, original);
    return original;
  }

  it.each(["gmbh", "ug"] as const)("neue %s-Anforderung erhält das aufgeschobene Bilanzverfahren", (rechtsform) =>
    withActor(actor, async (tx) => {
      const draft = await invoice(tx, { variant: "abschlag", advanceType: "anzahlung", advanceAccounting: null }, [], rest, false);
      expect(await procedure(draft, [], { rechtsform }, tx)).toEqual({ advanceAccounting: "deferred", replacesInvoiceId: null });
    }),
  );

  it("Einzelunternehmen und erbrachte Teilleistung erhalten keine Anzahlungsabgrenzung", () =>
    withActor(actor, async (tx) => {
      const draft = await invoice(tx, { variant: "abschlag", advanceType: "anzahlung", advanceAccounting: null }, [], rest, false);
      expect(await procedure(draft, [], { rechtsform: "einzelunternehmen" }, tx)).toEqual({ advanceAccounting: null, replacesInvoiceId: null });
      expect(await procedure({ ...draft, advanceType: "teilleistung" }, [], { rechtsform: "gmbh" }, tx)).toEqual({
        advanceAccounting: null,
        replacesInvoiceId: null,
      });
    }));

  it("Schlussrechnung nur mit Bestandsabschlag bleibt im bisherigen Verfahren", () =>
    withActor(actor, async (tx) => {
      const old = await advance(tx, { advanceAccounting: null });
      const draft = await invoice(tx, { advanceAccounting: null }, [old.id], rest, false);
      expect(await procedure(draft, lines([old.id]), { rechtsform: "gmbh" }, tx)).toEqual({ advanceAccounting: null, replacesInvoiceId: null });
    }));

  it("eine neue markierte Anforderung unter mehreren Abzügen genügt für die erste Schlussleistung", () =>
    withActor(actor, async (tx) => {
      const old = await advance(tx, { advanceAccounting: null });
      const fresh = await advance(tx);
      const draft = await invoice(tx, { advanceAccounting: null }, [old.id, fresh.id], rest, false);
      expect(await procedure(draft, lines([old.id, fresh.id]), { rechtsform: "gmbh" }, tx)).toEqual({
        advanceAccounting: "deferred",
        replacesInvoiceId: null,
      });
    }));

  it.each([null, "deferred"] as const)("Korrektur und deren Storno folgen dem Wurzelverfahren %s statt den aktuellen Firmendaten", (marker) =>
    withActor(actor, async (tx) => {
      const original = await advance(tx, { advanceAccounting: marker });
      const correction = await invoice(tx, { kind: "korrektur", variant: null, correctsId: original.id, advanceAccounting: marker }, [], []);
      const draft = await invoice(tx, { kind: "storno", variant: null, correctsId: correction.id, advanceAccounting: null }, [], [], false);
      expect(await procedure(draft, [], { rechtsform: marker ? "einzelunternehmen" : "gmbh" }, tx)).toEqual({
        advanceAccounting: marker,
        replacesInvoiceId: null,
      });
    }),
  );

  it("betragsgleicher Ersatz wird über den vollständigen Abzugssatz verbunden, unabhängig von dessen Reihenfolge", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      const b = await advance(tx);
      const original = await previous(tx, [a.id, b.id]);
      const draft = await invoice(tx, { issueDate: "2027-03-01", advanceAccounting: null }, [b.id, a.id], rest, false);
      expect(await procedure(draft, lines([b.id, a.id, a.id]), { rechtsform: "gmbh" }, tx)).toEqual({
        advanceAccounting: "deferred",
        replacesInvoiceId: original.id,
      });
    }));

  it("ein weiterer Ersatz schließt am letzten stornierten Blatt der gespeicherten Ersatzkette an", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      const original = await previous(tx, [a.id]);
      const second = await invoice(tx, { issueDate: "2027-03-01", replacesInvoiceId: original.id }, [a.id]);
      await cancel(tx, second);
      const draft = await invoice(tx, { issueDate: "2027-05-01", advanceAccounting: null }, [a.id], rest, false);
      expect(await procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).toEqual({
        advanceAccounting: "deferred",
        replacesInvoiceId: second.id,
      });
    }));

  it("eine bloße Überschneidung darf zwei schon realisierte Abzüge nicht in Teilketten aufteilen", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      const b = await advance(tx);
      await previous(tx, [a.id, b.id]);
      const draft = await invoice(tx, { advanceAccounting: null }, [a.id], rest, false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/Abzüge.*überein/);
    }));

  it("auch ein Cent Preisabweichung ist keine automatisch datierte Entgeltänderung", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      await previous(tx, [a.id]);
      const draft = await invoice(tx, { advanceAccounting: null }, [a.id], [{ rate: 1900, base: 69_999, tax: 13_300 }], false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/Beträge.*Steuersatz/);
    }));

  it("derselbe Bruttorest mit anderer Satzverteilung ist kein betragsgleicher Ersatz", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      await previous(tx, [a.id]);
      const draft = await invoice(
        tx,
        { advanceAccounting: null },
        [a.id],
        [
          { rate: 700, base: 70_000, tax: 4900 },
          { rate: 0, base: 8400, tax: 0 },
        ],
        false,
      );
      expect(draft.gross).toBe(83_300);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/Beträge.*Steuersatz/);
    }));

  it.each(["customer", "treatment", "currency", "performance"] as const)("Ersatz mit verändertem %s wird abgelehnt", (field) =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      await previous(tx, [a.id]);
      const changes: Record<typeof field, Fixture> = {
        customer: { contactId: otherContactId },
        treatment: { taxTreatment: "kleinunternehmer" },
        currency: { currency: "USD" },
        performance: { serviceFrom: "2027-03-01" },
      };
      const draft = await invoice(tx, { advanceAccounting: null, ...changes[field] }, [a.id], rest, false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/Kunde.*Steuerbehandlung.*Währung.*Leistungsdatum/);
    }),
  );

  it("ein noch aktiver Schlussbeleg wird nicht automatisch ersetzt", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      await invoice(tx, {}, [a.id]);
      const draft = await invoice(tx, { advanceAccounting: null }, [a.id], rest, false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/noch nicht storniert/);
    }));

  it("zwei unabhängige historische Schlussbelege werden nicht über das jüngste Datum zu einer Ersatzkette geraten", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      await previous(tx, [a.id]);
      await previous(tx, [a.id]);
      const draft = await invoice(tx, { advanceAccounting: null }, [a.id], rest, false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/nicht eindeutig/);
    }));

  it("eine echte Korrektur der bisherigen Schlussleistung wird nicht durch einen Ersatz still rückdatiert", () =>
    withActor(actor, async (tx) => {
      const a = await advance(tx);
      const original = await previous(tx, [a.id]);
      await invoice(tx, { kind: "korrektur", variant: null, correctsId: original.id }, [], [{ rate: 1900, base: -10_000, tax: -1900 }]);
      const draft = await invoice(tx, { advanceAccounting: null }, [a.id], rest, false);
      await expect(procedure(draft, lines([a.id]), { rechtsform: "gmbh" }, tx)).rejects.toThrow(/Korrektur.*fachlich/);
    }));

  it("neue Felder werden beim Festschreiben versiegelt; ein Vorgänger hat höchstens einen finalen Ersatz", async () => {
    const saved = await withActor(actor, async (tx) => {
      const a = await advance(tx);
      const original = await previous(tx, [a.id]);
      const replacement = await invoice(tx, { replacesInvoiceId: original.id }, [a.id]);
      const [seal] = await tx.select().from(database.schema.seals).where(eq(database.schema.seals.rowId, replacement.id));
      expect(seal!.columns).toMatchObject({ invoices: expect.arrayContaining(["advance_accounting", "replaces_invoice_id"]) });
      return { advanceId: a.id, originalId: original.id };
    });
    await expect(withActor(actor, (tx) => invoice(tx, { replacesInvoiceId: saved.originalId }, [saved.advanceId]))).rejects.toThrow();
  });
});
