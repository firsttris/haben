import { formatEuro, skontoOffer } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { createSepaTransferFn, getTransferPage } from "../../server/functions/sepa.ts";

export const Route = createFileRoute("/_app/ueberweisungen")({
  loader: () => getTransferPage(),
  head: () => ({ meta: [{ title: "Überweisungen · Haben" }] }),
  component: TransferPage,
});

type Data = Awaited<ReturnType<typeof getTransferPage>>;
type Candidate = Data["candidates"][number];

/** IBAN in Vierergruppen, wie sie auf Rechnungen steht */
const groupedIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

function TransferPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben</div>
          <h1>Überweisungen</h1>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Offene <Link to="/belege">Belege</Link> als SEPA-Datei (pain.001) zum Hochladen ins Online-Banking. Gebucht wird dabei nichts: Bezahlt ist ein Beleg
        erst, wenn der <Link to="/bank">Bankabgleich</Link> die Abbuchung zuordnet. Die Referenz jeder Überweisung hilft ihm dabei.
      </p>
      <TransferForm data={data} />
      <TransferFiles data={data} />
    </>
  );
}

/** Lädt die erzeugte Datei herunter, ohne die Seite zu verlassen */
function download(id: string, filename: string) {
  const link = document.createElement("a");
  link.href = `/api/ueberweisung/${id}`;
  link.download = filename;
  link.click();
}

function TransferForm({ data }: { data: Data }) {
  const router = useRouter();
  const create = useServerFn(createSepaTransferFn);
  const { busy, notice, setNotice, run } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skonto, setSkonto] = useState<Set<string>>(new Set());
  const [executionDate, setExecutionDate] = useState(data.today);
  const payable = data.candidates.filter((c) => c.problem === null);
  const offer = (c: Candidate) => (c.documentDate ? skontoOffer(c.skontoTerms, c.documentDate, executionDate, c.open) : null);
  const amountOf = (c: Candidate) => c.open - (skonto.has(c.documentId) ? (offer(c)?.amount ?? 0) : 0);
  const chosen = payable.filter((c) => selected.has(c.documentId));
  const total = chosen.reduce((sum, c) => sum + amountOf(c), 0);

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bankAccountId = String(new FormData(event.currentTarget).get("account") ?? "");
    const created: { file?: { id: string; filename: string } } = {};
    const ok = await run(async () => {
      created.file = await create({
        data: {
          bankAccountId,
          executionDate,
          items: chosen.map((c) => ({ documentId: c.documentId, skonto: skonto.has(c.documentId) && offer(c) !== null })),
        },
      });
    });
    if (!ok || !created.file) return;
    const { id, filename } = created.file;
    download(id, filename);
    setSelected(new Set());
    setSkonto(new Set());
    await router.invalidate();
    setNotice({ tone: "ok", text: `${filename} erzeugt: ${chosen.length} Überweisung${chosen.length === 1 ? "" : "en"} über ${formatEuro(total)}.` });
  }

  if (data.accounts.length === 0) {
    return (
      <section className="card">
        <p className="muted" style={{ margin: 0 }}>
          Für eine Überweisung braucht Haben das Konto, von dem sie abgeht. Lege es unter <Link to="/bank">Bank</Link> an.
        </p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-label="SEPA-Überweisung erzeugen">
      <h2 style={{ margin: 0, fontSize: 16 }}>Offene Belege</h2>
      <div className="form-grid">
        <label className="field">
          Auftraggeberkonto
          <select name="account" defaultValue={data.accounts.find((a) => a.purpose === "geschaeft")?.id ?? data.accounts[0]!.id}>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {groupedIban(a.iban)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Ausführungsdatum
          <input type="date" value={executionDate} min={data.today} required onChange={(e) => setExecutionDate(e.target.value)} />
        </label>
      </div>
      {data.candidates.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Keine offenen Belege, die per Bank zu bezahlen sind.
        </p>
      ) : (
        <div className="table">
          <div className="table-row head transfer-cols">
            <div />
            <div>Fällig</div>
            <div>Lieferant</div>
            <div>Konto</div>
            <div className="num">Betrag</div>
          </div>
          {data.candidates.map((c) => (
            <CandidateRow
              key={c.documentId}
              candidate={c}
              selected={selected.has(c.documentId)}
              onSelect={(on) => setSelected(toggle(selected, c.documentId, on))}
              skonto={skonto.has(c.documentId)}
              onSkonto={(on) => setSkonto(toggle(skonto, c.documentId, on))}
              offer={offer(c)}
              amount={amountOf(c)}
            />
          ))}
        </div>
      )}
      <div className="actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setSelected(new Set(payable.map((c) => c.documentId)))} disabled={payable.length === 0}>
            Alle auswählen
          </button>
          <span className="small muted" aria-live="polite">
            {chosen.length} ausgewählt · {formatEuro(total)}
          </span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || chosen.length === 0}>
          SEPA-Datei erzeugen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

function CandidateRow(props: {
  candidate: Candidate;
  selected: boolean;
  onSelect: (on: boolean) => void;
  skonto: boolean;
  onSkonto: (on: boolean) => void;
  offer: ReturnType<typeof skontoOffer>;
  amount: number;
}) {
  const { candidate: c, offer } = props;
  const name = c.supplierName || "Beleg";
  const label = `${name} ${c.invoiceNumber}`.trim();
  const last = c.transfers[0];
  return (
    <div className="table-row transfer-cols">
      <div>
        <input
          type="checkbox"
          className="row-check"
          checked={props.selected && c.problem === null}
          disabled={c.problem !== null}
          onChange={(e) => props.onSelect(e.target.checked)}
          aria-label={`${label} überweisen`}
        />
      </div>
      <div className="small muted">{c.dueDate ? formatDate(c.dueDate) : c.documentDate ? formatDate(c.documentDate) : "–"}</div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <Link to="/belege/$id" params={{ id: c.documentId }} className="ellipsis">
          {name}
        </Link>
        <span className="small muted ellipsis">{c.invoiceNumber || "ohne Rechnungsnummer"}</span>
        {last && (
          <span className="small muted">
            Überweisung erzeugt am {formatDateTime(last.createdAt)} ({formatEuro(last.amount)})
          </span>
        )}
        {offer && (
          <label className="checkbox" style={{ minHeight: 28 }}>
            <input type="checkbox" checked={props.skonto} disabled={c.problem !== null} onChange={(e) => props.onSkonto(e.target.checked)} />
            <span className="small">
              {(offer.term.percent / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} % Skonto bis {formatDate(offer.until)} abziehen (
              {formatEuro(offer.amount)})
            </span>
          </label>
        )}
      </div>
      <div className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {c.problem ? (
          <span style={{ color: "var(--danger-ink)" }}>
            {c.problem}
            {c.ibanDecisionNeeded && (
              <>
                {" "}
                <Link to="/belege/$id" params={{ id: c.documentId }} aria-label={`${label}: am Beleg entscheiden`}>
                  Zum Beleg
                </Link>
              </>
            )}
          </span>
        ) : (
          <>
            <span className="mono">{groupedIban(c.iban!)}</span>
            <span className="muted" style={{ display: "block" }}>
              aus {c.ibanSource === "kontakt" ? "dem Kontakt" : "der E-Rechnung"}
            </span>
          </>
        )}
        {c.warning && (
          <span style={{ display: "block", color: "var(--warn-ink)" }} role="note">
            {c.warning}
          </span>
        )}
      </div>
      <div className="num">
        {formatEuro(props.amount)}
        {props.amount !== c.open && (
          <span className="small muted" style={{ display: "block" }}>
            statt {formatEuro(c.open)}
          </span>
        )}
      </div>
    </div>
  );
}

function TransferFiles({ data }: { data: Data }) {
  if (data.transfers.length === 0) return null;
  return (
    <section className="card" aria-label="Erzeugte Dateien">
      <h2 style={{ margin: 0, fontSize: 16 }}>Erzeugte Dateien</h2>
      <div className="table">
        <div className="table-row head sepa-file-cols">
          <div>Erzeugt</div>
          <div>Ausführung</div>
          <div>Konto</div>
          <div className="num">Betrag</div>
          <div />
        </div>
        {data.transfers.map((t) => (
          <div key={t.id} className="table-row sepa-file-cols">
            <div className="small muted">{formatDateTime(t.createdAt)}</div>
            <div className="small">{formatDate(t.executionDate)}</div>
            <div className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {t.accountName}
              <span className="muted" style={{ display: "block" }}>
                {t.numberOfTransactions} Überweisung{t.numberOfTransactions === 1 ? "" : "en"}
              </span>
            </div>
            <div className="num">{formatEuro(t.controlSum)}</div>
            <div style={{ justifySelf: "end" }}>
              <a className="btn btn-sm" href={`/api/ueberweisung/${t.id}`} download={`${t.messageId}.xml`} aria-label={`${t.messageId}.xml herunterladen`}>
                Herunterladen
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
