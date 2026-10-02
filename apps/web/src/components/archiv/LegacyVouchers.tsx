import { formatEuro } from "@haben/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import type { ArchiveSearch } from "../../routes/_app/archiv/index.tsx";
import type { getLegacyVouchers } from "../../server/functions/archive.ts";
import { YearSwitch } from "./YearSwitch.tsx";

type Row = Awaited<ReturnType<typeof getLegacyVouchers>>[number];

export const LEGACY_TYPES: Record<string, string> = {
  invoice: "Rechnung",
  creditnote: "Gutschrift",
  downpaymentinvoice: "Abschlagsrechnung",
  salesinvoice: "Einnahmebeleg",
  salescreditnote: "Einnahme-Gutschrift",
  purchaseinvoice: "Ausgabebeleg",
  purchasecreditnote: "Ausgabe-Gutschrift",
};

export function LegacyVouchers({ year, years, rows, search }: { year: number; years: number[]; rows: Row[]; search: ArchiveSearch }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState(search.suche ?? "");
  const direction = search.richtung ?? "alle";

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void navigate({ to: "/archiv", search: { ...search, suche: term || undefined } });
  }

  const sumOf = (dir: "einnahme" | "ausgabe", key: "net" | "gross") =>
    rows.filter((r) => r.direction === dir).reduce((s, r) => s + r[key], 0);
  return (
    <section className="card stack" aria-label={`Belege ${year}`}>
      <YearSwitch year={year} years={years} search={search} />
      <div className="filter-row" style={{ justifyContent: "space-between" }}>
        <div className="filter-row" role="group" aria-label="Richtung">
          {(["alle", "einnahme", "ausgabe"] as const).map((value) => (
            <Link
              key={value}
              to="/archiv" activeProps={{}}
              search={{ ...search, richtung: value === "alle" ? undefined : value }}
              className={direction === value ? "chip active" : "chip"}
              aria-pressed={direction === value}
            >
              {value === "alle" ? "Alle" : value === "einnahme" ? "Einnahmen" : "Ausgaben"}
            </Link>
          ))}
          <Link
            to="/archiv" activeProps={{}}
            search={{ ...search, ohneDatei: search.ohneDatei ? undefined : true }}
            className={search.ohneDatei ? "chip active" : "chip"}
            aria-pressed={Boolean(search.ohneDatei)}
          >
            Ohne Datei
          </Link>
        </div>
        <form onSubmit={onSearch} role="search">
          <label className="search-box">
            <span className="visually-hidden">Suchen</span>
            <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Nummer, Kontakt, Notiz" />
          </label>
        </form>
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Keine Belege für diese Auswahl.</p>
      ) : (
        <div className="table">
          <div className="table-row head legacy-cols">
            <div>Datum</div>
            <div>Nummer</div>
            <div>Kontakt · Art</div>
            <div style={{ textAlign: "right" }}>Netto</div>
            <div style={{ textAlign: "right" }}>Brutto</div>
            <div style={{ textAlign: "right" }}>Dateien</div>
          </div>
          {rows.map((row) => (
            <Link key={row.id} to="/archiv/beleg/$id" params={{ id: row.id }} className="table-row legacy-cols">
              <div className="small">{formatDate(row.date)}</div>
              <div className="mono small ellipsis">{row.number || "–"}</div>
              <div className="ellipsis">
                {row.contactName || "–"}
                <div className="small muted">{LEGACY_TYPES[row.type] ?? row.type}</div>
              </div>
              <div className="num">{formatEuro(row.net)}</div>
              <div className="num">{formatEuro(row.gross)}</div>
              <div className="num">{row.files === 0 ? <span className="pill pill-warn">keine</span> : row.files}</div>
            </Link>
          ))}
          {direction === "alle" ? (
            <div className="table-row" style={{ fontWeight: 600 }}>
              <div>
                {rows.length} Belege{rows.length === 1000 ? " (erste 1000)" : ""} · Einnahmen netto {formatEuro(sumOf("einnahme", "net"))} ·
                Ausgaben netto {formatEuro(sumOf("ausgabe", "net"))}
              </div>
            </div>
          ) : (
            <div className="table-row legacy-cols" style={{ fontWeight: 600 }}>
              <div />
              <div />
              <div>
                {rows.length} Belege{rows.length === 1000 ? " (erste 1000)" : ""}
              </div>
              <div className="num">{formatEuro(sumOf(direction, "net"))}</div>
              <div className="num">{formatEuro(sumOf(direction, "gross"))}</div>
              <div />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
