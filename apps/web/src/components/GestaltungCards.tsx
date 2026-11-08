import { useServerFn } from "@tanstack/react-start";
import { BUILTIN_LAYOUTS, LAYOUT_DOCUMENT_LABELS, LAYOUT_DOCUMENT_TYPES, type LetterheadDesign, type LayoutRef } from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { saveLetterheadDesign } from "../server/functions/logo.ts";
import { DesignOptionFields, useDesignDraft } from "./DesignPanel.tsx";
import { LogoUpload } from "./LogoUpload.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Größe und Seite des Logos und die Schalter, auch ohne einen Beleg geöffnet zu haben */
export function LetterheadOptionsCard({ design, logo }: { design: LetterheadDesign; logo: string | null }) {
  const draft = useDesignDraft(design);
  const save = useServerFn(saveLetterheadDesign);
  const { busy, notice, run } = useAction();

  const onSave = () =>
    run(async () => {
      await save({ data: draft.changes });
      draft.commit();
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <section className="card design-card" aria-labelledby="blatt-heading">
      <h2 id="blatt-heading">Logo und Blatt</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Logo als PNG (gern mit transparentem Hintergrund) oder JPEG, bis 1 MB. Schon festgeschriebene Belege behalten ihr PDF.
      </p>
      <DesignOptionFields design={draft.design} onChange={draft.set} logoUpload={<LogoUpload sha256={logo} />} />
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !draft.dirty} onClick={() => void onSave()}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}

const layoutName = (layout: LayoutRef) => BUILTIN_LAYOUTS.find((entry) => entry.id === layout.id)?.name ?? layout.id;

/** Welches Layout welche Belegart bekommt; zur Wahl steht es, sobald es ein zweites gibt */
export function LayoutsCard({ design }: { design: LetterheadDesign }) {
  return (
    <section className="card" aria-labelledby="layouts-heading">
      <h2 id="layouts-heading">Layouts</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Jede Belegart hat ihr eigenes Layout. Noch gibt es nur das eingebaute Layout „{BUILTIN_LAYOUTS[0]!.name}“.
      </p>
      <table className="layouts-table">
        <thead>
          <tr>
            <th scope="col">Belegart</th>
            <th scope="col">Layout</th>
            <th scope="col">Art</th>
          </tr>
        </thead>
        <tbody>
          {LAYOUT_DOCUMENT_TYPES.map((type) => (
            <tr key={type}>
              <td>{LAYOUT_DOCUMENT_LABELS[type]}</td>
              <td>{layoutName(design.layouts[type])}</td>
              <td>Eingebaut</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
