import { formatEuro } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { createDirectDebitFileFn, getDirectDebitPage } from "../../server/functions/sepa.ts";
import { Field } from "../../components/Field.tsx";

export const Route = createFileRoute("/_app/lastschriften")({
  loader: () => getDirectDebitPage(),
  head: () => ({ meta: [{ title: "Lastschriften · Haben" }] }),
  component: DirectDebitPage,
});

type Data = Awaited<ReturnType<typeof getDirectDebitPage>>;
type Candidate = Data["candidates"][number];

/** IBAN in Vierergruppen, wie sie auf Rechnungen steht */
const groupedIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

const SEQUENCE_LABEL = { FRST: "Erstlastschrift", RCUR: "Folgelastschrift" } as const;

function DirectDebitPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Lastschriften</h1>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Fällige <Link to="/rechnungen">Rechnungen</Link> mit Zahlungsart Lastschrift als Sammeldatei (pain.008) zum Hochladen ins Online-Banking. Gebucht wird
        dabei nichts: Bezahlt ist eine Rechnung erst, wenn der <Link to="/bank">Bankabgleich</Link> die Gutschrift zuordnet.
      </p>
      <DirectDebitForm data={data} />
      <DirectDebitFiles data={data} />
    </>
  );
}

/** Lädt die erzeugte Datei herunter, ohne die Seite zu verlassen */
function download(id: string, filename: string) {
  const link = document.createElement("a");
  link.href = `/api/lastschrift/${id}`;
  link.download = filename;
  link.click();
}

function DirectDebitForm({ data }: { data: Data }) {
  const router = useRouter();
  const create = useServerFn(createDirectDebitFileFn);
  const { busy, notice, setNotice, run } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const collectable = data.candidates.filter((c) => c.problem === null);
  const chosen = collectable.filter((c) => selected.has(c.invoiceId));
  const total = chosen.reduce((sum, c) => sum + c.open, 0);

  function toggle(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bankAccountId = String(new FormData(event.currentTarget).get("account") ?? "");
    const created: { file?: { id: string; filename: string } } = {};
    const ok = await run(async () => {
      created.file = await create({ data: { bankAccountId, invoiceIds: chosen.map((c) => c.invoiceId) } });
    });
    if (!ok || !created.file) return;
    const { id, filename } = created.file;
    download(id, filename);
    setSelected(new Set());
    await router.invalidate();
    setNotice({ tone: "ok", text: `${filename} erzeugt: ${chosen.length} Lastschrift${chosen.length === 1 ? "" : "en"} über ${formatEuro(total)}.` });
  }

  if (data.accounts.length === 0) {
    return (
      <section className="card">
        <p className="muted" style={{ margin: 0 }}>
          Für eine Lastschrift braucht Haben das Konto, auf dem der Betrag eingeht. Lege es unter <Link to="/bank">Bank</Link> an.
        </p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-label="SEPA-Lastschrift erzeugen">
      <h2 style={{ margin: 0, fontSize: 16 }}>Fällige Rechnungen</h2>
      <div className="form-grid">
        <Field label="Gläubigerkonto">
          {(control) => (
            <select {...control} name="account" defaultValue={data.accounts.find((a) => a.purpose === "geschaeft")?.id ?? data.accounts[0]!.id}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {groupedIban(a.iban)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {data.candidates.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Keine offenen Rechnungen mit Zahlungsart Lastschrift.
        </p>
      ) : (
        <div className="table">
          <div className="table-row head transfer-cols">
            <div />
            <div>Einzug</div>
            <div>Kunde</div>
            <div>Mandat</div>
            <div className="num">Betrag</div>
          </div>
          {data.candidates.map((c) => (
            <CandidateRow key={c.invoiceId} candidate={c} selected={selected.has(c.invoiceId)} onSelect={(on) => toggle(c.invoiceId, on)} />
          ))}
        </div>
      )}
      <div className="actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setSelected(new Set(collectable.map((c) => c.invoiceId)))} disabled={collectable.length === 0}>
            Alle auswählen
          </button>
          <span className="small muted" aria-live="polite">
            {chosen.length} ausgewählt · {formatEuro(total)}
          </span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || chosen.length === 0}>
          Lastschriftdatei erzeugen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

function CandidateRow({ candidate: c, selected, onSelect }: { candidate: Candidate; selected: boolean; onSelect: (on: boolean) => void }) {
  const label = `${c.customerName} ${c.number}`.trim();
  return (
    <div className="table-row transfer-cols">
      <div>
        <input
          type="checkbox"
          className="row-check"
          checked={selected && c.problem === null}
          disabled={c.problem !== null}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`${label} einziehen`}
        />
      </div>
      <div className="small">
        {formatDate(c.collectionDate)}
        {c.collectionDate !== c.dueDate && (
          <span className="muted" style={{ display: "block" }}>
            fällig {formatDate(c.dueDate)}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <Link to="/rechnungen/$id" params={{ id: c.invoiceId }} className="ellipsis">
          {c.customerName || "Rechnung"}
        </Link>
        <span className="small muted ellipsis">Rechnung {c.number}</span>
      </div>
      <div className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {c.problem ? (
          <span style={{ color: "var(--danger-ink)" }}>{c.problem}</span>
        ) : (
          <>
            <span className="mono">{c.mandateReference}</span>
            <span className="muted" style={{ display: "block" }}>
              {c.scheme} · {SEQUENCE_LABEL[c.sequence]}
            </span>
          </>
        )}
      </div>
      <div className="num">{formatEuro(c.open)}</div>
    </div>
  );
}

function DirectDebitFiles({ data }: { data: Data }) {
  if (data.files.length === 0) return null;
  return (
    <section className="card" aria-label="Erzeugte Dateien">
      <h2 style={{ margin: 0, fontSize: 16 }}>Erzeugte Dateien</h2>
      <div className="table">
        <div className="table-row head sepa-file-cols">
          <div>Erzeugt</div>
          <div>Einzug</div>
          <div>Konto</div>
          <div className="num">Betrag</div>
          <div />
        </div>
        {data.files.map((f) => (
          <div key={f.id} className="table-row sepa-file-cols">
            <div className="small muted">{formatDateTime(f.createdAt)}</div>
            <div className="small">{f.collectionDate ? formatDate(f.collectionDate) : "–"}</div>
            <div className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              {f.accountName}
              <span className="muted" style={{ display: "block" }}>
                {f.numberOfTransactions} Lastschrift{f.numberOfTransactions === 1 ? "" : "en"}
              </span>
            </div>
            <div className="num">{formatEuro(f.controlSum)}</div>
            <div style={{ justifySelf: "end" }}>
              <a className="btn btn-sm" href={`/api/lastschrift/${f.id}`} download={`${f.messageId}.xml`} aria-label={`${f.messageId}.xml herunterladen`}>
                Herunterladen
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
