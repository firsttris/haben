import { EXPENSE_CATEGORIES, formatEuro, type ExpenseCategory } from "@haben/core";
import { ErrorBanner } from "../../../components/ErrorBanner.tsx";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { DocumentStatus, SOURCE_LABEL, documentStatusText } from "../../../components/DocumentStatus.tsx";
import { Status } from "../../../components/Status.tsx";
import { DocumentUpload } from "../../../components/DocumentUpload.tsx";
import { BelegFilterChips, BelegeLeer, filterBelege, filterName, sucheBelege } from "../../../components/BelegeFilter.tsx";
import { Field } from "../../../components/Field.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { getDocuments } from "../../../server/functions/documents.ts";

export const Route = createFileRoute("/_app/belege/")({
  validateSearch: z.object({
    suche: z.optional(z.string()),
    /** „Zu prüfen“ oder „Gebucht“; ohne Angabe alle Belege, wie „Alle“ in der Bank */
    status: z.optional(z.enum(["pruefen", "gebucht"])),
    /** Spaltenkopf sortiert; der Zustand steht im Link, damit er sich teilen lässt (#1112) */
    sort: z.optional(z.enum(["datum", "lieferant", "kategorie", "brutto", "status"])),
    dir: z.optional(z.enum(["auf", "ab"])),
  }),
  loader: () => getDocuments(),
  head: () => ({ meta: [{ title: "Belege · Haben" }] }),
  component: DocumentsPage,
});

const richtungText = (dir: "auf" | "ab") => (dir === "ab" ? "absteigend" : "aufsteigend");

/* Texte der Spalten Lieferant und Kategorie; die Sortierung nimmt dieselben, damit die Liste so sortiert ist, wie sie aussieht */
const lieferantText = (doc: { supplierName: string; filename: string }) => doc.supplierName || doc.filename;
const kategorieText = (doc: { category: string | null; splitCount: number }) =>
  doc.category ? EXPENSE_CATEGORIES[doc.category as ExpenseCategory].label : doc.splitCount > 0 ? `Aufgeteilt auf ${doc.splitCount} Zeilen` : "–";

const statusText = (doc: Parameters<typeof documentStatusText>[0] & { cancelledOn: string | null }) =>
  documentStatusText({ ...doc, cancelled: doc.cancelledOn !== null });

function DocumentsPage() {
  const { documents, aiAvailable, inbox } = Route.useLoaderData();
  const inhaber = Route.useRouteContext().user.role === "inhaber";
  const router = useRouter();
  const { suche, status: filter } = Route.useSearch();
  const [query, setQuery] = useState(suche ?? "");
  useEffect(() => {
    setQuery(suche ?? "");
  }, [suche]);
  const gefiltert = filterBelege(documents, filter);
  const shown = sucheBelege(gefiltert, query);
  // Spaltenkopf sortiert: erster Klick absteigend, derselbe Kopf nochmal dreht die Richtung (#1112). Ohne gewählte Spalte
  // bleibt die Reihenfolge von listDocuments: ungebuchte zuerst, dann nach Belegdatum, wie die Navigation am Beleg.
  const { sort, dir = "ab" } = Route.useSearch();
  const richtung = dir === "auf" ? 1 : -1;
  const sorted = !sort
    ? shown
    : [...shown].sort((a, b) => {
        switch (sort) {
          case "lieferant":
            return richtung * lieferantText(a).localeCompare(lieferantText(b), "de");
          case "kategorie":
            return richtung * kategorieText(a).localeCompare(kategorieText(b), "de");
          case "brutto":
            return richtung * (a.gross - b.gross);
          case "status":
            return richtung * statusText(a).localeCompare(statusText(b), "de");
          default:
            return richtung * (a.documentDate ?? "").localeCompare(b.documentDate ?? "");
        }
      });
  const kopf = (feld: "datum" | "lieferant" | "kategorie" | "brutto" | "status", text: string, klasse = "sort-head") => {
    const aktiv = sort === feld;
    const naechste: "auf" | "ab" = aktiv && dir === "ab" ? "auf" : "ab";
    return (
      <Link
        to="/belege"
        search={(prev: Record<string, unknown>) => ({ ...prev, sort: feld, dir: naechste }) as { sort: typeof feld; dir: "auf" | "ab" }}
        className={aktiv ? `${klasse} aktiv` : klasse}
      >
        {text}
        {aktiv && <span aria-hidden="true">{dir === "ab" ? " \u2193" : " \u2191"}</span>}
        {/* Die Richtung im Namen des Links wie in BankSortierKopf, aber ohne aria-label: Das träfe in getByLabel auch
            die gleichnamigen Formularfelder (#1113) */}
        <span className="visually-hidden">{` ${richtungText(naechste)} sortieren${aktiv ? `, zurzeit ${richtungText(dir)} sortiert` : ""}`}</span>
      </Link>
    );
  };
  const running = documents.some((d) => d.extractionStatus === "laeuft");
  const open = documents.filter((d) => d.status === "neu").length;

  // Solange die KI liest, die Liste regelmäßig auffrischen
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Eingangsrechnungen und Quittungen</div>
          <h1>Belege</h1>
        </div>
        {open > 0 && (
          <Status tone="warn" emphasis="notice">
            {open} zu prüfen
          </Status>
        )}
      </div>
      {inhaber && <DocumentUpload aiAvailable={aiAvailable} />}
      {inbox ? (
        <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
          Belege per E-Mail: Anhänge an {inbox.username}
          {inbox.folder !== "INBOX" ? ` (Ordner ${inbox.folder})` : ""} landen stündlich hier
          {inbox.lastRunAt ? `, zuletzt abgerufen ${formatDateTime(inbox.lastRunAt)}` : ""}.
        </p>
      ) : null}
      {inbox?.lastError && (
        <ErrorBanner title="Belege per E-Mail" detail={inbox.lastError}>
          Prüfe das Postfach in den{" "}
          <Link to="/einstellungen" search={{ bereich: "email" }}>
            Einstellungen
          </Link>
          .
        </ErrorBanner>
      )}
      {inbox || !inhaber || documents.length === 0 ? null : (
        <p className="small muted" style={{ margin: 0 }}>
          Rechnungen per E-Mail? Mit einem{" "}
          <Link to="/einstellungen" search={{ bereich: "email" }}>
            Postfach für Belege
          </Link>{" "}
          holt Haben die Anhänge selbst ab.
        </p>
      )}
      {documents.length > 0 && (
        <div className="filter-row" style={{ marginBottom: 0, alignItems: "center" }}>
          <Field label="Belege durchsuchen" hideLabel style={{ flex: "1 1 260px", maxWidth: 420 }}>
            {(control) => (
              <input
                {...control}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Suchen: Lieferant, Belegnummer, Datei oder Betrag"
              />
            )}
          </Field>
          <BelegFilterChips openCount={open} />
        </div>
      )}
      <section className="card" aria-label="Belegliste">
        {documents.length === 0 ? (
          <BelegeLeer filter={undefined} inhaber={inhaber} hatPostfach={Boolean(inbox)} />
        ) : gefiltert.length === 0 ? (
          <BelegeLeer filter={filter} inhaber={inhaber} hatPostfach={Boolean(inbox)} />
        ) : shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Kein Beleg passt zu „{query}“{filter ? ` unter „${filterName(filter)}“` : ""}.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head document-cols">
              {kopf("datum", "Datum")}
              {kopf("lieferant", "Lieferant")}
              {kopf("kategorie", "Kategorie")}
              {kopf("brutto", "Brutto", "sort-head num")}
              {kopf("status", "Status")}
            </div>
            {sorted.map((doc) => (
              <Link key={doc.id} to="/belege/$id" params={{ id: doc.id }} className="table-row document-cols">
                <div className="muted small">{doc.documentDate ? formatDate(doc.documentDate) : "–"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="ellipsis">{lieferantText(doc)}</span>
                  <span className="small muted ellipsis">
                    {doc.invoiceNumber || doc.filename}
                    {doc.recurringDocumentId ? " · Dauerbeleg" : doc.extractedBy ? ` · ${SOURCE_LABEL[doc.extractedBy]}` : ""}
                  </span>
                </div>
                <div className="small">
                  {kategorieText(doc)}
                  {doc.ownAccount && <div className="muted">{doc.ownAccount}</div>}
                </div>
                <div className="num">{doc.gross ? formatEuro(doc.gross) : "–"}</div>
                <div>
                  <DocumentStatus
                    status={doc.status}
                    extractionStatus={doc.extractionStatus}
                    cancelled={doc.cancelledOn !== null}
                    cancelledOn={doc.cancelledOn}
                    lockedAt={doc.lockedAt}
                    uploadedAt={doc.uploadedAt}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
