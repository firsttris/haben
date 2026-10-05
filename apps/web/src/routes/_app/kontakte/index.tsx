import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod/mini";
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
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Kunden</div>
          <h1>Kontakte</h1>
        </div>
        <div className="actions">
          <Link to="/kontakte" search={{ archiv: !archiv }} className="btn">
            {archiv ? "Archivierte ausblenden" : "Archivierte zeigen"}
          </Link>
          <Link to="/kontakte/neu" className="btn btn-primary">
            Neuer Kontakt
          </Link>
        </div>
      </div>
      <section className="card" aria-label="Kontaktliste">
        {contacts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Kontakte.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head contact-cols">
              <div>Nummer</div>
              <div>Name</div>
              <div>Ort</div>
              <div>Format</div>
            </div>
            {contacts.map((contact) => (
              <Link key={contact.id} to="/kontakte/$id" params={{ id: contact.id }} className="table-row contact-cols">
                <div className="mono small">{contact.kundennummer ?? "–"}</div>
                <div>
                  {contact.name} {contact.archivedAt && <span className="pill">archiviert</span>}
                </div>
                <div className="muted">{[contact.plz, contact.ort].filter(Boolean).join(" ")}</div>
                <div className="small muted">{contact.leitwegId ? "XRechnung (Leitweg-ID)" : (contact.defaultFormat ?? "Standard")}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
