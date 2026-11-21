import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { BUILTIN_LAYOUTS, LAYOUT_DOCUMENT_LABELS, LAYOUT_DOCUMENT_TYPES, type LayoutDocumentType, type LayoutRef, type LetterheadDesign } from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { assignLayoutFn, assignLayoutToAllFn } from "../server/functions/layouts.ts";
import { Field } from "./Field.tsx";
import type { LayoutRow } from "./LayoutsCard.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

const artFor = (type: LayoutDocumentType) => (type === "mahnung" ? "mahnung" : "beleg");
const refValue = (ref: LayoutRef) => `${ref.kind}:${ref.id}`;
const parseRef = (value: string): LayoutRef => {
  const [kind, id] = value.split(":") as [LayoutRef["kind"], string];
  return { kind, id };
};
const GESPEICHERT = "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.";

/**
 * Ein Layout für alle Belegarten, darunter eingeklappt die Wahl je Belegart. Aufgeklappt ist sie, sobald eine Belegart
 * abweicht; dann steht oben „Je Belegart verschieden“.
 */
export function LayoutZuordnung({ design, layouts }: { design: LetterheadDesign; layouts: LayoutRow[] }) {
  const router = useRouter();
  const assign = useServerFn(assignLayoutFn);
  const assignAll = useServerFn(assignLayoutToAllFn);
  const { busy, notice, setNotice, run } = useAction();
  const werte = new Set(LAYOUT_DOCUMENT_TYPES.map((type) => refValue(design.layouts[type])));
  const einheitlich = werte.size === 1 ? [...werte][0]! : "";

  const onAll = async (value: string) => {
    let ohne: string[] = [];
    const ok = await run(async () => {
      const { types } = await assignAll({ data: { ref: parseRef(value) } });
      ohne = LAYOUT_DOCUMENT_TYPES.filter((type) => !types.includes(type)).map((type) => LAYOUT_DOCUMENT_LABELS[type]);
      await router.invalidate();
    });
    if (ok)
      setNotice({
        tone: "ok",
        text: ohne.length === 0 ? GESPEICHERT : `Gespeichert, außer für ${ohne.join(", ")}: Dort passt das Layout nicht, es bleibt beim bisherigen.`,
      });
  };

  const onAssign = (type: LayoutDocumentType, value: string) =>
    run(async () => {
      await assign({ data: { type, ref: parseRef(value) } });
      await router.invalidate();
    }, GESPEICHERT);

  const optionen = (art?: "beleg" | "mahnung") => (
    <>
      {BUILTIN_LAYOUTS.map((entry) => (
        <option key={entry.id} value={refValue(entry)}>
          {entry.name} (eingebaut)
        </option>
      ))}
      {layouts
        .filter((layout) => !art || layout.art === art)
        .map((layout) => (
          <option key={layout.id} value={`eigen:${layout.id}`}>
            {art ? layout.name : `${layout.name} (${layout.art === "mahnung" ? "nur Mahnungen" : "Belege ohne Mahnung"})`}
          </option>
        ))}
    </>
  );

  return (
    <>
      <Field label="Layout" hint="Gilt für alle Belegarten, zu denen es passt.">
        {(control) => (
          <select {...control} value={einheitlich} disabled={busy} onChange={(event) => void onAll(event.target.value)}>
            {einheitlich === "" && (
              <option value="" disabled>
                Je Belegart verschieden
              </option>
            )}
            {optionen()}
          </select>
        )}
      </Field>
      <details className="layouts-je-beleg" open={einheitlich === "" || undefined}>
        <summary>Je Belegart abweichend wählen</summary>
        <table className="layouts-table">
          <thead>
            <tr>
              <th scope="col">Belegart</th>
              <th scope="col">Layout</th>
            </tr>
          </thead>
          <tbody>
            {LAYOUT_DOCUMENT_TYPES.map((type) => (
              <tr key={type}>
                <td>{LAYOUT_DOCUMENT_LABELS[type]}</td>
                <td>
                  <Field label={`Layout für ${LAYOUT_DOCUMENT_LABELS[type]}`} hideLabel>
                    {(control) => (
                      <select {...control} value={refValue(design.layouts[type])} disabled={busy} onChange={(event) => void onAssign(type, event.target.value)}>
                        {optionen(artFor(type))}
                      </select>
                    )}
                  </Field>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <NoticeBanner notice={notice} />
    </>
  );
}
