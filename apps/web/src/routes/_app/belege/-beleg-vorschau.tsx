import type { getDocumentDetail } from "../../../server/functions/documents.ts";

export type Detail = Awaited<ReturnType<typeof getDocumentDetail>>;

export function Preview({ doc }: { doc: Detail["document"] }) {
  const src = `/api/beleg/${doc.id}`;
  if (doc.mimeType === "application/pdf") {
    return (
      <>
        <iframe className="doc-preview" src={`${src}#view=Fit`} title={`Beleg ${doc.filename}`} />
        <a className="btn pdf-open" href={src} target="_blank" rel="noreferrer">
          PDF öffnen
        </a>
      </>
    );
  }
  if (doc.mimeType.startsWith("image/") && doc.mimeType !== "image/heic") {
    return <img className="doc-image" src={src} alt={`Beleg ${doc.filename}`} />;
  }
  return (
    <section className="card">
      <p className="muted" style={{ margin: 0 }}>
        Für {doc.mimeType === "application/xml" ? "XML-Rechnungen" : "dieses Format"} gibt es keine Vorschau.{" "}
        <a href={src} target="_blank" rel="noreferrer">
          Datei öffnen
        </a>
      </p>
    </section>
  );
}
