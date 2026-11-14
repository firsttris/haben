import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { useAction } from "../../lib/use-action.ts";
import { saveAnnualFigures } from "../../server/functions/annual.ts";
import { ERKLAERTE_ZEILEN, type ZeilenForm } from "../../lib/zeilenwerte.ts";
import { Field } from "../Field.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { Status } from "../Status.tsx";

/** Zeilen, die ohne Aufklappen sichtbar sind: das Ergebnis der Erklärung */
const KERN: Record<ZeilenForm, readonly string[]> = {
  ust: ["kz22", "kz87", "kz119", "kz120"],
  euer: ["einnahmen", "ausgaben", "gewinn"],
};

/**
 * Zeilenwerte einer außerhalb von Haben abgegebenen Erklärung (#997).
 *
 * Liegen Zeilen vor, ersetzt ihre Tabelle Habens Rechnung aus den Buchungen: Was beim Finanzamt liegt, ist
 * die Wahrheit, nicht was Haben aus unvollständigen Buchungen rechnet. Die Kernzeilen stehen offen, der Rest
 * klappt auf.
 *
 * Liegt ein Vermerk vor, aber noch keine Zeilen, steht hier die Erfassung. Ohne Vermerk gibt es keine
 * Erklärung, zu der Zeilen gehören könnten; dann zeigt die Komponente nichts.
 */
export function ErklaerteZeilen({
  form,
  year,
  zeilen,
  vermerkt,
}: {
  form: ZeilenForm;
  year: number;
  /** Feldkennung zu Betrag in Cent; leer, wenn nichts erfasst ist */
  zeilen: Record<string, number>;
  /** Gibt es einen Vermerk, an dem Zeilen hängen können? */
  vermerkt: boolean;
}) {
  const vorhanden = ERKLAERTE_ZEILEN[form].filter(([feld]) => feld in zeilen);
  if (vorhanden.length > 0) return <Tabelle form={form} vorhanden={vorhanden} zeilen={zeilen} />;
  if (!vermerkt) return null;
  return <Erfassen form={form} year={year} />;
}

function Tabelle({ form, vorhanden, zeilen }: { form: ZeilenForm; vorhanden: readonly (readonly [string, string])[]; zeilen: Record<string, number> }) {
  const kern = KERN[form];
  const offen = vorhanden.filter(([feld]) => kern.includes(feld));
  const rest = vorhanden.filter(([feld]) => !kern.includes(feld));

  const rows = (auswahl: readonly (readonly [string, string])[], hervorheben: boolean) => (
    <tbody>
      {auswahl.map(([feld, text]) => (
        <tr key={feld} className={hervorheben ? "total-row" : undefined}>
          <th scope="row">
            {text} <span className="small muted">({feld})</span>
          </th>
          <td className="num">{formatEuro(zeilen[feld] ?? 0)}</td>
        </tr>
      ))}
    </tbody>
  );

  return (
    <>
      <table className="report-table stack-table">
        <thead>
          <tr>
            <th scope="col">Zeile</th>
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        {rows(offen, true)}
      </table>
      {rest.length > 0 && (
        <details className="est-block">
          <summary>
            <span className="est-block-title">Alle erklärten Zeilen</span>
            <span className="small muted">{rest.length} weitere</span>
          </summary>
          <table className="report-table stack-table">
            <thead>
              <tr>
                <th scope="col">Zeile</th>
                <th scope="col" className="num">
                  Betrag
                </th>
              </tr>
            </thead>
            {rows(rest, false)}
          </table>
        </details>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Diese Zahlen stammen aus dem Übermittlungsprotokoll, nicht aus den Buchungen. Sie erscheinen, weil die Erklärung außerhalb von Haben abgegeben wurde.
      </p>
    </>
  );
}

function Erfassen({ form, year }: { form: ZeilenForm; year: number }) {
  const router = useRouter();
  const speichern = useServerFn(saveAnnualFigures);
  const { busy, notice, setNotice, run } = useAction();
  const [werte, setWerte] = useState<Record<string, string>>({});

  const zeilen = Object.entries(werte)
    .map(([field, text]) => ({ field, cents: parseEuro(text) }))
    .filter((z): z is { field: string; cents: number } => z.cents !== null)
    .map(({ field, cents }) => ({ field, amount: cents }));

  const leer = zeilen.length === 0;

  async function absenden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (leer) return;
    await run(async () => {
      const result = await speichern({ data: { form, year, zeilen } });
      if (!result.ok) throw new Error(result.message);
      setNotice({ tone: "ok", text: `${result.anzahl} Zeilen gespeichert.` });
      setWerte({});
      await router.invalidate();
    });
  }

  return (
    <details className="est-block">
      <summary>
        <span className="est-block-title">Zeilenwerte aus dem Übermittlungsprotokoll</span>
        <span className="small muted">noch nicht erfasst</span>
      </summary>
      <form onSubmit={absenden} style={{ display: "grid", gap: 8, paddingTop: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Trag die Zeilen ein, die beim Finanzamt abgegeben wurden. Leere Felder werden nicht gespeichert; sie bleiben Habens Rechnung.
        </p>
        <NoticeBanner notice={notice} />
        <div className="form-row cols-2">
          {ERKLAERTE_ZEILEN[form].map(([feld, text]) => (
            <Field key={feld} label={`${text} (${feld})`}>
              {(control) => (
                <input
                  {...control}
                  inputMode="decimal"
                  placeholder="leer lassen"
                  value={werte[feld] ?? ""}
                  onChange={(e) => setWerte((alt) => ({ ...alt, [feld]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button type="submit" className="btn btn-primary" disabled={busy || leer}>
            Zeilenwerte speichern
          </button>
          <Status tone={leer ? undefined : "ok"} inline>
            {leer ? "Noch nichts eingetragen" : `${zeilen.length} Zeilen`}
          </Status>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Gespeicherte Zeilen lassen sich nicht ändern; sie stehen im Änderungsprotokoll.
        </p>
      </form>
    </details>
  );
}
