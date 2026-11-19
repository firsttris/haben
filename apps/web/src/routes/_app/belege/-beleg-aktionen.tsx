import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isDialogOpen } from "../../../components/ConfirmDialog.tsx";
import { Kuerzel } from "../../../components/Kuerzel.tsx";
import { MoreActionsMenu } from "../../../components/MoreActionsMenu.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { type Taste, useKuerzelText } from "../../../lib/tastatur.ts";
import { bookDocumentFn, deleteDocumentFn, reextractDocument } from "../../../server/functions/documents.ts";
import { readContinuePreference, subscribeContinuePreference, writeContinuePreference } from "./-beleg-weiter.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import type { DocumentFormState } from "./-beleg-zustand.ts";

// Buchen, Löschen und neu Auslesen eines Belegs: Abläufe, Tastenkürzel und die Knopfleiste des Belegformulars

/** Bucht wie ein Klick auf „Bestätigen und buchen“, auch aus einem Eingabefeld */
export const BUCHEN_KUERZEL: readonly Taste[] = ["mod", "Enter"];

/** Rückfragen und Abläufe zu Buchen, Löschen und neu Auslesen */
export function useBelegAktionen(f: DocumentFormState, data: Detail) {
  const { readOnly, running, dirty, busy, run, pruefen, mitFeldfehlern, persist } = f;
  const { document: doc, navigation } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const book = useServerFn(bookDocumentFn);
  const remove = useServerFn(deleteDocumentFn);
  const reextract = useServerFn(reextractDocument);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Nach dem Buchen zum nächsten offenen Beleg oder hierbleiben (etwa für den Bankabgleich); gemerkt im Browser
  // Der Server kennt die Wahl nicht und rendert „an“; im Browser gilt der gemerkte Wert
  const continueAfterBooking = useSyncExternalStore(subscribeContinuePreference, readContinuePreference, () => true);

  const bookNow = () => {
    void run(async () => {
      await mitFeldfehlern(async () => {
        if (dirty) await persist();
        await book({ data: doc.id });
      });
      // Weiter zum nächsten Beleg „Zu prüfen“; der gebuchte rückt in der Liste zu den gebuchten nach hinten
      if (continueAfterBooking && navigation.nextOpenId) {
        await navigate({ to: "/belege/$id", params: { id: navigation.nextOpenId } });
        return;
      }
      await router.invalidate();
      // Keiner mehr offen: Meldung mit Link zur Liste
      if (continueAfterBooking) await navigate({ to: "/belege/$id", params: { id: doc.id }, search: { geprueft: true }, replace: true });
    });
  };

  const deleteNow = () => {
    void run(async () => {
      await remove({ data: doc.id });
      // Weiter zum nächsten Beleg „Zu prüfen“; sind keine mehr offen, zurück zur Liste statt auf einen gebuchten
      const next = navigation.nextOpenId;
      await navigate(next ? { to: "/belege/$id", params: { id: next } } : { to: "/belege" });
    });
  };

  // Strg+Enter (Mac: ⌘+Enter) wie ein Klick auf „Bestätigen und buchen“, auch aus einem Eingabefeld; gebucht wird
  // erst im Dialog, nicht mit einem zweiten Strg+Enter, das den Hinweis überginge
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (readOnly || isDialogOpen()) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (!busy && !running && pruefen()) setConfirming(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onReextract = () =>
    run(async () => {
      await reextract({ data: doc.id });
      await router.invalidate();
    });

  return { confirming, setConfirming, confirmingDelete, setConfirmingDelete, continueAfterBooking, bookNow, deleteNow, onReextract };
}

/** Knopfleiste unter dem Formular: Löschen, Speichern, Buchen, KI und die Wahl, danach weiterzugehen */
export function BelegAktionen({ f, data, aktionen }: { f: DocumentFormState; data: Detail; aktionen: ReturnType<typeof useBelegAktionen> }) {
  const buchenText = useKuerzelText(BUCHEN_KUERZEL);
  const { notice, busy, running, dirty, pruefen } = f;
  const { document: doc, aiAvailable } = data;
  const { setConfirming, setConfirmingDelete, continueAfterBooking, onReextract } = aktionen;
  return (
    <div className="actions doc-actions">
      {/* In der stehenden Leiste: davor läge die Meldung beim Scrollen hinter ihr. Jede Aktion mit Meldung sitzt hier */}
      <NoticeBanner notice={notice} />
      <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)} disabled={busy || running}>
        Löschen
      </button>
      <button type="submit" className="btn" disabled={busy || running || !dirty}>
        Speichern
      </button>
      <button type="button" className="btn btn-primary" onClick={() => pruefen() && setConfirming(true)} disabled={busy || running} title={buchenText}>
        Bestätigen und buchen
      </button>
      {aiAvailable && doc.mimeType !== "application/xml" && doc.mimeType !== "image/heic" && (
        <MoreActionsMenu items={[{ key: "ki", label: "Mit KI neu auslesen", disabled: busy || running, onSelect: () => void onReextract() }]} />
      )}
      <label className="checkbox small" style={{ flexBasis: "100%" }}>
        <input type="checkbox" checked={continueAfterBooking} onChange={(e) => writeContinuePreference(e.target.checked)} />
        Nach dem Buchen zum nächsten offenen Beleg
      </label>
      <span className="small muted pointer-fine" style={{ flexBasis: "100%" }}>
        Tastatur: <Kuerzel tasten={BUCHEN_KUERZEL} /> bucht, <Kuerzel tasten={["J"]} /> und <Kuerzel tasten={["K"]} /> wechseln den Beleg,{" "}
        <Kuerzel tasten={["Esc"]} /> führt zurück zur Liste.
      </span>
    </div>
  );
}
