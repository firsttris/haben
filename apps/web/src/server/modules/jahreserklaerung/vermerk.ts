import { formatEuro, isKapitalgesellschaft, type Cents } from "@haben/core";
import { ERSTES_ERKLAERUNGSJAHR } from "@haben/elster";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { sniff } from "../../storage.ts";
import { today } from "../../today.ts";
import { MAX_DOCUMENT_SIZE } from "../belege/index.ts";
import { underSendLock } from "../elster/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
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
  /** Abweichung zum gerechneten Wert ausdrücklich bestätigt; ohne sie wird ein abweichender Betrag abgelehnt */
  abweichungBestaetigt?: boolean;
  /** Übermittlungsprotokoll (PDF), optional */
  file?: { bytes: Uint8Array; filename: string };
}

const centsSchema = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);

export const vermerkSchema = z.object({
  filedOn: z.iso.date("Bitte den Tag der Abgabe angeben."),
  transferTicket: z.string().trim().min(10, "Bitte das Transferticket aus dem Übermittlungsprotokoll angeben.").max(64, "Das Transferticket ist zu lang."),
  amount: centsSchema,
  note: z.string().trim().min(10, "Bitte kurz begründen, warum außerhalb von Haben abgegeben wurde.").max(2000, "Die Begründung ist zu lang."),
  abweichungBestaetigt: z.boolean().optional(),
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
 *
 * Der Betrag laut Protokoll bleibt maßgeblich und wird unverändert gespeichert. Weicht er vom in Haben gerechneten Wert ab,
 * verlangt der Vermerk eine ausdrückliche Bestätigung; die Abweichung bleibt an der Zeile festgehalten. Eine harte Sperre
 * ohne Ausweg brächte nur, dass eine bereits erfolgte Abgabe nicht in Haben steht.
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
  // Die Erklärung eines Jahres kann frühestens am 1. Januar des Folgejahres abgegeben worden sein
  if (data.filedOn < `${year + 1}-01-01`)
    throw new AnnualError(`Der Tag der Abgabe liegt vor dem Ende des Jahres ${year}; so früh kann die Erklärung nicht abgegeben worden sein.`);
  // Kapitalgesellschaften bilanzieren (§ 6, § 238 HGB); eine EÜR nach § 4 Abs. 3 EStG gibt es für sie nicht
  if (form === "euer" && isKapitalgesellschaft((await loadCompany()).rechtsform))
    throw new AnnualError("Eine Kapitalgesellschaft gibt keine Anlage EÜR ab; vermerken lässt sich nur die Umsatzsteuererklärung.");
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

    // Eine erfolgte Abgabe lässt sich nicht zurücknehmen: Der Betrag laut Protokoll gilt, aber eine Abweichung muss
    // ausdrücklich bestätigt werden, statt sie stillschweigend zu übernehmen.
    const { berechnet, abweichung } = await vermerkPruefung(form, year, data.amount);
    if (abweichung !== 0 && !data.abweichungBestaetigt) throw new AnnualError(abweichungMeldung(data.amount, berechnet, abweichung));

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
          // Ohne Abweichung bleibt die Zeile wie bisher; mit Bestätigung hält sie den Vergleich dauerhaft fest
          figures: abweichung === 0 ? { amount: data.amount } : { amount: data.amount, berechnet, abweichung, abweichungBestaetigt: true },
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
 * Vergleicht den angegebenen Betrag mit dem aus den Buchungen gerechneten Wert der Erklärung. Der gerechnete Wert ist
 * nicht maßgeblich (außerhalb von Haben kann eine andere Rechnung gelten), eine Abweichung verlangt aber eine
 * ausdrückliche Bestätigung.
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

/** Fehlermeldung, die beide Beträge und die Differenz nennt und die Bestätigung verlangt */
function abweichungMeldung(amount: Cents, berechnet: Cents, abweichung: Cents): string {
  return `Der Betrag laut Protokoll (${formatEuro(amount)}) weicht um ${formatEuro(Math.abs(abweichung))} vom in Haben gerechneten Wert (${formatEuro(berechnet)}) ab. Bitte die Abweichung prüfen und ausdrücklich bestätigen.`;
}
