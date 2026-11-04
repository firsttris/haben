import { steuerbescheinigung, type SteuerbescheinigungErgebnis } from "@haben/core";
import { buildSteuerbescheinigungPdf } from "@haben/einvoice";
import { eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { AusschuettungEmpfaenger } from "../../db/schema.ts";
import { kapgErklaerungAngaben, type KapgErklaerungAngaben } from "../jahreserklaerung/index.ts";
import { loadCompany, loadLetterhead, type Company } from "../stammdaten/index.ts";
import { AusschuettungError, dividendsOfYear, isReversed } from "./ausschuettung.ts";

/*
 * Steuerbescheinigungen nach § 45a Abs. 2 EStG zu einer gebuchten Ausschüttung, je Gesellschafter (Inhalt:
 * steuerbescheinigung() in @haben/core, PDF: @haben/einvoice). Anschrift und Identifikationsnummer kommen aus den
 * Angaben zur Körperschaftsteuererklärung des Beschlussjahres, wie die Gesellschafter der Ausschüttung selbst.
 */

type Dividend = typeof schema.dividends.$inferSelect;

function ergebnis(d: Dividend, e: AusschuettungEmpfaenger, company: Company, angaben: KapgErklaerungAngaben, today: string): SteuerbescheinigungErgebnis {
  const gesellschafter = angaben.anteilseigner.find((a) => a.name === e.name);
  return steuerbescheinigung({
    aussteller: {
      name: company.name,
      strasse: company.strasse,
      plz: company.plz,
      ort: company.ort,
      ...(company.steuernummer ? { steuernummer: company.steuernummer } : {}),
    },
    glaeubiger: { name: e.name, strasse: gesellschafter?.strasse, plzOrt: gesellschafter?.plzOrt, idnr: gesellschafter?.idnr },
    anteil: e,
    zahlungstag: d.zufluss,
    ausstellungstag: today,
  });
}

export interface BescheinigungStatus {
  nr: number;
  name: string;
  /** Leer: die Bescheinigung lässt sich herunterladen */
  fehlend: string[];
}

/** Je Ausschüttung des Jahres und Gesellschafter: lässt sich die Bescheinigung ausstellen, sonst was fehlt */
export async function steuerbescheinigungenDesJahres(year: number, today: string): Promise<Record<string, BescheinigungStatus[]>> {
  const [company, dividends] = await Promise.all([loadCompany(), dividendsOfYear(year)]);
  const result: Record<string, BescheinigungStatus[]> = {};
  for (const d of dividends) {
    if (d.storniert) continue;
    const { angaben } = await kapgErklaerungAngaben(Number(d.beschlussDate.slice(0, 4)));
    result[d.id] = d.empfaenger.map((e, nr) => {
      const r = ergebnis(d, e, company, angaben, today);
      return { nr, name: e.name, fehlend: r.ok ? [] : r.fehlend };
    });
  }
  return result;
}

/** PDF der Steuerbescheinigung für den Gesellschafter nr; null, wenn es die Ausschüttung oder den Gesellschafter nicht gibt */
export async function loadSteuerbescheinigungPdf(dividendId: string, nr: number, today: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const [d] = await db.select().from(schema.dividends).where(eq(schema.dividends.id, dividendId));
  const e = d?.empfaenger[nr];
  if (!d || !e) return null;
  if (await isReversed(d.entryId)) throw new AusschuettungError("Die Ausschüttung ist storniert; dazu gibt es keine Steuerbescheinigung.");
  const [company, { angaben }, letterhead] = await Promise.all([loadCompany(), kapgErklaerungAngaben(Number(d.beschlussDate.slice(0, 4))), loadLetterhead()]);
  const r = ergebnis(d, e, company, angaben, today);
  if (!r.ok) throw new AusschuettungError(r.fehlend.join(" "));
  const pdf = buildSteuerbescheinigungPdf({ ...letterhead, bescheinigung: r.bescheinigung });
  const name = e.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return { pdf, filename: `Steuerbescheinigung-${d.zufluss}-${name}.pdf` };
}
