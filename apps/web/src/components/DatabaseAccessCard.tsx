import type { getDatabaseAccessInfo } from "../server/functions/integrity.ts";

type Access = Awaited<ReturnType<typeof getDatabaseAccessInfo>>;

const DOCS = "https://haben.app/installation-konfiguration.html#getrennte-datenbankrollen";

/** Tatsächliche Rechte der laufenden Datenbankverbindung, unabhängig von den Startvariablen. */
export function DatabaseAccessCard({ access }: { access: Access }) {
  return (
    <section className="card" aria-labelledby="database-access-heading">
      <h2 id="database-access-heading">Datenbankzugriff</h2>
      <dl className="small" style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "4px 16px" }}>
        <dt className="muted">Aktuelle Rolle</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
          <code>{access.role}</code>
        </dd>
        <dt className="muted">Anmelderolle</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
          <code>{access.loginRole}</code>
        </dd>
      </dl>
      <p className="small" style={{ margin: 0 }}>
        <strong>{access.restricted ? "Appbetrieb mit eingeschränkten Rechten" : "Verbindung mit weitergehenden Rechten"}</strong>
        <br />
        {access.restricted
          ? "Die Rechte der aktuellen Verbindung sind für den Appbetrieb eingeschränkt. Migrationen benötigen eine getrennte Verbindung."
          : "Diese Verbindung hat Rechte, die über den Appbetrieb hinausgehen. Trenne Appbetrieb und Migrationen wie in der Installationsanleitung beschrieben."}
      </p>
      {access.problems.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20, overflowWrap: "anywhere" }}>
          {access.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <p className="small" style={{ margin: 0 }}>
        <a href={DOCS} target="_blank" rel="noreferrer">
          Getrennte Datenbankrollen einrichten
        </a>
      </p>
    </section>
  );
}
