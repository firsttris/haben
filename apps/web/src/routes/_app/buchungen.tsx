import { formatEuro, periodLabel, previousPeriod, type VatPeriod } from "@haben/core";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { z } from "zod/mini";
import { shortDate } from "../../components/Ledger.tsx";
import { getJournal } from "../../server/functions/journal.ts";
import styles from "../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/buchungen")({
  validateSearch: z.object({ jahr: z.optional(z.int()), monat: z.optional(z.int().check(z.minimum(1), z.maximum(12))) }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const now = new Date();
    const period = { year: deps.jahr ?? now.getFullYear(), month: deps.monat ?? now.getMonth() + 1 };
    return getJournal({ data: period }).then((entries) => ({ period, entries }));
  },
  head: () => ({ meta: [{ title: "Buchungen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: JournalPage,
});

type Entry = Awaited<ReturnType<typeof getJournal>>[number];
type Source = "invoice" | "document" | "allocation" | "asset" | "pauschale" | "kasse";
const SOURCE: Record<Source, string> = { invoice: "Rechnung", document: "Beleg", allocation: "Bank", asset: "Anlage", pauschale: "Pauschale", kasse: "Kasse" };

function nextPeriod({ year, month }: VatPeriod): VatPeriod {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Herkunft als Link auf Rechnung, Beleg, Anlage oder Bank */
function SourcePill({ entry }: { entry: Entry }) {
  const label = entry.reversal ? "Gegenbuchung" : SOURCE[entry.sourceType];
  const id = entry.sourceId;
  if (entry.sourceType === "invoice") return <Link to="/rechnungen/$id" params={{ id }} className="pill">{label}</Link>;
  if (entry.sourceType === "document") return <Link to="/belege/$id" params={{ id }} className="pill">{label}</Link>;
  if (entry.sourceType === "asset") return <Link to="/anlagen/$id" params={{ id }} className="pill">{label}</Link>;
  if (entry.sourceType === "pauschale") return <Link to="/pauschalen" search={{ jahr: Number(entry.date.slice(0, 4)) }} className="pill">{label}</Link>;
  if (entry.sourceType === "kasse") return <Link to="/kasse" search={{ jahr: Number(entry.date.slice(0, 4)) }} className="pill">{label}</Link>;
  return <Link to="/bank" className="pill">{label}</Link>;
}

/** Konten einer Seite: das größte zuerst, weitere als „+n“ */
function Accounts({ lines, period }: { lines: Entry["lines"]; period: VatPeriod }) {
  if (lines.length === 0) return null;
  const [main, ...rest] = [...lines].sort((a, b) => b.debit + b.credit - (a.debit + a.credit));
  return (
    <>
      <Link to="/konten/$konto" params={{ konto: main!.account }} search={{ jahr: period.year, zeitraum: `m${period.month}` }} className="mono" title={main!.name}>
        {main!.account}
      </Link>
      {rest.length > 0 && <span className="more">+{rest.length}</span>}
      <div className="small muted">{main!.name}</div>
    </>
  );
}

function JournalPage() {
  const { period, entries } = Route.useLoaderData();
  const prev = previousPeriod(period);
  const next = nextPeriod(period);
  const [source, setSource] = useState<Source | "alle">("alle");
  const [account, setAccount] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const acc = account.trim();
    return entries.filter(
      (e) =>
        (source === "alle" || e.sourceType === source) &&
        (!acc || e.lines.some((l) => l.account.startsWith(acc))) &&
        (!q || e.description.toLowerCase().includes(q) || e.lines.some((l) => l.name.toLowerCase().includes(q))),
    );
  }, [entries, source, account, query]);

  const amount = (e: Entry) => e.lines.reduce((s, l) => s + l.debit, 0);
  const total = filtered.reduce((s, e) => s + amount(e), 0);
  const counts = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.sourceType]: (acc[e.sourceType] ?? 0) + 1 }), {});
  const toggle = (id: string) =>
    setOpen((prevOpen) => {
      const nextOpen = new Set(prevOpen);
      if (nextOpen.has(id)) nextOpen.delete(id);
      else nextOpen.add(id);
      return nextOpen;
    });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Journal · festgeschrieben</div>
          <h1>Buchungen {periodLabel(period)}</h1>
        </div>
        <div className="actions">
          <Link to="/buchungen" search={{ jahr: prev.year, monat: prev.month }} className="btn">
            ‹ {periodLabel(prev)}
          </Link>
          <Link to="/buchungen" search={{ jahr: next.year, monat: next.month }} className="btn">
            {periodLabel(next)} ›
          </Link>
        </div>
      </div>

      <div className="filter-row">
        <div className="chip-row" role="group" aria-label="Herkunft">
          {(["alle", "invoice", "document", "allocation", "asset", "pauschale"] as const).map((s) => (
            <button key={s} type="button" className={`chip${source === s ? " active" : ""}`} aria-pressed={source === s} onClick={() => setSource(s)}>
              {s === "alle" ? `Alle (${entries.length})` : `${SOURCE[s]} (${counts[s] ?? 0})`}
            </button>
          ))}
        </div>
        <label className="field" style={{ width: 120 }}>
          Konto
          <input value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="z. B. 1200" />
        </label>
        <label className="field" style={{ flex: "1 1 200px", maxWidth: 320 }}>
          Suche
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Text, Kunde, Konto" />
        </label>
      </div>

      <section className="card" aria-label="Buchungen">
        {entries.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Keine Buchungen in diesem Monat.
          </p>
        ) : (
          <table className="report-table journal-table sticky-head stack-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 28 }}>
                  <span className="visually-hidden">Details</span>
                </th>
                <th scope="col">Datum</th>
                <th scope="col">Herkunft</th>
                <th scope="col">Buchungstext</th>
                <th scope="col">Soll</th>
                <th scope="col">Haben</th>
                <th scope="col" className="num">
                  Betrag
                </th>
                <th scope="col">Steuer</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const isOpen = open.has(e.id);
                const debit = e.lines.filter((l) => l.debit > 0);
                const credit = e.lines.filter((l) => l.credit > 0);
                const taxes = [...new Set(e.lines.map((l) => l.taxCode).filter(Boolean))];
                return (
                  <Fragment key={e.id}>
                    <tr>
                      <td>
                        <button type="button" className="expand-btn" aria-expanded={isOpen} aria-label={`Buchungszeilen ${isOpen ? "ausblenden" : "anzeigen"}`} onClick={() => toggle(e.id)}>
                          <span className={`chevron${isOpen ? " open" : ""}`} aria-hidden="true">
                            ›
                          </span>
                        </button>
                      </td>
                      <td data-label="Datum">{shortDate(e.date)}</td>
                      <td data-label="Herkunft">
                        <SourcePill entry={e} />
                      </td>
                      <td data-label="Text">{e.description}</td>
                      <td data-label="Soll">
                        <Accounts lines={debit} period={period} />
                      </td>
                      <td data-label="Haben">
                        <Accounts lines={credit} period={period} />
                      </td>
                      <td className="num" data-label="Betrag">
                        {formatEuro(amount(e))}
                      </td>
                      <td className="small muted" data-label="Steuer">
                        {taxes.join(", ")}
                      </td>
                    </tr>
                    {isOpen &&
                      e.lines.map((l) => (
                        <tr key={l.id} className="lines-row">
                          <td />
                          <td />
                          <td />
                          <td data-label="Konto">
                            <Link to="/konten/$konto" params={{ konto: l.account }} search={{ jahr: period.year, zeitraum: `m${period.month}` }} className="mono">
                              {l.account}
                            </Link>{" "}
                            {l.name}
                          </td>
                          <td className="num" data-label="Soll">
                            {l.debit ? formatEuro(l.debit) : ""}
                          </td>
                          <td className="num" data-label="Haben">
                            {l.credit ? formatEuro(l.credit) : ""}
                          </td>
                          <td />
                          <td className="small muted" data-label="Steuer">
                            {l.taxCode ?? ""}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Keine Buchung passt zum Filter.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={6}>
                  {filtered.length === entries.length ? `${entries.length} Buchungen` : `${filtered.length} von ${entries.length} Buchungen`}
                </th>
                <td className="num" data-label="Summe">
                  {formatEuro(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </section>
    </>
  );
}
