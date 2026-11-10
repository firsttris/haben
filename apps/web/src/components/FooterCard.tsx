import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useLayoutEffect, useRef, useState } from "react";
import {
  customFooterRuns,
  DEFAULT_FOOTER_COLUMNS,
  FOOTER_PLACEHOLDERS,
  footerIssues,
  footerValues,
  MAX_FOOTER_COLUMNS,
  MAX_FOOTER_TEXT,
  MIN_FOOTER_COLUMNS,
  type FooterPlaceholder,
} from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { saveLetterheadDesign } from "../server/functions/logo.ts";
import { Segmented } from "./DesignPanel.tsx";
import { FormattedRuns } from "./FormattedText.tsx";
import { FormattedTextarea } from "./FormattedTextarea.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Field } from "./Field.tsx";

const COUNT_OPTIONS = Array.from({ length: MAX_FOOTER_COLUMNS - MIN_FOOTER_COLUMNS + 1 }, (_, i) => {
  const count = String(MIN_FOOTER_COLUMNS + i);
  return { value: count, label: count, name: `${count} Spalten` };
});

type FooterSeller = Parameters<typeof footerValues>[0];

/** Fußzeile der Belege: automatisch aus den Firmendaten oder eigene Spalten mit Platzhaltern */
export function FooterCard({ columns, seller, hidden }: { columns: string[] | null; seller: FooterSeller; hidden: boolean }) {
  const save = useServerFn(saveLetterheadDesign);
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const [own, setOwn] = useState(columns !== null);
  const [texts, setTexts] = useState<string[]>(columns ?? [...DEFAULT_FOOTER_COLUMNS]);
  const [count, setCount] = useState((columns ?? DEFAULT_FOOTER_COLUMNS).length);
  const [focused, setActive] = useState(0);
  // Neuer Stand vom Server: übernehmen, ohne die Karte zu ersetzen, sonst verschwände die Meldung „gespeichert“ mit ihr
  const loaded = JSON.stringify(columns);
  const [seen, setSeen] = useState(loaded);
  if (loaded !== seen) {
    setSeen(loaded);
    setOwn(columns !== null);
    setTexts(columns ?? [...DEFAULT_FOOTER_COLUMNS]);
    setCount((columns ?? DEFAULT_FOOTER_COLUMNS).length);
  }
  const fields = useRef<(HTMLTextAreaElement | null)[]>([]);
  const caret = useRef<number | null>(null);
  // Je Feld, nicht je Spalte: Ein neu eingeblendetes Feld steht mit der Schreibmarke wieder auf 0
  const touched = useRef(new WeakSet<HTMLTextAreaElement>());

  // Weniger Spalten behalten den Text der übrigen: Wer zurückschaltet, verliert nichts
  const shown = Array.from({ length: count }, (_, i) => texts[i] ?? "");
  // Nach dem Verringern kann die zuletzt fokussierte Spalte verborgen sein
  const active = Math.min(focused, count - 1);
  const issues = own ? footerIssues(shown) : [];
  const preview = customFooterRuns(shown, footerValues(seller));
  const noBank = own && !shown.some((text) => text.includes("{iban}"));

  const edit = (index: number, text: string) =>
    setTexts(Array.from({ length: Math.max(texts.length, index + 1) }, (_, i) => (i === index ? text : (texts[i] ?? ""))));

  const insert = (placeholder: FooterPlaceholder) => {
    const field = fields.current[active];
    const text = shown[active] ?? "";
    // Noch nie im Feld gewesen: Die Schreibmarke steht auf 0, der Platzhalter gehört aber hinter den vorhandenen Text
    const used = field && touched.current.has(field);
    const at = used ? field.selectionStart : text.length;
    const end = used ? field.selectionEnd : at;
    const tag = `{${placeholder}}`;
    edit(active, `${text.slice(0, at)}${tag}${text.slice(end)}`);
    if (field) touched.current.add(field);
    caret.current = at + tag.length;
    field?.focus();
  };

  // React setzt die Schreibmarke beim neuen Wert ans Ende; der nächste Platzhalter gehört aber hinter den vorigen
  useLayoutEffect(() => {
    if (caret.current === null) return;
    fields.current[active]?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const onSave = () =>
    run(async () => {
      await save({ data: { footerColumns: own ? shown : null } });
      await router.invalidate();
    }, "Fußzeile gespeichert. Sie gilt für alle Belege, die ab jetzt festgeschrieben werden.");

  return (
    <section className="card design-card" aria-labelledby="footer-heading">
      <h2 id="footer-heading">Fußzeile</h2>
      {hidden && (
        <div className="banner banner-info" role="status">
          Ausgeschaltet: Die Fußzeile steht auf dem Briefpapier. Was du hier einstellst, gilt erst wieder, wenn du das unter „Briefpapier“ änderst.
        </div>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={own} onChange={(event) => setOwn(event.target.checked)} />
        Eigene Fußzeile
      </label>
      {!own && <p className="small muted">Haben setzt die Fußzeile aus den Firmendaten zusammen: Kontakt, Bank, Steuernummern.</p>}
      {own && (
        <>
          <div>
            <h3>Anzahl Spalten</h3>
            <Segmented label="Anzahl der Spalten" options={COUNT_OPTIONS} value={String(count)} onChange={(value) => setCount(Number(value))} />
          </div>
          <div className="footer-columns" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
            {shown.map((text, index) => (
              <Field key={index} label={`Spalte ${index + 1}`}>
                {(control) => (
                  <FormattedTextarea
                    {...control}
                    fieldRef={(element) => {
                      fields.current[index] = element;
                    }}
                    className="mono"
                    rows={5}
                    maxLength={MAX_FOOTER_TEXT}
                    value={text}
                    onFocus={(event) => {
                      setActive(index);
                      touched.current.add(event.currentTarget);
                    }}
                    onChange={(event) => edit(index, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
          <div className="footer-chips" role="group" aria-label="Platzhalter einfügen">
            <span className="small muted">Einfügen in Spalte {active + 1}:</span>
            {FOOTER_PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                className="btn btn-sm mono"
                // Der Fokus bleibt im Feld, sonst wäre die Stelle im Text weg
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(placeholder)}
              >
                {`{${placeholder}}`}
              </button>
            ))}
          </div>
          {issues.map((issue) => (
            <div key={issue} className="banner banner-danger" role="alert">
              {issue}
            </div>
          ))}
          {noBank && (
            <div className="banner banner-warn" role="status">
              Ohne {"{iban}"} steht die Bankverbindung nicht auf dem Blatt.
            </div>
          )}
          <div>
            <h3>So steht sie auf dem Blatt</h3>
            <div className="footer-columns footer-preview" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
              {preview.map((lines, index) => (
                <div key={index}>
                  {lines.map((runs, i) => (
                    <div key={i}>
                      <FormattedRuns runs={runs} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="actions">
        <button type="button" className="btn" disabled={busy || issues.length > 0} onClick={() => void onSave()}>
          Fußzeile speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}
