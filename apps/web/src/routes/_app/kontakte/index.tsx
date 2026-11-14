import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { FORMAT_LABEL } from "../../../lib/invoice.ts";
import { getContacts } from "../../../server/functions/contacts.ts";
import { Field } from "../../../components/Field.tsx";
import { Tag } from "../../../components/Status.tsx";

export const Route = createFileRoute("/_app/kontakte/")({
  validateSearch: z.object({ archiv: z.optional(z.boolean()), rolle: z.optional(z.enum(["kunde", "lieferant"])), suche: z.optional(z.string()) }),
  loaderDeps: ({ search }) => ({ archived: search.archiv ?? false, role: search.rolle }),
  loader: ({ deps }) => getContacts({ data: { archived: deps.archived, ...(deps.role ? { role: deps.role } : {}) } }),
  head: () => ({ meta: [{ title: "Kontakte · Haben" }] }),
  component: ContactsPage,
});

const ROLE_FILTERS = [
  { label: "Alle", role: undefined },
  { label: "Kunden", role: "kunde" },
  { label: "Lieferanten", role: "lieferant" },
] as const;

function ContactsPage() {
  const contacts = Route.useLoaderData();
  const { archiv, rolle, suche } = Route.useSearch();
  const [query, setQuery] = useState(suche ?? "");
  useEffect(() => {
    setQuery(suche ?? "");
  }, [suche]);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? contacts.filter((c) => [c.name, c.kundennummer, c.lieferantennummer, c.email, c.telefon, c.ort, c.plz].some((v) => v?.toLowerCase().includes(needle)))
    : contacts;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Kontakte</h1>
        </div>
        <div className="actions">
          <Link to="/csv-import" search={{ art: "kontakte" }} className="btn">
            CSV importieren
          </Link>
          <Link to="/kontakte/neu" className="btn btn-primary">
            Neuer Kontakt
          </Link>
        </div>
      </div>
      <div className="filter-row" style={{ marginBottom: 0, alignItems: "center" }}>
        <Field label="Kontakte durchsuchen" hideLabel style={{ flex: "1 1 260px", maxWidth: 420 }}>
          {(control) => (
            <input
              {...control}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Suchen: Name, Kundennummer, E-Mail, Telefon, Ort"
            />
          )}
        </Field>
        <nav aria-label="Rolle" className="chip-row">
          {ROLE_FILTERS.map((f) => (
            <Link
              key={f.label}
              to="/kontakte"
              search={{ archiv, rolle: f.role }}
              className={rolle === f.role ? "chip active" : "chip"}
              aria-current={rolle === f.role ? "page" : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <Link to="/kontakte" search={{ archiv: !archiv, rolle }} className="chip">
          {archiv ? "Archivierte ausblenden" : "Archivierte zeigen"}
        </Link>
      </div>
      <section className="card" aria-label="Kontaktliste">
        {contacts.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {rolle ? `Keine ${rolle === "kunde" ? "Kunden" : "Lieferanten"}.` : "Noch keine Kontakte. Lege den ersten mit „Neuer Kontakt“ an."}
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
                  <span className="row-title">{contact.name}</span>{" "}
                  {contact.isSupplier && <Tag>{contact.isCustomer ? "Kunde und Lieferant" : "Lieferant"}</Tag>} {contact.archivedAt && <Tag>archiviert</Tag>}
                  {contact.kundennummer && (
                    <span className="small muted mono" style={{ display: "block" }}>
                      {contact.kundennummer}
                    </span>
                  )}
                </div>
                <div className="small muted ellipsis">
                  {contact.email || "–"}
                  {contact.telefon && <span style={{ display: "block" }}>{contact.telefon}</span>}
                </div>
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
