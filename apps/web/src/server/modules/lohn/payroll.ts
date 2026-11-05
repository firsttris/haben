import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type Bundesland, lohnabrechnung, type LohnabrechnungErgebnis, monatsgrenzen, monatsname } from "@haben/core";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { PayslipMitarbeiter } from "../../db/schema.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { abrechnungPdf } from "./abrechnung-pdf.ts";
import { bucheAbrechnung, bucheStorno, gebuchteAbrechnungen } from "./buchung.ts";
import { type Employee, fehlendeAngaben, hinweiseZuStammdaten, LohnError, payslipMitarbeiter } from "./employees.ts";

/*
 * Lohnabrechnung je Monat und Mitarbeiter: Entwurf rechnen (`lohnabrechnung` in @haben/core), prüfen, festschreiben
 * (gesperrt und versiegelt, mit PDF), stornieren. Nach einem Storno entsteht eine neue Abrechnung desselben Monats, die
 * auf die stornierte verweist; die stornierte bleibt unverändert (GoBD). Festschreiben bucht die Abrechnung ins Journal,
 * ein Storno die Gegenbuchung (buchung.ts).
 */

export type Payslip = typeof schema.payslips.$inferSelect;

const monthSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) });

export const abrechnenSchema = monthSchema.extend({ zahltag: z.iso.date("Zahltag im Format JJJJ-MM-TT") });
export const entwurfSchema = z.object({
  id: z.uuid(),
  /** Entgelt dieses Monats in Cent; ohne Angabe das Monatsgehalt aus den Stammdaten */
  entgelt: z.number().int().min(1, "Entgelt fehlt").max(10_000_000_00).nullable().default(null),
});
export const festschreibenSchema = z.object({ id: z.uuid(), gegengeprueft: z.boolean().default(false) });
export const stornoSchema = z.object({ id: z.uuid(), grund: z.string().trim().max(500).default("") });

/** Bundesland der Betriebsstätte: Kirchensteuersatz und Pflegeversicherung in Sachsen */
async function bundesland(q: Db | Tx): Promise<Bundesland> {
  const company = await loadCompany(q);
  if (!company.bundesland) throw new LohnError("In den Firmendaten fehlt das Bundesland; davon hängen Kirchensteuer und Pflegeversicherung ab.");
  return company.bundesland;
}

/** Ein Gesellschafter-Geschäftsführer, dessen Statusfeststellung Versicherungspflicht ergeben hat, wird nicht ohne SV gerechnet */
function stammdatenFehler(m: PayslipMitarbeiter): string | null {
  if (m.lohn.art === "ggf" && m.statusfeststellung === "versicherungspflichtig") {
    return "Die Statusfeststellung hat Versicherungspflicht ergeben; der Mitarbeiter ist kein Gesellschafter-Geschäftsführer ohne SV-Pflicht.";
  }
  return null;
}

/** Rechnet den Monat für einen Mitarbeiter, ohne zu speichern */
export function berechne(
  e: Employee,
  year: number,
  month: number,
  land: Bundesland,
  entgelt?: number,
): LohnabrechnungErgebnis & { mitarbeiter: PayslipMitarbeiter } {
  const mitarbeiter = payslipMitarbeiter(e);
  const fehler = stammdatenFehler(mitarbeiter);
  if (fehler) return { ok: false, grund: "ungueltig", meldung: fehler, mitarbeiter };
  const r = lohnabrechnung({ jahr: year, monat: month, stammdaten: mitarbeiter.lohn, bundesland: land, ...(entgelt ? { entgelt } : {}) });
  return r.ok ? { ...r, hinweise: [...hinweiseZuStammdaten(mitarbeiter), ...r.hinweise], mitarbeiter } : { ...r, mitarbeiter };
}

/** Spalten einer Abrechnung aus dem Ergebnis der Rechnung */
function werte(r: Extract<ReturnType<typeof berechne>, { ok: true }>) {
  return {
    mitarbeiter: r.mitarbeiter,
    bestandteile: r.bestandteile,
    brutto: r.brutto,
    steuerBrutto: r.steuerBrutto,
    svBrutto: r.svBrutto,
    pauschalBrutto: r.pauschalBrutto,
    lohnsteuer: r.lohnsteuer,
    soli: r.soli,
    kirchensteuer: r.kirchensteuer,
    svArbeitnehmer: r.sv.arbeitnehmer,
    svArbeitgeber: r.sv.arbeitgeber,
    pauschsteuer: r.sv.pauschsteuer,
    sv: r.sv,
    netto: r.netto,
    auszahlung: r.auszahlung,
    steuertage: r.steuertage,
    svTage: r.svTage,
    stufe: r.stufe,
    gegenpruefen: r.gegenpruefen,
    hinweise: r.hinweise,
  };
}

/** Mitarbeiter, die im Monat beschäftigt sind */
async function beschaeftigteImMonat(year: number, month: number, q: Db | Tx, forUpdate = false): Promise<Employee[]> {
  const { erster, letzter } = monatsgrenzen(year, month);
  const query = q
    .select()
    .from(schema.employees)
    .where(and(lte(schema.employees.eintritt, letzter), or(isNull(schema.employees.austritt), gte(schema.employees.austritt, erster))))
    .orderBy(asc(schema.employees.personalnummer));
  return forUpdate ? query.for("update") : query;
}

async function payslipsImMonat(year: number, month: number, q: Db | Tx) {
  const rows = await q
    .select({ p: schema.payslips, storno: schema.payslipCancellations })
    .from(schema.payslips)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, schema.payslips.id))
    .where(and(eq(schema.payslips.year, year), eq(schema.payslips.month, month)))
    .orderBy(asc(schema.payslips.createdAt));
  return rows.map((r) => ({ ...r.p, storno: r.storno }));
}

export type PayslipMitStorno = Awaited<ReturnType<typeof payslipsImMonat>>[number];

/** Die nicht stornierte Abrechnung des Mitarbeiters im Monat und die zuletzt stornierte ohne neue Abrechnung */
function stand(payslips: PayslipMitStorno[]) {
  const aktiv = payslips.find((p) => !p.storno) ?? null;
  const ersetzt = new Set(payslips.map((p) => p.replacesId).filter(Boolean));
  const offenStorniert = payslips.filter((p) => p.storno && !ersetzt.has(p.id)).at(-1) ?? null;
  return { aktiv, offenStorniert };
}

/**
 * Übersicht eines Monats: je beschäftigtem Mitarbeiter (und jedem mit Abrechnung im Monat) die Abrechnungen, und wo
 * keine aktive besteht, was die Rechnung jetzt ergäbe oder warum sie nicht geht
 */
export async function monatsuebersicht(year: number, month: number) {
  const [company, employees, payslips, [run]] = await Promise.all([
    loadCompany(),
    beschaeftigteImMonat(year, month, db),
    payslipsImMonat(year, month, db),
    db
      .select()
      .from(schema.payrollRuns)
      .where(and(eq(schema.payrollRuns.year, year), eq(schema.payrollRuns.month, month))),
  ]);
  // Auch wer nicht mehr beschäftigt ist, aber im Monat eine Abrechnung hat
  const ids = new Set([...employees.map((e) => e.id), ...payslips.map((p) => p.employeeId)]);
  const alle =
    ids.size > employees.length
      ? await db
          .select()
          .from(schema.employees)
          .where(inArray(schema.employees.id, [...ids]))
      : employees;
  const gebucht = await gebuchteAbrechnungen(payslips.map((p) => p.id));
  const zeilen = alle
    .sort((a, b) => a.personalnummer - b.personalnummer)
    .map((e) => {
      const eigene = payslips.filter((p) => p.employeeId === e.id);
      const { aktiv } = stand(eigene);
      const vorschau = aktiv ? null : company.bundesland ? berechne(e, year, month, company.bundesland) : null;
      return {
        employee: { id: e.id, personalnummer: e.personalnummer, name: `${e.vorname} ${e.nachname}`, art: e.art },
        payslips: eigene.map((p) => ({
          ...p,
          pdf: undefined,
          fehlend: fehlendeAngaben(p.mitarbeiter),
          veraltet: !p.lockedAt && veraltet(p, e),
          gebucht: gebucht.has(p.id),
        })),
        vorschau:
          vorschau &&
          (vorschau.ok
            ? { ok: true as const, netto: vorschau.netto, brutto: vorschau.brutto }
            : { ok: false as const, grund: vorschau.grund, meldung: vorschau.meldung }),
      };
    });
  return { year, month, name: monatsname(year, month), zahltag: run?.zahltag ?? null, bundesland: company.bundesland, zeilen };
}

/** Stammdaten seit dem Entwurf geändert: der Entwurf ist neu zu rechnen, bevor er festgeschrieben wird */
function veraltet(p: Payslip, e: Employee): boolean {
  // jsonb ordnet die Schlüssel neu; verglichen wird der Inhalt
  return !isDeepStrictEqual(p.mitarbeiter, payslipMitarbeiter(e));
}

/**
 * Der Entwurf hat die Werte, die die Rechnung jetzt mit seinem Entgelt ergibt. Das Bundesland der Firma (Kirchensteuer,
 * Pflegeversicherung in Sachsen) steht nicht in der Abrechnung; ändert es sich nach dem Entwurf, fiele das sonst nicht auf.
 */
function wieGerechnet(p: Payslip, r: Extract<ReturnType<typeof berechne>, { ok: true }>): boolean {
  return Object.entries(werte(r)).every(([k, v]) => isDeepStrictEqual(p[k as keyof Payslip], v));
}

/** Lohnlauf des Monats; legt ihn an oder setzt einen geänderten Zahltag */
async function lohnlauf(tx: Tx, year: number, month: number, zahltag: string): Promise<string> {
  const [run] = await tx
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.year, year), eq(schema.payrollRuns.month, month)))
    .for("update");
  if (run) {
    if (run.zahltag !== zahltag) await tx.update(schema.payrollRuns).set({ zahltag }).where(eq(schema.payrollRuns.id, run.id));
    return run.id;
  }
  const [neu] = await tx.insert(schema.payrollRuns).values({ year, month, zahltag }).returning({ id: schema.payrollRuns.id });
  return neu!.id;
}

/**
 * Rechnet den Monat für alle Beschäftigten ohne aktive Abrechnung und legt Entwürfe an. Wer sich nicht rechnen lässt,
 * steht mit dem Grund in `fehler`; für ihn entsteht nichts.
 */
export async function abrechnen(actor: string, input: z.input<typeof abrechnenSchema>) {
  const { year, month, zahltag } = abrechnenSchema.parse(input);
  return withActor(actor, async (tx) => {
    // Zuerst die Zeilen sperren, dann schreiben (Reihenfolge der Sperren, docs/architektur.md)
    const employees = await beschaeftigteImMonat(year, month, tx, true);
    const land = await bundesland(tx);
    const payslips = await payslipsImMonat(year, month, tx);
    const runId = await lohnlauf(tx, year, month, zahltag);
    // Ein geänderter Zahltag gilt auch für die Entwürfe des Monats; festgeschriebene behalten ihren
    await tx
      .update(schema.payslips)
      .set({ zahltag, updatedAt: new Date() })
      .where(
        and(eq(schema.payslips.year, year), eq(schema.payslips.month, month), isNull(schema.payslips.lockedAt), sql`${schema.payslips.zahltag} <> ${zahltag}`),
      );
    const fehler: { name: string; meldung: string }[] = [];
    let angelegt = 0;
    for (const e of employees) {
      const { aktiv, offenStorniert } = stand(payslips.filter((p) => p.employeeId === e.id));
      if (aktiv) continue;
      const r = berechne(e, year, month, land);
      if (!r.ok) {
        fehler.push({ name: `${e.vorname} ${e.nachname}`, meldung: r.meldung });
        continue;
      }
      await tx.insert(schema.payslips).values({ runId, employeeId: e.id, year, month, zahltag, replacesId: offenStorniert?.id ?? null, ...werte(r) });
      angelegt += 1;
    }
    return { angelegt, fehler };
  });
}

/** Entwurf sperren; ein festgeschriebener ist nicht zu ändern */
async function entwurfZumAendern(tx: Tx, id: string): Promise<{ p: Payslip; e: Employee }> {
  const [p] = await tx.select().from(schema.payslips).where(eq(schema.payslips.id, id)).for("update");
  if (!p) throw new LohnError("Die Abrechnung gibt es nicht.");
  if (p.lockedAt) throw new LohnError("Die Abrechnung ist festgeschrieben; korrigieren geht nur mit Storno.");
  const [e] = await tx.select().from(schema.employees).where(eq(schema.employees.id, p.employeeId)).for("update");
  return { p, e: e! };
}

/** Rechnet einen Entwurf mit den aktuellen Stammdaten neu, auf Wunsch mit einem anderen Entgelt für diesen Monat */
export async function entwurfNeuBerechnen(actor: string, input: z.input<typeof entwurfSchema>): Promise<void> {
  const { id, entgelt } = entwurfSchema.parse(input);
  await withActor(actor, async (tx) => {
    const { p, e } = await entwurfZumAendern(tx, id);
    const r = berechne(e, p.year, p.month, await bundesland(tx), entgelt ?? undefined);
    if (!r.ok) throw new LohnError(r.meldung);
    await tx
      .update(schema.payslips)
      .set({ ...werte(r), updatedAt: new Date() })
      .where(eq(schema.payslips.id, id));
  });
}

export async function entwurfLoeschen(actor: string, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await entwurfZumAendern(tx, id);
    await tx.delete(schema.payslips).where(eq(schema.payslips.id, id));
  });
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * Schreibt einen Entwurf fest: mit PDF, danach gesperrt und versiegelt (Trigger aus 0127), und bucht ihn. Abgelehnt, wenn
 * Angaben für die Entgeltbescheinigung fehlen, die Stammdaten seit dem Entwurf geändert sind, Stufe C nicht als
 * gegengeprüft bestätigt ist oder sich die Abrechnung nicht buchen lässt.
 */
export async function festschreiben(actor: string, input: z.input<typeof festschreibenSchema>, heute: string): Promise<void> {
  const { id, gegengeprueft } = festschreibenSchema.parse(input);
  await withActor(actor, async (tx) => {
    const { p, e } = await entwurfZumAendern(tx, id);
    if (veraltet(p, e)) throw new LohnError("Die Stammdaten haben sich seit dem Entwurf geändert. Den Entwurf neu berechnen und prüfen.");
    const r = berechne(e, p.year, p.month, await bundesland(tx), p.brutto);
    if (!r.ok) throw new LohnError(r.meldung);
    if (!wieGerechnet(p, r)) {
      throw new LohnError("Mit den aktuellen Firmendaten (etwa dem Bundesland) ergibt sich ein anderes Ergebnis. Den Entwurf neu berechnen und prüfen.");
    }
    const fehlt = fehlendeAngaben(p.mitarbeiter);
    if (fehlt.length > 0) throw new LohnError(`Für die Entgeltbescheinigung fehlt: ${fehlt.join(", ")}.`);
    if (p.gegenpruefen && !gegengeprueft) {
      throw new LohnError("Abrechnungen mit Sozialversicherung erst festschreiben, wenn sie gegen ein Lohnprogramm oder die Steuerberatung gegengeprüft sind.");
    }
    const pdf = await abrechnungPdf({ ...p, gegengeprueft }, { entwurf: false, heute, q: tx });
    await tx
      .update(schema.payslips)
      .set({ pdf: Buffer.from(pdf), sha256: sha256(pdf), gegengeprueft, lockedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.payslips.id, id));
    await bucheAbrechnung(tx, p);
  });
}

/**
 * Storniert eine festgeschriebene Abrechnung und legt, wenn sich der Monat mit den aktuellen Stammdaten rechnen lässt,
 * gleich den Entwurf der neuen Abrechnung an. Gibt dessen id zurück, sonst null mit dem Grund.
 */
export async function stornieren(
  actor: string,
  input: z.input<typeof stornoSchema>,
  heute: string,
): Promise<{ entwurf: string | null; meldung: string | null }> {
  const { id, grund } = stornoSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [p] = await tx.select().from(schema.payslips).where(eq(schema.payslips.id, id)).for("update");
    if (!p) throw new LohnError("Die Abrechnung gibt es nicht.");
    if (!p.lockedAt) throw new LohnError("Ein Entwurf wird nicht storniert, sondern gelöscht oder neu berechnet.");
    const [e] = await tx.select().from(schema.employees).where(eq(schema.employees.id, p.employeeId)).for("update");
    const [schon] = await tx.select().from(schema.payslipCancellations).where(eq(schema.payslipCancellations.payslipId, id));
    if (schon) throw new LohnError("Die Abrechnung ist schon storniert.");
    const land = await bundesland(tx);
    await tx.insert(schema.payslipCancellations).values({ payslipId: id, date: heute, reason: grund });
    await bucheStorno(tx, p, heute);
    const r = berechne(e!, p.year, p.month, land);
    if (!r.ok) return { entwurf: null, meldung: r.meldung };
    const [neu] = await tx
      .insert(schema.payslips)
      .values({ runId: p.runId, employeeId: p.employeeId, year: p.year, month: p.month, zahltag: p.zahltag, replacesId: p.id, ...werte(r) })
      .returning({ id: schema.payslips.id });
    return { entwurf: neu!.id, meldung: null };
  });
}

/** Festgeschriebene Abrechnungen eines Mitarbeiters im Jahr, mit Storno, nach Monat */
export async function abrechnungenDesJahres(employeeId: string, year: number, q: Db | Tx = db) {
  const rows = await q
    .select({ p: schema.payslips, storno: schema.payslipCancellations })
    .from(schema.payslips)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, schema.payslips.id))
    .where(and(eq(schema.payslips.employeeId, employeeId), eq(schema.payslips.year, year), sql`${schema.payslips.lockedAt} is not null`))
    .orderBy(asc(schema.payslips.month), asc(schema.payslips.createdAt));
  return rows.map((r) => ({ ...r.p, storno: r.storno }));
}

export async function getPayslip(id: string, q: Db | Tx = db): Promise<Payslip | null> {
  const [row] = await q.select().from(schema.payslips).where(eq(schema.payslips.id, id));
  return row ?? null;
}
