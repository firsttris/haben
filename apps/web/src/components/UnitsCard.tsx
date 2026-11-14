import { UNIT_LABEL_MAX, UNIT_SUGGESTIONS, unitLabelIssues, UNITS } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { addUnit, archiveUnit } from "../server/functions/units.ts";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ScrollTable } from "./ScrollTable.tsx";

interface UnitRow {
  id: string;
  label: string;
  code: string;
  archivedAt: Date | string | null;
}

/** Eigene Mengeneinheiten (#748): anlegen mit Code nach UN/ECE Rec. 20/21, archivieren statt löschen */
export function UnitsCard({ units }: { units: UnitRow[] }) {
  const router = useRouter();
  const add = useServerFn(addUnit);
  const archive = useServerFn(archiveUnit);
  const { busy, notice, run } = useAction();
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const labels = units.map((unit) => unit.label);
  const issues = label.trim() ? unitLabelIssues(label, labels) : [];
  const suggestions = UNIT_SUGGESTIONS.filter((s) => unitLabelIssues(s.label, labels).length === 0);

  const create = (input: { label: string; code: string }) =>
    run(async () => {
      await add({ data: input });
      setLabel("");
      setCode("");
      await router.invalidate();
    }, `Einheit „${input.label.trim()}“ angelegt.`);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void create({ label, code });
  };

  return (
    <section className="card" aria-labelledby="units-heading">
      <h2 id="units-heading">Einheiten</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Fest dabei sind {Object.keys(UNITS).join(", ")}. Eigene Einheiten stehen danach in Artikeln, Rechnungen, Angeboten und Serienrechnungen zur Auswahl. Für
        die E-Rechnung braucht jede einen Code nach UN/ECE Recommendation 20; passt keiner, nimm C62 (Stück). Eine Einheit lässt sich nicht umbenennen oder
        löschen, nur archivieren.
      </p>
      {units.length > 0 && (
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th scope="col">Einheit</th>
              <th scope="col">Code</th>
              <th scope="col">
                <span className="visually-hidden">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.id} className={unit.archivedAt ? "muted" : undefined}>
                <td>
                  {unit.label}
                  {unit.archivedAt ? " (archiviert)" : ""}
                </td>
                <td className="mono">{unit.code}</td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          await archive({ data: { id: unit.id, archived: !unit.archivedAt } });
                          await router.invalidate();
                        },
                        unit.archivedAt ? `„${unit.label}“ wiederhergestellt.` : `„${unit.label}“ archiviert.`,
                      )
                    }
                  >
                    {unit.archivedAt ? "Wiederherstellen" : "Archivieren"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      <form onSubmit={onSubmit} className="form-row cols-2">
        <Field label="Bezeichnung" hint={`Wie auf dem Beleg, höchstens ${UNIT_LABEL_MAX} Zeichen, etwa UE oder m²`} error={issues.join(" · ") || undefined}>
          {(control) => <input {...control} value={label} maxLength={UNIT_LABEL_MAX} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Code (UN/ECE Rec. 20)" hint="Drei Zeichen, etwa MTK für Quadratmeter; ohne passenden Code C62">
          {(control) => <input {...control} className="mono" value={code} maxLength={3} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
        </Field>
        <div className="actions" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="btn" disabled={busy || !label.trim() || !code.trim() || issues.length > 0}>
            Einheit anlegen
          </button>
        </div>
      </form>
      {suggestions.length > 0 && (
        <div>
          <h3 className="small">Häufig im Handwerk</h3>
          <div className="actions">
            {suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                aria-label={`${s.name} (${s.label}, Code ${s.code}) anlegen`}
                onClick={() => void create({ label: s.label, code: s.code })}
              >
                + {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
