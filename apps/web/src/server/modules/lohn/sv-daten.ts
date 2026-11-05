import type { SvAbrechnung, SvPerson } from "@haben/core";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { payslipMitarbeiter } from "./employees.ts";

/*
 * Was die Ausfüllliste für das SV-Meldeportal (Modul sv-meldungen) aus dem Lohn braucht, nur lesend: Mitarbeiter mit
 * ihren aktuellen Stammdaten, festgeschriebene und nicht stornierte Abrechnungen mit dem Stand, mit dem sie gerechnet
 * sind, und die Zahltage der Lohnläufe.
 */

export interface SvMitarbeiter {
  id: string;
  person: SvPerson;
}

export interface SvLohnDaten {
  mitarbeiter: SvMitarbeiter[];
  abrechnungen: (SvAbrechnung & { employeeId: string })[];
  zahltage: string[];
  /** Monat des ersten Lohnlaufs in Haben, JJJJ-MM; null ohne Lohnlauf */
  ersterLohnlauf: string | null;
}

export async function svLohnDaten(q: Db | Tx = db): Promise<SvLohnDaten> {
  const [employees, payslips, runs] = await Promise.all([
    q.select().from(schema.employees).orderBy(asc(schema.employees.personalnummer)),
    q
      // Ohne PDF: nur die Spalten, die die Liste braucht
      .select({
        employeeId: schema.payslips.employeeId,
        year: schema.payslips.year,
        month: schema.payslips.month,
        mitarbeiter: schema.payslips.mitarbeiter,
        svBrutto: schema.payslips.svBrutto,
        sv: schema.payslips.sv,
      })
      .from(schema.payslips)
      .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, schema.payslips.id))
      .where(and(isNotNull(schema.payslips.lockedAt), isNull(schema.payslipCancellations.id)))
      .orderBy(asc(schema.payslips.year), asc(schema.payslips.month)),
    q.select({ zahltag: schema.payrollRuns.zahltag, year: schema.payrollRuns.year, month: schema.payrollRuns.month }).from(schema.payrollRuns),
  ]);
  return {
    mitarbeiter: employees.map((e) => ({ id: e.id, person: payslipMitarbeiter(e) })),
    abrechnungen: payslips.map((p) => ({
      employeeId: p.employeeId,
      jahr: p.year,
      monat: p.month,
      person: p.mitarbeiter,
      svBrutto: p.svBrutto,
      sv: p.sv,
    })),
    zahltage: runs.map((r) => r.zahltag),
    ersterLohnlauf: runs.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`).sort()[0] ?? null,
  };
}
