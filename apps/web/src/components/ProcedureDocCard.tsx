import { Link } from "@tanstack/react-router";

/** Einstieg unter Einstellungen › Export: die Verfahrensdokumentation hat eine eigene Seite zum Lesen, Ergänzen und Drucken */
export function ProcedureDocCard() {
  return (
    <section className="card" aria-labelledby="procedure-card-heading">
      <h2 id="procedure-card-heading">Verfahrensdokumentation</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Beschreibt nach den GoBD, wie du mit Haben buchst und aufbewahrst: erzeugt aus dem Stand dieser Instanz (Firma, Zugänge, Datenbankrolle, Backup,
        Versionen) und deinen Angaben zum Betrieb. Zum Drucken, als PDF oder Markdown; das Jahresarchiv enthält die aktuelle Fassung.
      </p>
      <div className="actions">
        <Link to="/einstellungen/verfahrensdokumentation" className="btn">
          Verfahrensdokumentation öffnen
        </Link>
      </div>
    </section>
  );
}
