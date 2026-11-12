import { formatEuro, type Cents } from "@haben/core";
import { ERSTES_ERKLAERUNGSJAHR } from "@haben/elster";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { sniff } from "../../storage.ts";
import { today } from "../../today.ts";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { underSendLock } from "../elster/index.ts";
import { AnnualError, annualOverview } from "./annual.ts";

/*
 * Abgabe vermerken: Eine Jahreserklärung (Umsatzsteuererklärung oder Anlage EÜR), die außerhalb von Haben abgegeben
 * wurde (WISO, Accountable, ELSTER-Portal), wird mit Tag der Abgabe, Transferticket, Betrag und Übermittlungsprotokoll
 * an der Erklärung festgehalten. Die Frist ist damit erledigt; der Vorgang steht im Verlauf und im Jahresüberblick.
 * Das Gegenstück für die Voranmeldung ist umsatzsteuer/vermerk.ts.
 */

/** Nur diese beiden Formulare lassen sich außerhalb von Haben abgeben; Est rechnet der Betreiber selbst */
export type VermerkForm = "euer" | "ust";

export interface JahresvermerkInput {
  /** Tag der Abgabe laut Übermittlungsprotokoll, JJJJ-MM-TT */
  filedOn: string;
  transferTicket: string;
  /** Betrag der Erklärung in Cent: Abschlusszahlung bzw. Erstattung (USt) oder Gewinn (EÜR) */
  amount: Cents;
  /** Warum außerhalb von Haben abgegeben wurde */
  note: string;
  /** Übermittlungsprotokoll (PDF), optional */
  file?: { bytes: Uint8Array; filename: string };
}

const centsSchema = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

export const vermerkSchema = z.object({
  filedOn: z.iso.date("Bitte den Tag der Abgabe angeben."),
  transferTicket: z.string().trim().min(10, "Bitte das Transferticket aus dem Übermittlungsprotokoll angeben.").max(64, "Das Transferticket ist zu lang."),
  amount: centsSchema,
  note: z.string().trim().min(10, "Bitte kurz begründen, warum außerhalb von Haben abgegeben wurde.").max(2000, "Die Begründung ist zu lang."),
  file: z.object({ bytes: z.instanceof(Uint8Array), filename: z.string().min(1).max(200) }).optional(),
});

/** Was gegen die Eingaben spricht, die ohne Datenbank prüfbar sind, oder null */
export function vermerkProblem(data: z.infer<typeof vermerkSchema>, heute: string): string | null {
  if (data.filedOn > heute) return "Der Tag der Abgabe liegt in der Zukunft.";
  if (!data.file) return null;
  if (data.file.bytes.byteLength === 0) return "Die Datei des Protokolls ist leer.";
  if (data.file.bytes.byteLength > MAX_DOCUMENT_SIZE) return "Das Protokoll ist größer als 20 MB.";
  if (sniff(data.file.bytes)?.kind !== "pdf") return "Das Übermittlungsprotokoll muss eine PDF-Datei sein.";
  return null;
}

const FORM_LABEL: Record<VermerkForm, string> = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR" };

export interface Jahresvermerk {
  id: string;
  form: VermerkForm;
  year: number;
  filedOn: string | null;
  transferTicket: string | null;
  note: string | null;
  amount: number | null;
  hasPdf: boolean;
  createdAt: Date;
}

const VERMERK_COLUMNS = {
  id: schema.annualSubmissions.id,
  form: schema.annualSubmissions.form,
  year: schema.annualSubmissions.year,
  filedOn: schema.annualSubmissions.filedOn,
  transferTicket: schema.annualSubmissions.transferTicket,
  note: schema.annualSubmissions.note,
  amount: sql<number | null>`(${schema.annualSubmissions.figures}->>'amount')::int`,
  hasPdf: sql<boolean>`${schema.annualSubmissions.protocolPdf} is not null`,
  createdAt: schema.annualSubmissions.createdAt,
};

/**
 * Vermerkt die Abgabe außerhalb von Haben. Unter derselben Sendesperre wie die Übermittlung über ERiC, damit nicht beide
 * zugleich festschreiben. Je Formular und Jahr ist nur ein Vermerk möglich; ein Transferticket gehört zu genau einer
 * Erklärung. Ein abgeschlossenes Jahr bleibt unverändert und nimmt keinen Vermerk mehr auf.
 */
export async function vermerkeJahresabgabe(actor: string, form: VermerkForm, year: number, input: JahresvermerkInput, heute = today()): Promise<Jahresvermerk> {
  if (form !== "euer" && form !== "ust") throw new AnnualError("Außerhalb von Haben lässt sich nur die Umsatzsteuererklärung oder die Anlage EÜR vermerken.");
  const parsed = vermerkSchema.safeParse(input);
  if (!parsed.success) throw new AnnualError(parsed.error.issues[0]?.message ?? "Angaben unvollständig.");
  const data = parsed.data;
  const problem = vermerkProblem(data, heute);
  if (problem) throw new AnnualError(problem);
  if (year >= Number(heute.slice(0, 4))) throw new AnnualError("Die Erklärung lässt sich erst nach Ablauf des Jahres vermerken.");
  if (year < ERSTES_ERKLAERUNGSJAHR) throw new AnnualError(`Jahreserklärungen gibt es ab ${ERSTES_ERKLAERUNGSJAHR}.`);
  const transferTicket = data.transferTicket.trim();

  return underSendLock(`haben.jahreserklaerung.${form}.${year}`, "send", async () => {
    const [closed] = await db.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, year));
    if (closed) throw new AnnualError(`Das Jahr ${year} ist abgeschlossen; eine Abgabe außerhalb von Haben lässt sich nicht mehr vermerken.`);
    const [schonVermerkt] = await db
      .select({ id: schema.annualSubmissions.id })
      .from(schema.annualSubmissions)
      .where(and(eq(schema.annualSubmissions.form, form), eq(schema.annualSubmissions.year, year), eq(schema.annualSubmissions.kind, "vermerk")));
    if (schonVermerkt) throw new AnnualError(`Für die ${FORM_LABEL[form]} ${year} ist die Abgabe schon vermerkt.`);
    const [gesendet] = await db
      .select({ id: schema.annualSubmissions.id })
      .from(schema.annualSubmissions)
      .where(
        and(
          eq(schema.annualSubmissions.form, form),
          eq(schema.annualSubmissions.year, year),
          eq(schema.annualSubmissions.kind, "send"),
          eq(schema.annualSubmissions.ok, true),
        ),
      );
    if (gesendet) throw new AnnualError(`Die ${FORM_LABEL[form]} ${year} ist schon über Haben übermittelt; ein Vermerk ist nicht nötig.`);
    const [used] = await db
      .select({ year: schema.annualSubmissions.year })
      .from(schema.annualSubmissions)
      .where(eq(schema.annualSubmissions.transferTicket, transferTicket));
    if (used) throw new AnnualError(`Das Transferticket ist schon bei der Erklärung ${used.year} hinterlegt.`);

    return withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.annualSubmissions)
        .values({
          form,
          year,
          kind: "vermerk",
          ok: true,
          code: 0,
          message: "Außerhalb von Haben abgegeben",
          transferTicket,
          figures: { amount: data.amount },
          filedOn: data.filedOn,
          note: data.note,
          requestXml: "",
          responseXml: "",
          serverResponseXml: "",
          protocolPdf: data.file ? Buffer.from(data.file.bytes) : null,
        })
        .returning({
          id: schema.annualSubmissions.id,
          form: schema.annualSubmissions.form,
          year: schema.annualSubmissions.year,
          filedOn: schema.annualSubmissions.filedOn,
          transferTicket: schema.annualSubmissions.transferTicket,
          note: schema.annualSubmissions.note,
          hasPdf: sql<boolean>`${schema.annualSubmissions.protocolPdf} is not null`,
          createdAt: schema.annualSubmissions.createdAt,
        });
      return { ...row!, form: row!.form as VermerkForm, amount: data.amount };
    });
  });
}

/** Abgabevermerke eines Jahres, für Übersicht und Verlauf */
export async function jahresvermerke(year: number): Promise<Jahresvermerk[]> {
  const rows = await db
    .select(VERMERK_COLUMNS)
    .from(schema.annualSubmissions)
    .where(and(eq(schema.annualSubmissions.year, year), eq(schema.annualSubmissions.kind, "vermerk")))
    .orderBy(desc(schema.annualSubmissions.createdAt));
  return rows.map((row) => ({ ...row, form: row.form as VermerkForm }));
}

/**
 * Vergleicht den angegebenen Betrag mit dem aus den Buchungen gerechneten Wert der Erklärung. Reine Information: eine
 * Abweichung bricht den Vermerk nicht ab, denn außerhalb von Haben kann eine andere Rechnung maßgeblich sein.
 */
export async function vermerkPruefung(form: VermerkForm, year: number, amount: Cents) {
  const overview = await annualOverview(year, today());
  const berechnet = form === "ust" ? overview.ust.abschluss : overview.euer.gewinn;
  return { berechnet, abweichung: amount - berechnet, hinweis: abweichungHinweis(amount, berechnet) };
}

function abweichungHinweis(amount: Cents, berechnet: Cents): string | null {
  if (amount === berechnet) return null;
  return `Der angegebene Betrag (${formatEuro(amount)}) weicht vom gerechneten Wert (${formatEuro(berechnet)}) ab.`;
}
