import { planProblem, type PlanTemplate } from "@haben/core";
import { and, eq, sql } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { schema } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { loadCompany } from "./company.ts";

/** Vorlagen für den Zahlungsplan im Angebot, z. B. „30/40/30“; ein Angebot übernimmt eine Kopie, spätere Änderungen wirken nicht zurück */

export class PlanTemplateError extends UserError {}

/** Höchstzahl der Vorlagen */
export const PLAN_TEMPLATES_MAX = 20;

/** Aufbau prüfen: Name eindeutig, je Vorlage ein gültiger Plan; feste Beträge prüft erst das Angebot gegen seine Summe */
export function planTemplatesProblem(templates: PlanTemplate[]): string | null {
  if (templates.length > PLAN_TEMPLATES_MAX) return `Höchstens ${PLAN_TEMPLATES_MAX} Vorlagen`;
  const names = templates.map((t) => t.name.trim().toLowerCase());
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice !== undefined) return `Die Vorlage „${templates[names.indexOf(twice)]!.name.trim()}“ gibt es zweimal`;
  for (const template of templates) {
    if (template.rows.length === 0) return `Die Vorlage „${template.name}“ hat keine Zeilen`;
    const problem = planProblem(template.rows, Number.MAX_SAFE_INTEGER);
    if (problem) return `Vorlage „${template.name}“: ${problem}`;
    const percent = template.rows.reduce((s, r) => s + (r.share.kind === "prozent" ? r.share.value : 0), 0);
    if (percent > 10_000) return `Vorlage „${template.name}“: Die Anteile ergeben mehr als 100 %`;
  }
  return null;
}

export async function savePlanTemplates(actor: string, templates: PlanTemplate[]): Promise<void> {
  const cleaned = templates.map((t) => ({ name: t.name.trim(), rows: t.rows.map((r) => ({ ...r, label: r.label.trim(), due: r.due.trim() })) }));
  const problem = planTemplatesProblem(cleaned);
  if (problem) throw new PlanTemplateError(`${problem}.`);
  await loadCompany();
  await withActor(actor, (tx) =>
    tx
      .update(schema.company)
      .set({ paymentPlanTemplates: cleaned, updatedAt: new Date() })
      .where(and(eq(schema.company.id, 1), sql`${schema.company.paymentPlanTemplates} is distinct from ${JSON.stringify(cleaned)}::jsonb`)),
  );
}
