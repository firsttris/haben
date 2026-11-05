import {
  lohnsteuerbescheinigung,
  lstbFrist,
  lstbKmId,
  lstbWerteGleich,
  toElsterSteuernummer,
  type LstbAbrechnung,
  type LstbErgebnis,
  type LstbWerte,
} from "@haben/core";
import { buildLstbAusdruckPdf } from "@haben/einvoice";
import { buildLStBStornoXml, buildLStBXml, lstbOhneSchnittstelle, type ElsterClient, type ElsterResult, type LStBAnweisung } from "@haben/elster";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { LstbAngaben } from "../../db/schema.ts";
import { ericKennt, PRODUKT_VERSION, uebermitteln, type ElsterVorgang } from "../elster/index.ts";
import { companyIssues, loadCompany } from "../stammdaten/index.ts";
import { LohnError } from "./employees.ts";

/*
 * Elektronische Lohnsteuerbescheinigung (§ 41b EStG, docs/lohn-plan.md PR 7) je Arbeitnehmer und Jahr aus den
 * festgeschriebenen, nicht stornierten Abrechnungen; gerechnet wird in `lohnsteuerbescheinigung` (@haben/core).
 *
 * Übermitteln: über ERiC nur für Jahre, deren Schnittstelle im ERiC-Paket liegt (bis 2025 ElsterLohn, lstb.ts in
 * @haben/elster). Ab 2026 gilt die Datenart LSTMitteilung (ElsterKMV), deren Schema Haben nicht hat; dann übermittelt der
 * Nutzer im ELSTER-Portal und vermerkt hier Tag und Transferticket. Beides landet in lstb_submissions (nur anhängen).
 * Korrektur und Storno verweisen auf die zuletzt übermittelte Bescheinigung (§ 93c Abs. 3 AO).
 */

const jahr = z.number().int().min(2000).max(2100);

export const lstbSubmitSchema = z.object({ employeeId: z.uuid(), year: jahr, kind: z.enum(["validate", "test", "send"]), pin: z.string().max(64).optional() });
export const lstbStornoSchema = lstbSubmitSchema.extend({ grund: z.string().trim().max(500).default("") });
export const lstbVermerkSchema = z.object({
  employeeId: z.uuid(),
  year: jahr,
  art: z.enum(["neu", "korrektur", "storno"]),
  datum: z.iso.date("Datum im Format JJJJ-MM-TT"),
  transferTicket: z.string().trim().min(1, "Das Transferticket fehlt.").max(100),
  grund: z.string().trim().max(500).default(""),
});

type Submission = typeof schema.lstbSubmissions.$inferSelect;

/** Übermittelt: über ERiC echt gesendet oder im Portal vermerkt */
const uebermittelt = (s: Pick<Submission, "kind" | "ok">) => (s.kind === "send" && s.ok) || s.kind === "portal";

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

async function angaben(employeeId: string, year: number, q: Db | Tx): Promise<LstbAngaben> {
  const company = await loadCompany(q);
  const fehler = companyIssues(company);
  if (!company.finanzamt.trim()) fehler.push("Name des Finanzamts fehlt");
  if (fehler.length > 0) throw new LohnError(`Firmendaten: ${fehler.join(", ")}.`);
  // Die Angaben zur Person aus der letzten festgeschriebenen Abrechnung des Jahres, wie im Lohnkonto
  const p = schema.payslips;
  const [letzte] = await q
    .select({ mitarbeiter: p.mitarbeiter })
    .from(p)
    .where(and(eq(p.employeeId, employeeId), eq(p.year, year), isNotNull(p.lockedAt)))
    .orderBy(sql`${p.month} desc`, sql`${p.createdAt} desc`)
    .limit(1);
  if (!letzte) throw new LohnError(`Für ${year} ist keine Abrechnung festgeschrieben.`);
  const m = letzte.mitarbeiter;
  return {
    arbeitnehmer: {
      idnr: m.steuerId,
      ordnungsmerkmal: String(m.personalnummer),
      vorname: m.vorname,
      nachname: m.nachname,
      geburtsdatum: m.geburtsdatum,
      strasse: m.strasse,
      plz: m.plz,
      ort: m.ort,
    },
    arbeitgeber: {
      name: company.name,
      steuernummer13: toElsterSteuernummer(company.steuernummer, company.bundesland!),
      finanzamt: company.finanzamt.trim(),
      bundesland: company.bundesland!,
      strasse: company.strasse,
      plz: company.plz,
      ort: company.ort,
    },
  };
}

async function mitarbeiterStand(employeeId: string, year: number, heute: string, q: Db | Tx): Promise<LstbMitarbeiter> {
  const m = (await lstbMitarbeiter(year, heute, q)).find((x) => x.id === employeeId);
  if (!m) throw new LohnError(`Für ${year} gibt es keine Abrechnung dieses Mitarbeiters.`);
  return m;
}

const sperre = (employeeId: string, year: number) => `haben.lstb.${employeeId}.${year}`;
const nummer = (m: LstbMitarbeiter) => m.verlauf.filter(uebermittelt).length + 1;

/** Nach Ablauf der Frist ist bei einer Korrektur der Grund anzugeben (Kommentar im Beispiel ELO_DatenLieferung_LStB_202501_Korrektur.xml) */
const korrekturGrund = (year: number, heute: string) => (heute >= `${year + 1}-03-01` ? ("Einfache Berichtigung" as const) : undefined);

function nichtUeberEric(year: number) {
  const ohne = lstbOhneSchnittstelle(year);
  if (ohne) throw new LohnError(`${ohne} Übermittle sie im ELSTER-Portal und vermerke sie hier.`);
  // Das Plugin checkElsterLohn hat kein Jahr; fehlt es dem geladenen ERiC, gar nicht erst senden
  if (!ericKennt("ElsterLohn"))
    throw new LohnError("Das geladene ERiC kennt das Verfahren ElsterLohn nicht; unter Einstellungen › ELSTER eine andere Version laden.");
}

export interface LstbSubmitOptions {
  kind: ElsterVorgang;
  employeeId: string;
  year: number;
  pin?: string;
  herstellerId?: string;
  heute: string;
}

interface Vorbereitet {
  art: "neu" | "korrektur" | "storno";
  kmId: string;
  refKmId: string | null;
  werte: LstbWerte | null;
  angaben: LstbAngaben;
}

function protokoll(actor: string, options: LstbSubmitOptions, grund = "") {
  return (result: ElsterResult, xml: string, v: Vorbereitet) =>
    withActor(actor, (tx) =>
      tx.insert(schema.lstbSubmissions).values({
        employeeId: options.employeeId,
        year: options.year,
        art: v.art,
        kind: options.kind,
        kmId: v.kmId,
        refKmId: v.refKmId,
        werte: v.werte,
        angaben: v.angaben,
        datum: options.heute,
        grund,
        ok: result.ok,
        code: result.code,
        message: result.message,
        transferTicket: result.transferTicket ?? null,
        requestXml: xml,
        responseXml: result.responseXml,
        serverResponseXml: result.serverResponseXml,
        protocolPdf: result.pdf ? Buffer.from(result.pdf) : null,
      }),
    );
}

/**
 * Prüft oder übermittelt die Bescheinigung eines Mitarbeiters über ERiC: neu, oder als Korrektur der zuletzt übermittelten,
 * wenn die Abrechnungen inzwischen andere Werte ergeben. Stimmen sie überein, gibt es nichts zu senden.
 */
export function submitLstb(actor: string, client: ElsterClient, options: LstbSubmitOptions): Promise<ElsterResult> {
  const { employeeId, year, heute } = options;
  return uebermitteln(client, {
    sperre: sperre(employeeId, year),
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    // ElsterLohn kennt keinen PDF-Druck (ERiC-Entwicklerhandbuch, Tabelle 9-15)
    print: false,
    vorbereiten: async ({ test, herstellerId }) => {
      nichtUeberEric(year);
      const m = await mitarbeiterStand(employeeId, year, heute, db);
      if (m.ergebnis.status !== "bereit") throw new LohnError(m.ergebnis.meldung);
      if (!m.naechste) throw new LohnError("Die Bescheinigung ist übermittelt und stimmt mit den Abrechnungen überein; es gibt nichts zu korrigieren.");
      const a = await angaben(employeeId, year, db);
      const werte = m.ergebnis.werte;
      const km = {
        jahr: year,
        idnr: a.arbeitnehmer.idnr,
        von: werte.von,
        bis: werte.bis,
        steuernummer13: a.arbeitgeber.steuernummer13,
        ordnungsmerkmal: a.arbeitnehmer.ordnungsmerkmal,
      };
      let anweisung: LStBAnweisung;
      if (m.naechste === "neu") {
        anweisung = { art: "Neu", kmId: lstbKmId({ ...km, art: "Neu", nummer: nummer(m) }) };
      } else {
        const ref = m.aktuell?.kmId;
        if (!ref) throw new LohnError("Die Bescheinigung wurde im ELSTER-Portal übermittelt; korrigiere sie dort und vermerke die Korrektur hier.");
        anweisung = {
          art: "Korrektur",
          kmId: lstbKmId({ ...km, art: "Korrektur", nummer: nummer(m) }),
          refKmId: ref,
          korrekturGrund: korrekturGrund(year, heute),
        };
      }
      const xml = buildLStBXml({ anweisung, werte, ...a, herstellerId, produktVersion: PRODUKT_VERSION, test });
      return {
        xml,
        daten: {
          art: m.naechste,
          kmId: anweisung.kmId,
          refKmId: anweisung.art === "Korrektur" ? anweisung.refKmId : null,
          werte,
          angaben: a,
        } satisfies Vorbereitet,
      };
    },
    protokollieren: protokoll(actor, options),
  });
}

/** Storniert die zuletzt über ERiC übermittelte Bescheinigung (LStBStorno) */
export function stornoLstb(actor: string, client: ElsterClient, options: LstbSubmitOptions & { grund: string }): Promise<ElsterResult> {
  const { employeeId, year, heute } = options;
  return uebermitteln(client, {
    sperre: sperre(employeeId, year),
    vorgang: options.kind,
    herstellerId: options.herstellerId,
    pin: options.pin,
    print: false,
    vorbereiten: async ({ test, herstellerId }) => {
      nichtUeberEric(year);
      const m = await mitarbeiterStand(employeeId, year, heute, db);
      const aktuell = m.aktuell;
      if (!aktuell || aktuell.art === "storno") throw new LohnError("Es gibt keine übermittelte Bescheinigung, die sich stornieren ließe.");
      if (!aktuell.kmId) throw new LohnError("Die Bescheinigung wurde im ELSTER-Portal übermittelt; storniere sie dort und vermerke das Storno hier.");
      const a = aktuell.angaben;
      const kmId = lstbKmId({
        jahr: year,
        idnr: a.arbeitnehmer.idnr,
        von: aktuell.werte?.von ?? `${year}-01-01`,
        bis: aktuell.werte?.bis ?? `${year}-12-31`,
        steuernummer13: a.arbeitgeber.steuernummer13,
        ordnungsmerkmal: a.arbeitnehmer.ordnungsmerkmal,
        art: "Storno",
        nummer: nummer(m),
      });
      const xml = buildLStBStornoXml({
        kmId,
        refKmId: aktuell.kmId,
        jahr: year,
        idnr: a.arbeitnehmer.idnr,
        ordnungsmerkmal: a.arbeitnehmer.ordnungsmerkmal,
        arbeitgeber: a.arbeitgeber,
        herstellerId,
        produktVersion: PRODUKT_VERSION,
        test,
      });
      return { xml, daten: { art: "storno", kmId, refKmId: aktuell.kmId, werte: null, angaben: a } satisfies Vorbereitet };
    },
    protokollieren: protokoll(actor, options, options.grund),
  });
}

/**
 * Vermerkt eine im ELSTER-Portal übermittelte Bescheinigung, Korrektur oder Stornierung mit Tag und Transferticket. Neu und
 * Korrektur halten die Werte fest, die Haben gerade rechnet; kann Haben für den Mitarbeiter nicht bescheinigen („nicht
 * unterstützt“), steht die Bescheinigung ohne Werte im Verlauf.
 */
export async function vermerkeLstb(actor: string, input: z.input<typeof lstbVermerkSchema>, heute: string): Promise<void> {
  const v = lstbVermerkSchema.parse(input);
  if (v.datum > heute) throw new LohnError("Der Tag der Übermittlung liegt in der Zukunft.");
  await withActor(actor, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sperre(v.employeeId, v.year)}))`);
    const m = await mitarbeiterStand(v.employeeId, v.year, heute, tx);
    const offen = !m.aktuell || m.aktuell.art === "storno";
    let werte: LstbWerte | null = null;
    if (v.art === "neu") {
      if (!offen) throw new LohnError("Für das Jahr ist schon eine Bescheinigung übermittelt; vermerke eine Korrektur oder ein Storno.");
      if (m.ergebnis.status === "bereit") werte = m.ergebnis.werte;
      else if (m.ergebnis.status !== "nicht-unterstuetzt") throw new LohnError(m.ergebnis.meldung);
    } else {
      if (offen) throw new LohnError("Es gibt keine übermittelte Bescheinigung, die sich korrigieren oder stornieren ließe.");
      if (v.art === "korrektur") {
        if (m.ergebnis.status === "bereit") werte = m.ergebnis.werte;
        else if (m.ergebnis.status !== "nicht-unterstuetzt") throw new LohnError(m.ergebnis.meldung);
      }
    }
    await tx.insert(schema.lstbSubmissions).values({
      employeeId: v.employeeId,
      year: v.year,
      art: v.art,
      kind: "portal",
      kmId: null,
      refKmId: v.art === "neu" ? null : (m.aktuell?.kmId ?? null),
      werte,
      angaben: m.aktuell?.angaben ?? (await angaben(v.employeeId, v.year, tx)),
      datum: v.datum,
      grund: v.grund,
      ok: true,
      code: 0,
      message: "Im ELSTER-Portal übermittelt",
      transferTicket: v.transferTicket,
      requestXml: "",
      responseXml: "",
      serverResponseXml: "",
    });
  });
}

const dateiname = (name: string) => name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/**
 * Was der Ausdruck zeigt: die zuletzt übermittelte Bescheinigung mit Transferticket, nach einem Storno mit Vermerk; vor
 * der Übermittlung einen Entwurf aus den aktuellen Werten (ohne Angaben, die liest lstbAusdruck erst beim Erzeugen);
 * null ohne Werte, etwa nach einem Vermerk ohne Werte aus Haben.
 */
function ausdruckQuelle(m: Pick<LstbMitarbeiter, "aktuell" | "ergebnis" | "verlauf">) {
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

/** Ausdruck für den Arbeitnehmer nach amtlichem Muster (§ 41b Abs. 1 Satz 3 EStG) als PDF, oder sein Entwurf */
export async function lstbAusdruck(employeeId: string, year: number, heute: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const m = (await lstbMitarbeiter(year, heute)).find((x) => x.id === employeeId);
  const quelle = m && ausdruckQuelle(m);
  if (!m || !quelle) return null;
  const doc = { ...quelle, angaben: quelle.angaben ?? (await angaben(employeeId, year, db)), heute };
  const filename = `Lohnsteuerbescheinigung-${year}-${dateiname(m.name)}${doc.uebermittlung ? "" : "-Entwurf"}.pdf`;
  return { pdf: buildLstbAusdruckPdf(doc), filename };
}
