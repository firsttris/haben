import type { PlanTemplate } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { savePlanTemplateSettings } from "../server/functions/company.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { parsePlanRows, PaymentPlanFields, toPlanRows, type PlanRowState } from "./PaymentPlanFields.tsx";
import { Field } from "./Field.tsx";

interface TemplateState {
  key: number;
  name: string;
  rows: PlanRowState[];
}

let nextKey = 1;

const toState = (templates: PlanTemplate[]): TemplateState[] => templates.map((t) => ({ key: nextKey++, name: t.name, rows: toPlanRows(t.rows) }));

/** Vorlagen für den Zahlungsplan im Angebot, z. B. „30/40/30“ und „50/50“; im Angebot unter „Vorlage übernehmen“ */
export function PlanTemplatesCard({ templates }: { templates: PlanTemplate[] }) {
  const router = useRouter();
  const save = useServerFn(savePlanTemplateSettings);
  const { busy, notice, run } = useAction();
  const [items, setItems] = useState(() => toState(templates));
  const parsed = items.map((item) => ({ name: item.name.trim(), ...parsePlanRows(item.rows) }));
  const valid = parsed.every((p) => p.valid && p.name !== "" && p.rows.length > 0);
  const update = (key: number, patch: Partial<TemplateState>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await save({ data: parsed.map(({ name, rows }) => ({ name, rows })) });
      await router.invalidate();
    }, "Vorlagen gespeichert. Angebote übernehmen eine Kopie; schon geschriebene bleiben, wie sie sind.");
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="plan-templates-heading">
      <h2 id="plan-templates-heading">Vorlagen für den Zahlungsplan</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Häufige Zahlungspläne für Angebote, je Zahlung ein Prozentsatz oder fester Betrag; die letzte ist immer der Rest. Im Angebot übernimmst du sie unter
        „Vorlage übernehmen“.
      </p>
      <NoticeBanner notice={notice} />
      {items.map((item, index) => (
        <fieldset key={item.key} className="choice-group">
          <legend className="visually-hidden">Vorlage {index + 1}</legend>
          <div className="actions" style={{ alignItems: "end" }}>
            <Field label="Name der Vorlage" style={{ flex: "1 1 12em" }}>
              {(control) => (
                <input
                  {...control}
                  value={item.name}
                  maxLength={60}
                  onChange={(e) => update(item.key, { name: e.target.value })}
                  aria-invalid={!item.name.trim()}
                />
              )}
            </Field>
            <button type="button" className="btn btn-danger" onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}>
              Vorlage entfernen
            </button>
          </div>
          <PaymentPlanFields id={`vorlage-${item.key}`} rows={item.rows} onChange={(rows) => update(item.key, { rows })} />
        </fieldset>
      ))}
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-dashed"
          onClick={() => setItems((prev) => [...prev, { key: nextKey++, name: "", rows: [] }])}
          disabled={items.length >= 20}
        >
          + Vorlage hinzufügen
        </button>
        <button type="submit" className="btn" disabled={busy || !valid}>
          Vorlagen speichern
        </button>
      </div>
    </form>
  );
}
