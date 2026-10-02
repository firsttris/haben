import { formatDate, formatDateTime } from "../../lib/format.ts";
import type { getMigration } from "../../server/functions/archive.ts";
import { ArchiveUpload } from "./ArchiveUpload.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function ArchiveFiles({ files, kinds }: { files: MigrationData["files"]; kinds: MigrationData["kinds"] }) {
  const label = Object.fromEntries(kinds.map((k) => [k.value, k.label]));
  return (
    <div className="stack">
      <section className="card stack" aria-label="Originaldateien">
        {files.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Noch keine Dateien im Archiv.</p>
        ) : (
          <div className="table">
            <div className="table-row head archive-file-cols">
              <div>Jahr</div>
              <div>Art</div>
              <div>Datei</div>
              <div style={{ textAlign: "right" }}>Größe</div>
              <div>Abgelegt</div>
            </div>
            {files.map((file) => (
              <div key={file.id} className="table-row archive-file-cols">
                <div className="mono small">{file.year ?? "–"}</div>
                <div className="small">{label[file.kind] ?? file.kind}</div>
                <div className="ellipsis">
                  <a href={`/api/archiv/${file.id}`} target="_blank" rel="noreferrer">
                    {file.filename}
                  </a>
                  <div className="small muted ellipsis" title={`SHA-256 ${file.sha256}`}>
                    {file.bookings !== null
                      ? `${file.bookings} Buchungen, ${file.dateFrom ? formatDate(file.dateFrom) : ""} bis ${file.dateTo ? formatDate(file.dateTo) : ""}`
                      : `SHA-256 ${file.sha256.slice(0, 16)}…`}
                  </div>
                </div>
                <div className="num small">{formatSize(file.size)}</div>
                <div className="small muted">{formatDateTime(file.uploadedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card stack" aria-labelledby="archive-upload-heading">
        <h2 id="archive-upload-heading" style={{ margin: 0 }}>Datei ablegen</h2>
        <ArchiveUpload kinds={kinds} />
      </section>
    </div>
  );
}
