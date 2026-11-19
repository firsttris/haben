import { lohnsteuerbescheinigung, lstbFrist, lstbWerteGleich, type LstbAbrechnung, type LstbErgebnis } from "@haben/core";
import { lstbOhneSchnittstelle } from "@haben/elster";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";

/*
 * Stand der Lohnsteuerbescheinigungen (bescheinigung.ts): je Mitarbeiter und Jahr die Werte aus den festgeschriebenen
 * Abrechnungen, was übermittelt ist und was als Nächstes ginge.
 */

type Submission = typeof schema.lstbSubmissions.$inferSelect;

/** Übermittelt: über ERiC echt gesendet oder im Portal vermerkt */
export const uebermittelt = (s: Pick<Submission, "kind" | "ok">) => (s.kind === "send" && s.ok) || s.kind === "portal";

async function abrechnungenDesJahres(year: number, q: Db | Tx) {
  const p = schema.payslips;
  return q
    .select({
      employeeId: p.employeeId,
      month: p.month,
      zahltag: p.zahltag,
      mitarbeiter: p.mitarbeiter,
      steuerBrutto: p.steuerBrutto,
      svBrutto: p.svBrutto,
      lohnsteuer: p.lohnsteuer,
      soli: p.soli,
      kirchensteuer: p.kirchensteuer,
      sv: p.sv,
      locked: sql<boolean>`${p.lockedAt} is not null`,
    })
    .from(p)
    .leftJoin(schema.payslipCancellations, eq(schema.payslipCancellations.payslipId, p.id))
    .where(and(eq(p.year, year), isNull(schema.payslipCancellations.id)))
    .orderBy(asc(p.month), asc(p.createdAt));
}

async function verlauf(year: number, q: Db | Tx, employeeId?: string) {
  const s = schema.lstbSubmissions;
  return q
    .select()
    .from(s)
    .where(and(eq(s.year, year), employeeId ? eq(s.employeeId, employeeId) : undefined))
    .orderBy(asc(s.createdAt));
}

export type LstbStatus = "bereit" | "uebermittelt" | "abweichend" | "storniert" | LstbErgebnis["status"];

export interface LstbMitarbeiter {
  id: string;
  name: string;
  personalnummer: number;
  ergebnis: LstbErgebnis;
  /** Zuletzt übermittelte Bescheinigung (auch ein Storno); null ohne */
  aktuell: Submission | null;
  status: LstbStatus;
  /** Was als Nächstes zu übermitteln wäre */
  naechste: "neu" | "korrektur" | null;
  /** Gibt es einen Ausdruck (übermittelt) oder einen Entwurf davon? */
  ausdruck: "entwurf" | "uebermittelt" | null;
  verlauf: Submission[];
}

function stand(ergebnis: LstbErgebnis, verlaufListe: Submission[]): Pick<LstbMitarbeiter, "aktuell" | "status" | "naechste"> {
  const aktuell = verlaufListe.filter(uebermittelt).at(-1) ?? null;
  if (aktuell && aktuell.art !== "storno") {
    const abweichend = ergebnis.status === "bereit" && aktuell.werte !== null && !lstbWerteGleich(ergebnis.werte, aktuell.werte);
    return { aktuell, status: abweichend ? "abweichend" : "uebermittelt", naechste: abweichend ? "korrektur" : null };
  }
  const naechste = ergebnis.status === "bereit" ? "neu" : null;
  if (aktuell) return { aktuell, status: "storniert", naechste };
  return { aktuell, status: ergebnis.status, naechste };
}

/** Alle Mitarbeiter mit Abrechnungen oder Bescheinigungen im Jahr, mit Werten und Stand */
export async function lstbMitarbeiter(year: number, heute: string, q: Db | Tx = db): Promise<LstbMitarbeiter[]> {
  const [abrechnungen, alle] = await Promise.all([abrechnungenDesJahres(year, q), verlauf(year, q)]);
  const ids = [...new Set([...abrechnungen.map((a) => a.employeeId), ...alle.map((s) => s.employeeId)])];
  if (ids.length === 0) return [];
  const employees = await q.select().from(schema.employees).where(inArray(schema.employees.id, ids)).orderBy(asc(schema.employees.personalnummer));
  return employees.map((e) => {
    const eigene = abrechnungen.filter((a) => a.employeeId === e.id);
    const ergebnis = lohnsteuerbescheinigung({
      jahr: year,
      eintritt: e.eintritt,
      austritt: e.austritt,
      abrechnungen: eigene
        .filter((a) => a.locked)
        .map(
          (a): LstbAbrechnung => ({
            monat: a.month,
            zahltag: a.zahltag,
            stammdaten: a.mitarbeiter.lohn,
            steuerBrutto: a.steuerBrutto,
            svBrutto: a.svBrutto,
            lohnsteuer: a.lohnsteuer,
            soli: a.soli,
            kirchensteuer: a.kirchensteuer,
            sv: a.sv,
          }),
        ),
      entwuerfe: eigene.filter((a) => !a.locked).map((a) => a.month),
      heute,
    });
    const eigenerVerlauf = alle.filter((s) => s.employeeId === e.id);
    const s = { ergebnis, ...stand(ergebnis, eigenerVerlauf), verlauf: eigenerVerlauf };
    const quelle = ausdruckQuelle(s);
    return {
      id: e.id,
      name: `${e.vorname} ${e.nachname}`,
      personalnummer: e.personalnummer,
      ...s,
      ausdruck: !quelle ? null : quelle.uebermittlung ? "uebermittelt" : "entwurf",
    };
  });
}

/** Ein Jahr: Frist, ob ERiC es kann, was in den Firmendaten fehlt, und je Mitarbeiter der Stand */
export async function lstbUebersicht(year: number, heute: string) {
  const [company, mitarbeiter] = await Promise.all([loadCompany(), lstbMitarbeiter(year, heute)]);
  const firma = companyIssues(company);
  if (!company.finanzamt.trim()) firma.push("Name des Finanzamts fehlt");
  return { year, frist: lstbFrist(year, company.bundesland), ohneSchnittstelle: lstbOhneSchnittstelle(year), firmenfehler: firma, mitarbeiter };
}

/**
 * Jahre mit festgeschriebenen Abrechnungen und ob alle nötigen Bescheinigungen übermittelt sind (für die Fristen). Eine
 * stornierte zählt als erledigt: Storniert wird, was nicht hätte übermittelt werden dürfen.
 */
export async function lstbJahre(heute: string): Promise<{ year: number; erledigt: boolean }[]> {
  const p = schema.payslips;
  const jahre = await db.selectDistinct({ year: p.year }).from(p).where(isNotNull(p.lockedAt)).orderBy(asc(p.year));
  const result = [];
  for (const { year } of jahre) {
    const noetig = (await lstbMitarbeiter(year, heute)).filter((m) => m.ergebnis.status !== "keine" || m.aktuell);
    if (noetig.length > 0) result.push({ year, erledigt: noetig.every((m) => m.status === "uebermittelt" || m.status === "storniert") });
  }
  return result;
}

/**
 * Was der Ausdruck zeigt: die zuletzt übermittelte Bescheinigung mit Transferticket, nach einem Storno mit Vermerk; vor
 * der Übermittlung einen Entwurf aus den aktuellen Werten (ohne Angaben, die liest lstbAusdruck erst beim Erzeugen);
 * null ohne Werte, etwa nach einem Vermerk ohne Werte aus Haben.
 */
export function ausdruckQuelle(m: Pick<LstbMitarbeiter, "aktuell" | "ergebnis" | "verlauf">) {
  const letzte = m.verlauf.filter((s) => uebermittelt(s) && s.art !== "storno").at(-1);
  const storno = m.aktuell?.art === "storno" ? m.aktuell : null;
  if (letzte?.werte && (m.aktuell === letzte || storno)) {
    const u = storno ?? letzte;
    const uebermittlung = { datum: u.datum, transferTicket: u.transferTicket ?? "", korrektur: letzte.art === "korrektur", storniert: Boolean(storno) };
    return { werte: letzte.werte, angaben: letzte.angaben, uebermittlung };
  }
  if (!m.aktuell && m.ergebnis.status === "bereit") return { werte: m.ergebnis.werte, angaben: null, uebermittlung: null };
  return null;
}
