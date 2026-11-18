import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { duplicateDocumentFn } from "../server/functions/documents.ts";
import { BELEG_DATEITYPEN } from "./DocumentUpload.tsx";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { UploadButton } from "./UploadButton.tsx";

/** Suchparameter der Seite, zu der „Beleg duplizieren“ führt: das Original oder, bei schon vorhandener Datei, `vorhanden` */
export type DuplikatZiel = { dupliziert?: string; vorhanden?: boolean };

/**
 * Beleg duplizieren (#1295): `knopf` wählt die neue Datei, der Server legt damit einen Entwurf mit den Feldern dieses
 * Belegs an, `weiter` führt hin. `hinweise` stehen unter dem Seitenkopf, nicht in der Knopfzeile: ein Fehler, nur beim
 * Beleg, an dem er entstand, und auf der Zielseite (`ziel`) der Hinweis auf das Duplikat.
 */
export function useBelegDuplizieren(beleg: { id: string; entwurf: boolean }, ziel: DuplikatZiel, weiter: (id: string, ziel: DuplikatZiel) => void) {
  const duplicate = useServerFn(duplicateDocumentFn);
  const { busy, notice, run } = useAction();
  const [fuer, setFuer] = useState(beleg.id);
  function onFiles([file]: File[]) {
    setFuer(beleg.id);
    void run(async () => {
      const form = new FormData();
      form.append("id", beleg.id);
      form.append("file", file!);
      const result = await duplicate({ data: form });
      weiter(result.id, result.duplicate ? { vorhanden: true } : { dupliziert: beleg.id });
    });
  }
  const knopf = (
    <UploadButton accept={BELEG_DATEITYPEN} disabled={busy} inputLabel="Datei für das Duplikat" onFiles={onFiles}>
      Beleg duplizieren
    </UploadButton>
  );
  const hinweise = (
    <>
      <NoticeBanner notice={fuer === beleg.id ? notice : null} />
      <DuplikatHinweis ziel={ziel} entwurf={beleg.entwurf} />
    </>
  );
  return { knopf, hinweise };
}

/** Hinweis auf dem neuen Entwurf (solange er nicht gebucht ist) oder auf dem Beleg, dem die gewählte Datei schon gehört */
function DuplikatHinweis({ ziel, entwurf }: { ziel: DuplikatZiel; entwurf: boolean }) {
  if (!ziel.vorhanden && !(ziel.dupliziert && entwurf)) return null;
  return (
    <div className="banner banner-info" role="status">
      <Icon name="info" />
      {ziel.vorhanden ? (
        <span>Die gewählte Datei liegt schon in Haben; das ist ihr Beleg, dupliziert wurde nichts.</span>
      ) : (
        <span>
          Dupliziert aus einem{" "}
          <Link to="/belege/$id" params={{ id: ziel.dupliziert! }}>
            früheren Beleg
          </Link>
          : Lieferant, Kategorie, Bezahlung und Beträge sind übernommen, das Belegdatum ist heute. Bitte Rechnungsnummer eintragen und Beträge prüfen.
        </span>
      )}
    </div>
  );
}
