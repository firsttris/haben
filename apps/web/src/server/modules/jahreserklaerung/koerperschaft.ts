import { abschluss, isKapitalgesellschaft, kapgSteuern, MINDEST_HEBESATZ, steuerKonten, type KapgSteuerAngaben, type KapgSteuern } from "@haben/core";
import { eq } from "drizzle-orm";
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
});

export type KapgAngabenInput = z.input<typeof kapgAngabenSchema>;

async function storedAngaben(year: number): Promise<KapgSteuerAngaben | null> {
  const [row] = await db.select({ data: schema.corporateTaxInputs.data }).from(schema.corporateTaxInputs).where(eq(schema.corporateTaxInputs.year, year));
  const parsed = row ? kapgAngabenSchema.safeParse(row.data) : null;
  return parsed?.success ? parsed.data : null;
}

export async function saveKapgAngaben(actor: string, year: number, input: KapgAngabenInput): Promise<void> {
  const data = kapgAngabenSchema.parse(input);
  await withActor(actor, (tx) =>
    tx
      .insert(schema.corporateTaxInputs)
      .values({ year, data })
      .onConflictDoUpdate({ target: schema.corporateTaxInputs.year, set: { data, updatedAt: new Date() } }),
  );
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
    angaben: { hebesatz: vorjahr.hebesatz, verlustvortragKst: s?.verlustvortragKst ?? 0, verlustvortragGewst: s?.verlustvortragGewst ?? 0 },
    gespeichert: false,
  };
}

/** Angaben und Berechnung für die Abschluss-Seite; null für Einzelunternehmen */
export async function kapgSteuernJahr(year: number) {
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
