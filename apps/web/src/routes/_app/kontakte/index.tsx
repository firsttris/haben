import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod/mini";
import { FORMAT_LABEL } from "../../../lib/invoice.ts";
import { getContacts } from "../../../server/functions/contacts.ts";

export const Route = createFileRoute("/_app/kontakte/")({
  validateSearch: z.object({ archiv: z.optional(z.boolean()) }),
  loaderDeps: ({ search }) => ({ archived: search.archiv ?? false }),
  loader: ({ deps }) => getContacts({ data: { archived: deps.archived } }),
  head: () => ({ meta: [{ title: "Kontakte · Haben" }] }),
  component: ContactsPage,
});

function ContactsPage() {
  const contacts = Route.useLoaderData();
  const { archiv } = Route.useSearch();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? contacts.filter((c) => [c.name, c.kundennummer, c.email, c.ort, c.plz].some((v) => v?.toLowerCase().includes(needle)))
    : contacts;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Kontakte</h1>
        </div>
        <div className="actions">
          <Link to="/kontakte/neu" className="btn btn-primary">
            Neuer Kontakt
          </Link>
        </div>
      </div>
      <div className="filter-row" style={{ marginBottom: 0, alignItems: "center" }}>
        <label className="field" style={{ flex: "1 1 260px", maxWidth: 420 }}>
          <span className="visually-hidden">Kontakte durchsuchen</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen: Name, Kundennummer, E-Mail, Ort" />
        </label>
        <Link to="/kontakte" search={{ archiv: !archiv }} className="chip">
          {archiv ? "Archivierte ausblenden" : "Archivierte zeigen"}
        </Link>
      </div>
      <section className="card" aria-label="Kontaktliste">
        {contacts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Kontakte. Lege den ersten mit „Neuer Kontakt“ an.
          </p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Kein Kontakt passt zu „{query}“.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head contact-cols">
              <div>Name</div>
              <div>E-Mail</div>
              <div>Ort</div>
              <div>Rechnungsformat</div>
            </div>
            {shown.map((contact) => (
              <Link key={contact.id} to="/kontakte/$id" params={{ id: contact.id }} className="table-row contact-cols">
                <div style={{ minWidth: 0 }}>
                  <span className="row-title">{contact.name}</span> {contact.archivedAt && <span className="pill">archiviert</span>}
                  {contact.kundennummer && <span className="small muted mono" style={{ display: "block" }}>{contact.kundennummer}</span>}
                </div>
                <div className="small muted ellipsis">{contact.email || "–"}</div>
                <div className="muted">{[contact.plz, contact.ort].filter(Boolean).join(" ") || "–"}</div>
                <div className="small muted">
                  {contact.leitwegId ? "XRechnung (Leitweg-ID)" : contact.defaultFormat ? FORMAT_LABEL[contact.defaultFormat] : "wie in den Einstellungen"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
