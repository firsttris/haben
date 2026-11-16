import { standText, type Verfahrensdoku } from "@firsttris/gobd-kern/verfahrensdoku";

/**
 * Die Verfahrensdokumentation als Blatt zum Lesen und Drucken (#860): das Datenmodell aus @firsttris/gobd-kern,
 * Abschnitte mit Absätzen, Listen und Lücken. Beim Drucken bleibt nur dieses Blatt (styles/verfahrensdoku.css).
 */
export function ProcedureDocument({ document }: { document: Verfahrensdoku }) {
  return (
    <article className="card procedure-doc" aria-labelledby="procedure-doc-title">
      <header>
        <h2 id="procedure-doc-title">{document.titel}</h2>
        <p className="small muted">{standText(document)}</p>
      </header>
      {document.abschnitte.map((a) => (
        <section key={a.titel} aria-label={a.titel}>
          <h3>{a.titel}</h3>
          {a.absaetze.map((absatz) => (
            <p key={absatz}>{absatz}</p>
          ))}
          {a.liste && (
            <ul>
              {a.liste.map((eintrag) => (
                <li key={eintrag}>{eintrag}</li>
              ))}
            </ul>
          )}
          {a.luecken && (
            <ul className="procedure-gaps" aria-label="Fehlende Angaben">
              {a.luecken.map((luecke) => (
                <li key={luecke}>
                  <strong>Fehlt:</strong> {luecke}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
