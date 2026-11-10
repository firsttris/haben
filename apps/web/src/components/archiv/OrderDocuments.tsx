import { formatEuro } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import type { ArchiveSearch } from "../../routes/_app/archiv/index.tsx";
import type { getOrderDocuments } from "../../server/functions/archive.ts";
import { YearSwitch } from "./YearSwitch.tsx";
import { ScrollBox } from "../ScrollTable.tsx";
import { Field } from "../Field.tsx";

export const ORDER_KINDS = { AN: "Angebot", AB: "Auftragsbestätigung", LI: "Lieferschein" } as const;
export const ORDER_STATUSES: Record<string, string> = {
  "100": "Entwurf",
  "200": "Ausgegeben / versendet",
  "300": "Abgelehnt",
  "500": "Angenommen",
  "750": "Teilweise berechnet",
  "1000": "Vollständig berechnet",
};
type Row = Awaited<ReturnType<typeof getOrderDocuments>>[number];

export function OrderDocuments({ rows, year, years, search }: { rows: Row[]; year: number; years: number[]; search: ArchiveSearch }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState(search.suche ?? "");
  function submit(event: FormEvent) {
    event.preventDefault();
    void navigate({ to: "/archiv", search: { ...search, suche: term || undefined } });
  }
  return (
    <section className="card stack" aria-label="Auftragsdokumente">
      <p className="muted">Angebote, Auftragsbestätigungen und Lieferscheine aus sevdesk. Archivkopien ohne Buchungswirkung.</p>
      <YearSwitch year={year} years={years} search={search} />
      <form className="archive-filter" onSubmit={submit} style={{ alignItems: "end" }}>
        <Field label="Nummer oder Kontakt">
          {(control) => <input {...control} value={term} onChange={(event) => setTerm(event.target.value)} maxLength={100} />}
        </Field>
        <Field label="Dokumentart">
          {(control) => (
            <select
              {...control}
              value={search.dokumentart ?? ""}
              onChange={(event) =>
                void navigate({ to: "/archiv", search: { ...search, dokumentart: (event.target.value as "AN" | "AB" | "LI") || undefined } })
              }
            >
              <option value="">Alle Dokumentarten</option>
              {Object.entries(ORDER_KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="submit" className="btn btn-secondary">
          Suchen
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="muted">Keine Auftragsdokumente für diese Auswahl.</p>
      ) : (
        <ScrollBox label="Archivierte Auftragsdokumente">
          <table className="data-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Art</th>
                <th>Nummer</th>
                <th>Kontakt</th>
                <th>Status bei Archivierung</th>
                <th className="num">Betrag</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td>{ORDER_KINDS[row.kind]}</td>
                  <td>
                    <Link to="/archiv/auftrag/$id" params={{ id: row.id }}>
                      {row.number || "Ohne Nummer"}
                    </Link>
                  </td>
                  <td>{row.contactName || "–"}</td>
                  <td>{ORDER_STATUSES[row.status] ?? row.status}</td>
                  <td className="num">
                    {row.gross === null ? "–" : row.currency === "EUR" ? formatEuro(row.gross) : formatEuro(row.gross).replace("€", row.currency)}
                  </td>
                  <td>{row.files > 0 ? `${row.files} vorhanden` : "Fehlt"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </section>
  );
}
