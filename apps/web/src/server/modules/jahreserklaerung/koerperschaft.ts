import { abschluss, isKapitalgesellschaft, kapgSteuern, MINDEST_HEBESATZ, steuerKonten, type KapgSteuerAngaben, type KapgSteuern } from "@haben/core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { createManualEntry, ledgerRange, saldenliste } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * Körperschaft- und Gewerbesteuer einer GmbH oder UG: Angaben je Jahr (Hebesatz, Verlustvorträge laut Bescheid), die
 * Berechnung aus dem Jahresergebnis (kapgSteuern in @haben/core) und die Steuerrückstellungen als Buchung zum 31.12.
 */

export class KoerperschaftError extends UserError {}

const cents = z.number().int().min(0).max(100_000_000_000_00);

export const kapgAngabenSchema = z.object({
  hebesatz: z
    .number()
    .int("Hebesatz in ganzen Prozent")
    .min(MINDEST_HEBESATZ, `Der Hebesatz beträgt mindestens ${MINDEST_HEBESATZ} %.`)
    .max(1500, "Hebesatz bitte prüfen"),
  verlustvortragKst: cents,
  verlustvortragGewst: cents,
  verlustruecktrag: cents.default(0),
});

export type KapgAngabenInput = z.input<typeof kapgAngabenSchema>;

const isoDate = z.iso.date("Datum im Format JJJJ-MM-TT");

/** Angaben, die nur die Erklärungen brauchen: Anteilseigner, Verträge, Gründung, Einlagekonto */
export const kapgErklaerungSchema = z.object({
  gruendung: isoDate.nullable().default(null),
  einlagekonto: z.number().int().min(-100_000_000_000_00).max(100_000_000_000_00).default(0),
  rechteBeschraenktStpfl: cents.default(0),
  anteilseigner: z
    .array(
      z
        .object({
          name: z.string().trim().min(1, "Name des Anteilseigners fehlt").max(200),
          strasse: z.string().trim().min(1, "Straße des Anteilseigners fehlt").max(200),
          plzOrt: z.string().trim().min(1, "PLZ und Ort des Anteilseigners fehlen").max(200),
          idnr: z
            .string()
            .regex(/^\d{11}$/, "Identifikationsnummer mit 11 Ziffern")
            .optional(),
          steuernummer13: z
            .string()
            .regex(/^\d{13}$/, "Steuernummer im ELSTER-Format mit 13 Ziffern")
            .optional(),
          beteiligung: cents,
          /** Hundertstel Prozent */
          anteil: z.number().int().min(1).max(10_000),
          seit: isoDate.optional(),
          geaendert: z.boolean().default(false),
          /** Für den Abzug bei Ausschüttungen: Kirchensteuerabzugsmerkmal (KiStAM) vom Bundeszentralamt für Steuern */
          kirchensteuer: z.union([z.literal(0), z.literal(8), z.literal(9)]).default(0),
          religionsschluessel: z
            .string()
            .regex(/^\d{6}$/, "Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal hat sechs Ziffern")
            .optional(),
          /** Für die Steuerbescheinigung: Muster II verlangt die Religionsgemeinschaft mit Namen, nicht den Schlüssel */
          religionsgemeinschaft: z.string().trim().max(200).optional(),
        })
        .refine((a) => a.kirchensteuer === 0 || a.religionsschluessel, "Zur Kirchensteuer fehlt der Religionsschlüssel")
        .refine((a) => a.idnr || a.steuernummer13, "Identifikationsnummer oder Steuernummer des Anteilseigners fehlt"),
    )
    .max(20)
    .default([]),
  vertraege: z
    .array(
      z.object({
        art: z.string().trim().min(1, "Vertragsart fehlt").max(200),
        datum: isoDate,
        partner: z.string().trim().min(1, "Vertragspartner fehlt").max(200),
        verguetung: cents,
      }),
    )
    .max(20)
    .default([]),
});

export type KapgErklaerungAngaben = z.output<typeof kapgErklaerungSchema>;
export type KapgErklaerungInput = z.input<typeof kapgErklaerungSchema>;

/*
 * Gespeichert je Jahr als ein JSON: die Steuerangaben (Hebesatz, Vorträge) oben, die Angaben zur Erklärung unter
 * „erklaerung“. Beide Formulare speichern ihren Teil, der andere bleibt.
 */
async function storedRow(year: number): Promise<Record<string, unknown> | null> {
  const [row] = await db.select({ data: schema.corporateTaxInputs.data }).from(schema.corporateTaxInputs).where(eq(schema.corporateTaxInputs.year, year));
  return row?.data ?? null;
}

/** Unter Jahresabschluss gespeicherte Angaben des Jahres (Hebesatz, Verlustvorträge), ohne Fortschreibung aus dem Vorjahr */
export async function storedAngaben(year: number): Promise<KapgSteuerAngaben | null> {
  const row = await storedRow(year);
  const parsed = row ? kapgAngabenSchema.safeParse(row) : null;
  return parsed?.success ? parsed.data : null;
}

/** Angaben zur Erklärung des Jahres; ohne gespeicherte die des Vorjahres (Anteilseigner und Verträge bleiben meist gleich) */
export async function kapgErklaerungAngaben(year: number): Promise<{ angaben: KapgErklaerungAngaben; gespeichert: boolean }> {
  const read = async (y: number) => {
    const raw = (await storedRow(y))?.erklaerung;
    const parsed = raw ? kapgErklaerungSchema.safeParse(raw) : null;
    return parsed?.success ? parsed.data : null;
  };
  const eigene = await read(year);
  if (eigene) return { angaben: eigene, gespeichert: true };
  const vorjahr = await read(year - 1);
  // Aus dem Vorjahr: Gründung und Änderungsvermerke gelten nicht fort
  if (vorjahr)
    return { angaben: { ...vorjahr, gruendung: null, anteilseigner: vorjahr.anteilseigner.map((a) => ({ ...a, geaendert: false })) }, gespeichert: false };
  return { angaben: kapgErklaerungSchema.parse({}), gespeichert: false };
}

/**
 * Ergänzt die Angaben des Jahres um patch, in einem Schritt in der Datenbank (jsonb ||): Speichern beide Formulare
 * gleichzeitig, bleibt der Teil des anderen erhalten.
 */
async function merge(actor: string, year: number, patch: Record<string, unknown>): Promise<void> {
  await withActor(actor, (tx) =>
    tx
      .insert(schema.corporateTaxInputs)
      .values({ year, data: patch })
      .onConflictDoUpdate({
        target: schema.corporateTaxInputs.year,
        set: { data: sql`${schema.corporateTaxInputs.data} || excluded.data`, updatedAt: new Date() },
      }),
  );
}

export async function saveKapgAngaben(actor: string, year: number, input: KapgAngabenInput): Promise<void> {
  await merge(actor, year, kapgAngabenSchema.parse(input));
}

export async function saveKapgErklaerungAngaben(actor: string, year: number, input: KapgErklaerungInput): Promise<void> {
  const erklaerung = kapgErklaerungSchema.parse(input);
  if (erklaerung.gruendung && !erklaerung.gruendung.startsWith(`${year}-`)) throw new KoerperschaftError(`Das Gründungsdatum liegt nicht in ${year}.`);
  const summe = erklaerung.anteilseigner.reduce((sum, a) => sum + a.anteil, 0);
  if (erklaerung.anteilseigner.length > 0 && summe !== 10_000) {
    throw new KoerperschaftError(`Die Anteile ergeben zusammen ${(summe / 100).toLocaleString("de-DE")} %, nicht 100 %.`);
  }
  await merge(actor, year, { erklaerung });
}

/** Salden und Jahresergebnis des Jahres; null, wenn das Unternehmen keine Kapitalgesellschaft ist */
async function berechne(year: number, angaben: KapgSteuerAngaben): Promise<KapgSteuern | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const rows = (await saldenliste(ledgerRange(year))).filter((r) => r.kontenrahmen === company.kontenrahmen);
  const salden = rows.map((r) => ({ account: r.account, saldo: r.saldo }));
  return kapgSteuern(company.kontenrahmen, year, salden, abschluss(company.kontenrahmen, salden).jahresergebnis, angaben);
}

/**
 * Angaben des Jahres. Ohne gespeicherte gelten die des Vorjahres fortgeschrieben: derselbe Hebesatz, die Verlustvorträge
 * nach der Berechnung des Vorjahres. Ohne beides fehlt der Hebesatz.
 */
async function angabenFor(year: number): Promise<{ angaben: KapgSteuerAngaben | null; gespeichert: boolean }> {
  const stored = await storedAngaben(year);
  if (stored) return { angaben: stored, gespeichert: true };
  const vorjahr = await storedAngaben(year - 1);
  if (!vorjahr) return { angaben: null, gespeichert: false };
  const s = await berechne(year - 1, vorjahr);
  return {
    angaben: {
      hebesatz: vorjahr.hebesatz,
      verlustvortragKst: s?.verlustvortragKst ?? 0,
      verlustvortragGewst: s?.verlustvortragGewst ?? 0,
      verlustruecktrag: 0,
    },
    gespeichert: false,
  };
}

/** Angaben und Berechnung für die Abschluss-Seite; null für Einzelunternehmen */
export async function kapgSteuernJahr(year: number): Promise<{
  angaben: KapgSteuerAngaben | null;
  gespeichert: boolean;
  steuern: KapgSteuern | null;
  konten: ReturnType<typeof steuerKonten>;
} | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) return null;
  const { angaben, gespeichert } = await angabenFor(year);
  return { angaben, gespeichert, steuern: angaben ? await berechne(year, angaben) : null, konten: steuerKonten(company.kontenrahmen) };
}

/**
 * Bucht die noch fehlenden Steuerrückstellungen zum 31.12. als Umbuchung: Körperschaftsteuer und Solidaritätszuschlag
 * an Körperschaftsteuerrückstellung, Gewerbesteuer an Gewerbesteuerrückstellung. Eine Erstattung bucht Haben nicht;
 * die Forderung gegen das Finanzamt klärt ihr mit der Steuerberatung.
 */
export async function bookSteuerrueckstellungen(actor: string, year: number, today: string): Promise<string> {
  const jahr = await kapgSteuernJahr(year);
  if (!jahr) throw new KoerperschaftError("Steuerrückstellungen bucht Haben nur für GmbH und UG.");
  if (!jahr.steuern || !jahr.gespeichert) throw new KoerperschaftError("Erst Hebesatz und Verlustvorträge für das Jahr speichern.");
  const s = jahr.steuern;
  const k = jahr.konten;
  if (s.rueckstellung.kst <= 0 && s.rueckstellung.gewst <= 0) throw new KoerperschaftError("Es ist keine Steuerrückstellung zu buchen.");
  // Je Konto, was zur Steuer des Jahres noch fehlt; ein Überhang (etwa beim Soli) steht im Haben
  const zeile = (account: string, betrag: number) => (betrag === 0 ? [] : [{ account, debit: Math.max(betrag, 0), credit: Math.max(-betrag, 0) }]);
  const lines = [
    ...(s.rueckstellung.kst > 0
      ? [...zeile(k.kst, s.kst - s.gebucht.kst), ...zeile(k.soli, s.soli - s.gebucht.soli), ...zeile(k.rueckstellungKst, -s.rueckstellung.kst)]
      : []),
    ...(s.rueckstellung.gewst > 0 ? [...zeile(k.gewst, s.rueckstellung.gewst), ...zeile(k.rueckstellungGewst, -s.rueckstellung.gewst)] : []),
  ];
  return createManualEntry(actor, { kind: "umbuchung", date: `${year}-12-31`, description: `Steuerrückstellungen ${year}`, lines }, today);
}
