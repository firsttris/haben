import { Link } from "@tanstack/react-router";
import { Status } from "../../../components/Status.tsx";
import { KIND_TITLE } from "../../../lib/invoice.ts";
import type { Detail } from "./-rechnung-daten.ts";

/** Korrekturen und Stornos, die sich auf eine festgeschriebene Rechnung beziehen */
export function Korrekturen({ correctedBy }: { correctedBy: Detail["correctedBy"] }) {
  return (
    <section className="card" aria-labelledby="related-heading">
      <h2 id="related-heading">Korrekturen</h2>
      {correctedBy.map((c) => (
        <div key={c.id} className="history-row">
          <Link to="/rechnungen/$id" params={{ id: c.id }}>
            {KIND_TITLE[c.kind]} {c.number ?? "(Entwurf)"}
          </Link>
          {c.status === "draft" ? (
            <Status draft inline>
              Entwurf
            </Status>
          ) : (
            <Status tone="ok" inline>
              Festgeschrieben
            </Status>
          )}
        </div>
      ))}
    </section>
  );
}
