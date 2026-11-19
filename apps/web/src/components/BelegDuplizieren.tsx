import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import type { getDocumentDetail } from "../server/functions/documents.ts";
import { duplicateDocumentFn } from "../server/functions/documents.ts";
import { BELEG_DATEITYPEN } from "./DocumentUpload.tsx";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { UploadButton } from "./UploadButton.tsx";

type Detail = Awaited<ReturnType<typeof getDocumentDetail>>;

/** Suchparameter der Seite, zu der „Beleg duplizieren“ führt: das Original oder, bei schon vorhandener Datei, `vorhanden` */
export type DuplikatZiel = { dupliziert?: string; vorhanden?: boolean };

/**
 * Beleg duplizieren (#1295): `knopf` wählt die neue Datei, der Server legt damit einen Entwurf mit den gespeicherten
 * Feldern dieses Belegs an, `weiter` führt hin. Mit ungespeicherten Änderungen (`dirty`) entsteht nichts: Dupliziert würde
 * der gespeicherte Stand, und beim Wechsel gingen die Änderungen verloren. `hinweise` stehen unter dem Seitenkopf, nicht in
 * der Knopfzeile: ein Fehler, nur beim Beleg, an dem er entstand, und auf der Zielseite (`ziel`) der Hinweis zum Duplikat.
 */
export function useBelegDuplizieren(data: Detail, ziel: DuplikatZiel, dirty: boolean, weiter: (id: string, ziel: DuplikatZiel) => void) {
  const duplicate = useServerFn(duplicateDocumentFn);
  const { busy, notice, setNotice, run } = useAction();
  const id = data.document.id;
  const [fuer, setFuer] = useState(id);
  function onFiles([file]: File[]) {
    setFuer(id);
    if (dirty) {
      setNotice({ tone: "info", text: "Der Beleg hat ungespeicherte Änderungen. Speichere ihn zuerst; dupliziert wird der gespeicherte Stand." });
      return;
    }
    void run(async () => {
      const form = new FormData();
      form.append("id", id);
      form.append("file", file!);
      const result = await duplicate({ data: form });
      weiter(result.id, result.duplicate ? { vorhanden: true } : { dupliziert: id });
    });
  }
  const knopf = (
    <UploadButton accept={BELEG_DATEITYPEN} disabled={busy} inputLabel="Datei für das Duplikat" onFiles={onFiles}>
      Beleg duplizieren
    </UploadButton>
  );
  // Ein übernommener Vorsteueranteil weicht von den Firmendaten ab; nach deren Änderung passt er womöglich nicht mehr
  const anteil = data.document.vorsteuerAnteil !== null || data.amounts.some((a) => a.vorsteuerAnteil !== null);
  const hinweise = (
    <>
      <NoticeBanner notice={fuer === id ? notice : null} />
      <DuplikatHinweis ziel={ziel} entwurf={data.document.status === "neu"} anteil={anteil} />
    </>
  );
  return { knopf, hinweise };
}

/** Hinweis auf dem neuen Entwurf (solange er nicht gebucht ist) oder auf dem Beleg, dem die gewählte Datei schon gehört */
function DuplikatHinweis({ ziel, entwurf, anteil }: { ziel: DuplikatZiel; entwurf: boolean; anteil: boolean }) {
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
          : Lieferant, Kategorie, Bezahlung und Beträge sind übernommen, das Belegdatum ist heute. Bitte Rechnungsnummer eintragen, Belegdatum und Beträge
          prüfen.
          {anteil && " Übernommen ist auch ein eigener Vorsteueranteil; prüfe ihn, wenn sich deine Firmendaten seitdem geändert haben."}
        </span>
      )}
    </div>
  );
}
