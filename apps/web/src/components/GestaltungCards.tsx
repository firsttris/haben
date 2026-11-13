import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { BackgroundPages, LetterheadDesign } from "@haben/core";
import { useAction } from "../lib/use-action.ts";
import { deleteBackground, getBackground, saveLetterheadDesign, uploadBackground } from "../server/functions/logo.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { DesignOptionFields, Segmented, useDesignDraft } from "./DesignPanel.tsx";
import { ImageUpload } from "./ImageUpload.tsx";
import { layoutHint, LayoutHintText, layoutHintId, type LayoutHints } from "./LayoutHint.tsx";
import { LogoUpload } from "./LogoUpload.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Größe und Seite des Logos und die Schalter, auch ohne einen Beleg geöffnet zu haben */
export function LetterheadOptionsCard({ design, logo, hints }: { design: LetterheadDesign; logo: string | null; hints?: LayoutHints | undefined }) {
  const draft = useDesignDraft(design);
  const router = useRouter();
  const save = useServerFn(saveLetterheadDesign);
  const { busy, notice, run } = useAction();

  const onSave = () =>
    run(async () => {
      const sent = draft.changes;
      await save({ data: sent });
      draft.commit(sent);
      await router.invalidate();
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <section className="card design-card" aria-labelledby="blatt-heading">
      <h2 id="blatt-heading">Logo und Blatt</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Logo als PNG (gern mit transparentem Hintergrund) oder JPEG, bis 1 MB. Schon festgeschriebene Belege behalten ihr PDF.
      </p>
      <DesignOptionFields
        design={draft.design}
        onChange={draft.set}
        hints={hints}
        logoUpload={
          <LogoUpload
            sha256={logo}
            onChanged={() => router.invalidate()}
            disabled={layoutHint(hints, "logo")?.aus}
            describedBy={layoutHintId("logo", layoutHint(hints, "logo"))}
          />
        }
      />
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !draft.dirty} onClick={() => void onSave()}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}

const BACKGROUND_TEXTS = {
  name: "Briefpapier",
  empty: "Noch kein Briefpapier.",
  alt: "Aktuelles Briefpapier",
  fileLabel: "Datei für das Briefpapier",
  upload: "Briefpapier hochladen",
  replace: "Anderes Briefpapier wählen",
  saved: "Briefpapier gespeichert. Es gilt für alles, was ab jetzt erzeugt wird.",
  removed: "Briefpapier entfernt.",
  removeConsequence:
    "Was ab jetzt erzeugt wird, steht auf weißem Papier, und die Fußzeile ist wieder zu sehen; schon festgeschriebene Belege behalten ihr PDF. Zurück kommt es nur, indem du es neu hochlädst.",
  tooBig: "Das Briefpapier darf höchstens 2 MB groß sein.",
};

const BACKGROUND_PAGE_OPTIONS: { value: BackgroundPages; label: string; name: string }[] = [
  { value: "erste", label: "Erste Seite", name: "Nur auf der ersten Seite" },
  { value: "alle", label: "Alle Seiten", name: "Auf allen Seiten" },
];

/** Bild hinter dem Beleg, etwa der gedruckte Briefbogen als Scan */
export function LetterheadBackgroundCard({
  design,
  background,
  hints,
}: {
  design: LetterheadDesign;
  background: string | null;
  hints?: LayoutHints | undefined;
}) {
  const backgroundHint = layoutHint(hints, "background");
  const pagesHint = layoutHint(hints, "backgroundPages");
  const draft = useDesignDraft(design);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const save = useServerFn(saveLetterheadDesign);
  const upload = useServerFn(uploadBackground);
  const remove = useServerFn(deleteBackground);
  const load = useServerFn(getBackground);
  const { busy, notice, run } = useAction();

  const onSave = () =>
    run(async () => {
      const sent = draft.changes;
      await save({ data: sent });
      draft.commit(sent);
      await router.invalidate();
    }, "Gespeichert. Gilt für alles, was ab jetzt erzeugt wird.");

  return (
    <section className="card design-card" aria-labelledby="briefpapier-heading">
      <h2 id="briefpapier-heading">Briefpapier</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Bild hinter dem Beleg, im Format A4 hochkant (mindestens 1240 × 1754 Pixel), als PNG, JPEG oder PDF bis 2 MB. Von einem PDF nimmt Haben die erste Seite
        als Bild. Dein hochgeladenes Logo liegt über dem Briefpapier; hat dein Briefbogen schon eins, entferne es unter „Logo und Blatt“. Schon festgeschriebene
        Belege behalten ihr PDF.
      </p>
      <ImageUpload
        sha256={background}
        url="/api/briefpapier"
        maxBytes={2 * 1024 * 1024}
        texts={BACKGROUND_TEXTS}
        upload={upload}
        remove={() => remove()}
        load={() => load()}
        accept="image/png,image/jpeg,application/pdf"
        disabled={backgroundHint?.aus}
        describedBy={layoutHintId("background", backgroundHint)}
        onChanged={async (sha256) => {
          // Ohne Briefpapier gilt der Fuß wieder; ein neues Bild soll ihn nicht unbemerkt abschalten
          if (sha256 === null) {
            draft.set({ footerHidden: false });
            if (design.footerHidden) await save({ data: { footerHidden: false } });
          }
          await router.invalidate();
        }}
      />
      <LayoutHintText option="background" hint={backgroundHint} />
      <Segmented
        label="Seiten mit Briefpapier"
        options={BACKGROUND_PAGE_OPTIONS}
        value={draft.design.backgroundPages}
        onChange={(backgroundPages) => draft.set({ backgroundPages })}
        disabled={pagesHint?.aus}
        describedBy={layoutHintId("backgroundPages", pagesHint)}
      />
      <LayoutHintText option="backgroundPages" hint={pagesHint} />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.design.footerHidden}
          disabled={!background || busy}
          onChange={(event) => (event.target.checked ? setConfirming(true) : draft.set({ footerHidden: false }))}
        />
        Fußzeile steht auf dem Briefpapier
      </label>
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !draft.dirty} onClick={() => void onSave()}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirming}
        title="Fußzeile weglassen?"
        confirmLabel="Fußzeile weglassen"
        onConfirm={() => draft.set({ footerHidden: true })}
        onClose={() => setConfirming(false)}
      >
        <p>
          Haben druckt dann keine Fußzeile mehr, nur noch die Seitenzahl. Steuernummer oder USt-IdNr. muss dann auf dem Briefpapier stehen (§ 14 Abs. 4 Nr. 2
          UStG), bei Reverse Charge und innergemeinschaftlicher Lieferung die USt-IdNr. (§ 14a UStG), bei GmbH und UG auch die Angaben nach § 35a GmbHG.
        </p>
        <p>Haben kann das im Bild nicht prüfen.</p>
      </ConfirmDialog>
    </section>
  );
}
