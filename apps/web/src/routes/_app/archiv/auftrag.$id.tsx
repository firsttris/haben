import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ORDER_KINDS, ORDER_STATUSES } from "../../../components/archiv/OrderDocuments.tsx";
import { FilePicker } from "../../../components/FilePicker.tsx";
import { errorMessage, formatDate, formatDateTime } from "../../../lib/format.ts";
import { getOrderDocument, uploadOrderPdf } from "../../../server/functions/archive.ts";
import styles from "../../../styles/archiv.css?url";

export const Route = createFileRoute("/_app/archiv/auftrag/$id")({
  loader: ({ params }) => getOrderDocument({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.document.number || "Auftragsdokument"} · Archiv · Haben` }],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: OrderDocumentPage,
});

function OrderDocumentPage() {
  const { document, files } = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/archiv" search={{ ansicht: "auftraege", jahr: Number(document.date.slice(0, 4)) }}>
              Archiv
            </Link>{" "}
            › {ORDER_KINDS[document.kind]} aus sevdesk
          </div>
          <h1>{document.number || "Auftragsdokument"}</h1>
        </div>
      </div>
      <p className="banner banner-info">Unveränderliche Archivkopie ohne Buchungswirkung. Kein bearbeitbarer Haben-Entwurf.</p>
      <div className="grid-main">
        <OrderFiles files={files} id={document.id} />
        <OrderFacts document={document} />
      </div>
    </>
  );
}

function OrderPdfUpload({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileVersion, setFileVersion] = useState(0);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    try {
      await uploadOrderPdf({ data: new FormData(form) });
      form.reset();
      setFileVersion((value) => value + 1);
      await router.invalidate();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={upload} className="stack">
      <input type="hidden" name="id" value={id} />
      <fieldset className="fieldset-plain" disabled={busy}>
        <label className="field">
          Original-PDF ergänzen
          <FilePicker key={fileVersion} name="file" accept="application/pdf,.pdf" required />
        </label>
      </fieldset>
      <button type="submit" className="btn btn-secondary" disabled={busy}>
        {busy ? "Wird gespeichert …" : "PDF anhängen"}
      </button>
      <p className="small muted">Bestehende Dateien und Quelldaten bleiben erhalten.</p>
      {error && (
        <p role="alert" className="banner banner-danger">
          {error}
        </p>
      )}
    </form>
  );
}

type OrderDetail = Awaited<ReturnType<typeof getOrderDocument>>;

function OrderFiles({ files, id }: { files: OrderDetail["files"]; id: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const file = files.find((f) => f.id === selected) ?? files[0];
  return (
    <section className="card stack" aria-label="Dateien">
      {files.length > 1 && (
        <label className="field">
          Datei auswählen
          <select value={file?.id} onChange={(event) => setSelected(event.target.value)}>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
              </option>
            ))}
          </select>
        </label>
      )}
      {file ? (
        <>
          <iframe className="doc-preview" src={`/api/archiv/auftragsdatei/${file.id}#view=Fit`} title={file.filename} />
          <a className="btn btn-secondary" href={`/api/archiv/auftragsdatei/${file.id}?download`}>
            PDF herunterladen
          </a>
          <p className="small muted archive-fingerprint">
            {file.origin === "manuell" ? "Manuell nachgereicht" : "Aus sevdesk abgerufen"} am {formatDateTime(file.createdAt)} · SHA-256 {file.sha256}
          </p>
        </>
      ) : (
        <p className="banner banner-info">PDF noch nicht übernommen. Das Original-PDF kann unten nachgereicht werden.</p>
      )}
      <OrderPdfUpload id={id} />
    </section>
  );
}

function OrderFacts({ document }: { document: OrderDetail["document"] }) {
  const positions = document.positions;
  const relations = document.relatedObjects;
  return (
    <section className="card stack" aria-label="Angaben">
      <dl className="facts">
        <dt>Datum</dt>
        <dd>{formatDate(document.date)}</dd>
        <dt>Kontakt</dt>
        <dd>{document.contactName || "–"}</dd>
        <dt>Status bei Archivierung</dt>
        <dd>{ORDER_STATUSES[document.status] ?? document.status}</dd>
        <dt>Quell-ID</dt>
        <dd>{document.externalId}</dd>
        <dt>Archiviert am</dt>
        <dd>{formatDateTime(document.createdAt)}</dd>
      </dl>
      <h2>Positionen aus sevdesk</h2>
      {positions.length ? (
        <ol>
          {positions.map((position, i) => (
            <li key={String(position.id ?? i)}>
              {String(position.name ?? "Position")} {position.quantity != null ? `· Menge ${String(position.quantity)}` : ""}
              {position.text ? <p className="small">{String(position.text)}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Keine Positionen geliefert.</p>
      )}
      {relations !== "[]" && (
        <details>
          <summary>Verknüpfungen aus sevdesk</summary>
          <pre className="archive-proof">{relations}</pre>
        </details>
      )}
    </section>
  );
}
