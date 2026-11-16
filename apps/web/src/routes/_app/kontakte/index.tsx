import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { FORMAT_LABEL } from "../../../lib/invoice.ts";
import { getContacts } from "../../../server/functions/contacts.ts";
import { Field } from "../../../components/Field.tsx";
import { Tag } from "../../../components/Status.tsx";

export const Route = createFileRoute("/_app/kontakte/")({
  validateSearch: z.object({
    archiv: z.optional(z.boolean()),
    rolle: z.optional(z.enum(["kunde", "lieferant"])),
    suche: z.optional(z.string()),
    /** Spaltenkopf sortiert; der Zustand steht im Link, damit er sich teilen lässt (#1112) */
    sort: z.optional(z.enum(["name", "email", "ort", "format"])),
    dir: z.optional(z.enum(["auf", "ab"])),
  }),
  loaderDeps: ({ search }) => ({ archived: search.archiv ?? false, role: search.rolle, query: search.suche?.trim().slice(0, 100) }),
  loader: async ({ deps }) => {
    const filters = { archived: deps.archived, ...(deps.role ? { role: deps.role } : {}) };
    const [contacts, matches] = await Promise.all([
      getContacts({ data: filters }),
      deps.query ? getContacts({ data: { ...filters, query: deps.query } }) : null,
    ]);
    return { contacts, matches };
  },
  head: () => ({ meta: [{ title: "Kontakte · Haben" }] }),
  component: ContactsPage,
});

const richtungText = (dir: "auf" | "ab") => (dir === "ab" ? "absteigend" : "aufsteigend");

const ROLE_FILTERS = [
  { label: "Alle", role: undefined },
  { label: "Kunden", role: "kunde" },
  { label: "Lieferanten", role: "lieferant" },
] as const;

function ContactsPage() {
  const { contacts, matches } = Route.useLoaderData();
  const { archiv, rolle, suche } = Route.useSearch();
  const [query, setQuery] = useState(suche ?? "");
  useEffect(() => {
    setQuery(suche ?? "");
  }, [suche]);
  const needle = query.trim().toLowerCase();
  const shown =
    matches && needle === suche?.trim().toLowerCase()
      ? matches
      : needle
        ? contacts.filter((c) => [c.name, c.kundennummer, c.lieferantennummer, c.email, c.telefon, c.ort, c.plz].some((v) => v?.toLowerCase().includes(needle)))
        : contacts;
  // Spaltenkopf sortiert: erster Klick absteigend, derselbe Kopf nochmal dreht die Richtung (#1112)
  const { sort = "name", dir = "auf" } = Route.useSearch();
  const richtung = dir === "auf" ? 1 : -1;
  const sorted = [...shown].sort((a, b) => {
    switch (sort) {
      case "email":
        return richtung * (a.email ?? "").localeCompare(b.email ?? "", "de");
      case "ort":
        return richtung * [a.plz, a.ort].filter(Boolean).join(" ").localeCompare([b.plz, b.ort].filter(Boolean).join(" "), "de");
      case "format":
        return richtung * (a.defaultFormat ?? "").localeCompare(b.defaultFormat ?? "");
      default:
        return richtung * a.name.localeCompare(b.name, "de");
    }
  });
  const kopf = (feld: "name" | "email" | "ort" | "format", text: string) => {
    const aktiv = sort === feld;
    const naechste: "auf" | "ab" = aktiv && dir === "auf" ? "ab" : "auf";
    return (
      <Link
        to="/kontakte"
        search={(prev: Record<string, unknown>) => ({ ...prev, sort: feld, dir: naechste }) as { sort: typeof feld; dir: "auf" | "ab" }}
        className={aktiv ? "sort-head aktiv" : "sort-head"}
      >
        {text}
        <span className={aktiv ? "" : "muted"} aria-hidden="true">
          {aktiv ? (dir === "auf" ? " \u2191" : " \u2193") : " \u2195"}
        </span>
        {/* Die Richtung im Namen des Links wie in BankSortierKopf, ohne aria-label (siehe Belegliste) */}
        <span className="visually-hidden">{` ${richtungText(naechste)} sortieren${aktiv ? `, zurzeit ${richtungText(dir)} sortiert` : ""}`}</span>
      </Link>
    );
  };
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
              {kopf("name", "Name")}
              {kopf("email", "E-Mail")}
              {kopf("ort", "Ort")}
              {kopf("format", "Rechnungsformat")}
            </div>
            {sorted.map((contact) => (
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
