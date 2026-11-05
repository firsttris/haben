import { BESCHAEFTIGUNGSARTEN, isKapitalgesellschaft, KONFESSIONEN, type Beschaeftigungsart, type Konfession, type LohnStammdaten } from "@haben/core";
import { isValidIban, isValidIdnr } from "@haben/elster";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import type { PayslipMitarbeiter } from "../../db/schema.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * Stammdaten der Mitarbeiter (Lohn, docs/lohn-plan.md PR 3): Person, Lohnsteuerabzugsmerkmale (ELStAM, von Hand aus
 * dem ELSTER-Portal), Sozialversicherung und Gehalt. Änderbar; eine Abrechnung hält den Stand fest, mit dem sie
 * gerechnet ist. Die Merkmale sind die, die § 4 Abs. 1 LStDV für das Lohnkonto und § 1 Abs. 1 EntgBV für die
 * Entgeltbescheinigung verlangen.
 */

export class LohnError extends UserError {}

export type Employee = typeof schema.employees.$inferSelect;

const isoDate = z.iso.date("Datum im Format JJJJ-MM-TT");
const cents = (label: string) =>
  z
    .number({ error: `${label} fehlt` })
    .int(`${label} in Cent`)
    .min(0, `${label} darf nicht negativ sein`)
    .max(10_000_000_00);
const basisPoints = (label: string) =>
  z
    .number({ error: `${label} fehlt` })
    .int(`${label} in Basispunkten`)
    .min(0)
    .max(10_000);
const digits = (n: number, label: string) =>
  z
    .string()
    .trim()
    .refine((s) => s === "" || new RegExp(`^\\d{${n}}$`).test(s), `${label} hat ${n} Ziffern`);

export const employeeSchema = z
  .object({
    vorname: z.string().trim().min(1, "Vorname fehlt").max(100),
    nachname: z.string().trim().min(1, "Nachname fehlt").max(100),
    strasse: z.string().trim().max(200).default(""),
    plz: z.string().trim().max(10).default(""),
    ort: z.string().trim().max(100).default(""),
    geburtsdatum: isoDate,
    steuerId: z
      .string()
      .trim()
      .refine((s) => s === "" || isValidIdnr(s), "Die Steuer-ID ist ungültig (11 Ziffern mit Prüfziffer)")
      .default(""),
    steuerklasse: z.number().int().min(1, "Steuerklasse 1 bis 6").max(6, "Steuerklasse 1 bis 6"),
    faktor: z.number().int().min(1, "Faktor größer 0").max(1000, "Faktor höchstens 1,000").default(1000),
    kinderfreibetraege: z
      .number()
      .int()
      .min(0)
      .max(20_000)
      .refine((n) => n % 500 === 0, "Kinderfreibeträge in Schritten von 0,5")
      .default(0),
    konfession: z
      .enum(Object.keys(KONFESSIONEN) as [Konfession, ...Konfession[]])
      .nullable()
      .default(null),
    art: z.enum(Object.keys(BESCHAEFTIGUNGSARTEN) as [Beschaeftigungsart, ...Beschaeftigungsart[]]),
    monatsgehalt: cents("Monatsgehalt").min(1, "Monatsgehalt fehlt"),
    krankenversicherung: z.enum(["gesetzlich", "privat"]).default("gesetzlich"),
    krankenkasse: z.string().trim().max(100).default(""),
    krankenkasseBetriebsnummer: digits(8, "Die Betriebsnummer der Krankenkasse").default(""),
    zusatzbeitrag: basisPoints("Zusatzbeitrag").default(0),
    pkvBasisbeitrag: cents("Beitrag zur privaten Basisabsicherung").default(0),
    pkvZuschuss: cents("Zuschuss zur privaten Versicherung").default(0),
    kinderlosenzuschlag: z.boolean().default(false),
    kinderUnter25: z.number().int().min(0).max(20).default(0),
    u1Satz: basisPoints("U1").nullable().default(null),
    u2Satz: basisPoints("U2").default(0),
    rvBefreit: z.boolean().default(false),
    pauschsteuer: z.boolean().default(true),
    personengruppe: digits(3, "Der Personengruppenschlüssel").default(""),
    beitragsgruppen: digits(4, "Der Beitragsgruppenschlüssel").default(""),
    taetigkeitsschluessel: digits(9, "Der Tätigkeitsschlüssel").default(""),
    svNummer: z
      .string()
      .trim()
      .toUpperCase()
      .refine((s) => s === "" || /^\d{8}[A-Z]\d{3}$/.test(s), "Die Versicherungsnummer hat 12 Stellen (8 Ziffern, Buchstabe, 3 Ziffern)")
      .default(""),
    statusfeststellung: z.enum(["", "beantragt", "versicherungsfrei", "versicherungspflichtig"]).default(""),
    eintritt: isoDate,
    austritt: isoDate.nullable().default(null),
    iban: z
      .string()
      .transform((s) => s.replace(/\s+/g, "").toUpperCase())
      .refine((s) => s === "" || isValidIban(s), "Die IBAN ist ungültig")
      .default(""),
  })
  .refine((e) => e.austritt === null || e.austritt >= e.eintritt, { message: "Der Austritt liegt vor dem Eintritt", path: ["austritt"] })
  .refine((e) => e.steuerklasse === 4 || e.faktor === 1000, { message: "Einen Faktor gibt es nur in Steuerklasse IV", path: ["faktor"] })
  .refine((e) => !(e.kinderlosenzuschlag && e.kinderUnter25 > 0), {
    message: "Mit Kindern fällt kein Zuschlag für Kinderlose an",
    path: ["kinderlosenzuschlag"],
  });

export type EmployeeInput = z.input<typeof employeeSchema>;

export async function listEmployees(q: Db | Tx = db): Promise<Employee[]> {
  return q.select().from(schema.employees).orderBy(asc(schema.employees.personalnummer));
}

export async function getEmployee(id: string, q: Db | Tx = db): Promise<Employee | null> {
  const [row] = await q.select().from(schema.employees).where(eq(schema.employees.id, id));
  return row ?? null;
}

/** Legt einen Mitarbeiter an (id null) oder ändert ihn; gibt die id zurück */
export async function saveEmployee(actor: string, id: string | null, input: EmployeeInput): Promise<string> {
  const data = employeeSchema.parse(input);
  // Wie die Buchung (lohnBuchung in @haben/core): im Einzelunternehmen ist der Lohn des Inhabers eine Entnahme. Ein
  // Bestand aus der Zeit vor der Rechtsform bleibt änderbar, etwa für den Austritt; das Formular bietet seine Art weiter an.
  if (data.art === "ggf" && !isKapitalgesellschaft((await loadCompany()).rechtsform) && (!id || (await getEmployee(id))?.art !== "ggf")) {
    throw new LohnError("Einen Gesellschafter-Geschäftsführer gibt es nur in GmbH und UG; im Einzelunternehmen ist der Lohn des Inhabers eine Entnahme.");
  }
  return withActor(actor, async (tx) => {
    if (id) {
      const [row] = await tx
        .update(schema.employees)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.employees.id, id))
        .returning({ id: schema.employees.id });
      if (!row) throw new LohnError("Den Mitarbeiter gibt es nicht.");
      return row.id;
    }
    // Personalnummern fortlaufend; nacheinander, damit zwei gleichzeitige Anlagen nicht dieselbe ziehen
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.personalnummer'))`);
    const [last] = await tx.select({ n: sql<number>`coalesce(max(${schema.employees.personalnummer}), 0)::int` }).from(schema.employees);
    const [row] = await tx
      .insert(schema.employees)
      .values({ ...data, personalnummer: (last?.n ?? 0) + 1 })
      .returning({ id: schema.employees.id });
    return row!.id;
  });
}

/** Was die Rechnung aus den Stammdaten braucht (`lohnabrechnung` in @haben/core) */
export function lohnStammdaten(e: Employee): LohnStammdaten {
  return {
    art: e.art,
    monatsgehalt: e.monatsgehalt,
    eintritt: e.eintritt,
    austritt: e.austritt,
    steuerklasse: e.steuerklasse as LohnStammdaten["steuerklasse"],
    faktor: e.faktor,
    kinderfreibetraege: e.kinderfreibetraege,
    konfession: e.konfession,
    kv:
      e.krankenversicherung === "privat"
        ? { art: "privat", basisbeitrag: e.pkvBasisbeitrag, arbeitgeberzuschuss: e.pkvZuschuss }
        : { art: "gesetzlich", zusatzbeitrag: e.zusatzbeitrag },
    pflege: { kinderlosenzuschlag: e.kinderlosenzuschlag, kinderUnter25: e.kinderUnter25 },
    umlagen: { u1: e.u1Satz, u2: e.u2Satz },
    minijob: { rvBefreit: e.rvBefreit, pauschsteuer: e.pauschsteuer },
  };
}

/** Stand der Stammdaten, den eine Abrechnung festhält */
export function payslipMitarbeiter(e: Employee): PayslipMitarbeiter {
  return {
    personalnummer: e.personalnummer,
    vorname: e.vorname,
    nachname: e.nachname,
    strasse: e.strasse,
    plz: e.plz,
    ort: e.ort,
    geburtsdatum: e.geburtsdatum,
    steuerId: e.steuerId,
    svNummer: e.svNummer,
    krankenkasse: e.krankenkasse,
    krankenkasseBetriebsnummer: e.krankenkasseBetriebsnummer,
    personengruppe: e.personengruppe,
    beitragsgruppen: e.beitragsgruppen,
    taetigkeitsschluessel: e.taetigkeitsschluessel,
    statusfeststellung: e.statusfeststellung,
    iban: e.iban,
    lohn: lohnStammdaten(e),
  };
}

/**
 * Angaben, die für eine Entgeltbescheinigung fehlen (§ 1 Abs. 1 EntgBV): Anschrift, Steuer-ID, bei Beschäftigten mit
 * Sozialversicherung Versicherungsnummer, Beitragsgruppen und Einzugsstelle. Die Abrechnung lässt sich trotzdem rechnen;
 * festschreiben lässt Haben erst, wenn nichts fehlt.
 */
export function fehlendeAngaben(m: PayslipMitarbeiter): string[] {
  const fehlt: string[] = [];
  if (!m.strasse || !m.plz || !m.ort) fehlt.push("Anschrift");
  if (!m.steuerId) fehlt.push("Steuer-ID");
  if (m.lohn.art !== "ggf") {
    if (!m.svNummer) fehlt.push("Versicherungsnummer");
    if (!m.beitragsgruppen) fehlt.push("Beitragsgruppenschlüssel");
    if (!m.personengruppe) fehlt.push("Personengruppe");
    // Im Minijob ist die Minijob-Zentrale Einzugsstelle, sonst die Krankenkasse
    if (m.lohn.art === "beschaeftigt" && (!m.krankenkasse || !m.krankenkasseBetriebsnummer)) fehlt.push("Krankenkasse mit Betriebsnummer");
  }
  return fehlt;
}

/** Hinweise, die die Abrechnung nicht verhindern */
export function hinweiseZuStammdaten(m: PayslipMitarbeiter): string[] {
  if (m.lohn.art !== "ggf" || m.statusfeststellung === "versicherungsfrei") return [];
  if (m.statusfeststellung === "versicherungspflichtig") {
    return ["Die Statusfeststellung hat Versicherungspflicht ergeben: als sozialversicherungspflichtig Beschäftigten abrechnen."];
  }
  return [
    "Ohne Beiträge zur Sozialversicherung, solange die Statusfeststellung (§ 7a SGB IV) keine Versicherungsfreiheit ergeben hat; das Ergebnis der Clearingstelle in den Stammdaten eintragen.",
  ];
}
