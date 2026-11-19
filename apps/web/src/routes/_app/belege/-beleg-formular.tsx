import { formatDecimal, formatEuro } from "@haben/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DocumentSplits } from "../../../components/DocumentSplits.tsx";
import { SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { bookDocumentFn, deleteDocumentFn, reextractDocument } from "../../../server/functions/documents.ts";
import { ConfirmDialog, isDialogOpen } from "../../../components/ConfirmDialog.tsx";
import { steuerSpalte } from "../../../components/VorsteuerAnteil.tsx";
import { Kuerzel } from "../../../components/Kuerzel.tsx";
import { MoreActionsMenu } from "../../../components/MoreActionsMenu.tsx";
import { type Taste, useKuerzelText } from "../../../lib/tastatur.ts";
import { useDocumentForm } from "./-beleg-zustand.ts";
import { readContinuePreference, subscribeContinuePreference, writeContinuePreference } from "./-beleg-weiter.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import { Belegdaten } from "./-beleg-belegdaten.tsx";
import { Betraege } from "./-beleg-betraege.tsx";
import { Bezahlung } from "./-beleg-bezahlung.tsx";

/** Bucht wie ein Klick auf „Bestätigen und buchen“, auch aus einem Eingabefeld */
const BUCHEN_KUERZEL: readonly Taste[] = ["mod", "Enter"];

export function DocumentForm({ data, inhaber, onDirtyChange }: { data: Detail; inhaber: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const buchenText = useKuerzelText(BUCHEN_KUERZEL);
  const f = useDocumentForm({ data, inhaber, onDirtyChange });
  const { document: doc, categories, ownAccounts, issues, aiAvailable, navigation } = data;
  const {
    locked,
    readOnly,
    running,
    supplierName,
    documentDate,
    setCategory,
    setOwnAccountId,
    reverseCharge,
    rows,
    splitRows,
    setSplitRows,
    splitting,
    dirty,
    busy,
    notice,
    run,
    parsed,
    vorsteuerBeleg,
    currencyCode,
    foreign,
    form,
    error,
    pruefen,
    mitFeldfehlern,
    gross,
    touch,
    persist,
    onSave,
  } = f;
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

  return (
    <form ref={form} className="stack" onSubmit={onSave} noValidate>
      {running && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>Die KI liest den Beleg gerade aus. Die Felder füllen sich gleich.</span>
        </div>
      )}
      {doc.extractionError && !locked && (
        <div className={`banner ${doc.extractionStatus === "fehler" ? "banner-danger" : ""}`} role="status">
          <Icon name="alert" />
          <span>{doc.extractionError}</span>
        </div>
      )}
      {doc.extractedBy && doc.extractedBy !== "manuell" && !locked && !running && (
        <p className="small muted" style={{ margin: 0 }}>
          Vorbefüllt aus {SOURCE_LABEL[doc.extractedBy]}. Bitte prüfen und bestätigen.
        </p>
      )}
      {data.dauerbeleg && (
        <p className="small" style={{ margin: 0 }}>
          Aus dem Dauerbeleg{" "}
          <Link to="/dauerbelege/$id" params={{ id: data.dauerbeleg.id }}>
            {data.dauerbeleg.name ?? "Vorlage"}
          </Link>{" "}
          angelegt; die Datei ist der dort hinterlegte Vertrag.{!locked && " Bitte prüfen und buchen."}
        </p>
      )}
      {locked && !data.cancellation && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" />
          <span>Gebucht {doc.lockedAt ? formatDateTime(doc.lockedAt) : ""}. Der Beleg ist festgeschrieben.</span>
        </div>
      )}

      <Belegdaten f={f} data={data} />

      <Betraege f={f} data={data} />

      {splitting && (
        <div id="aufteilung">
          <DocumentSplits
            rows={splitRows}
            amounts={
              parsed.every((p) => p.net !== null && p.tax !== null) && !foreign ? parsed.map((p) => ({ taxRate: p.taxRate, net: p.net!, tax: p.tax! })) : null
            }
            categories={categories}
            ownAccounts={ownAccounts}
            disabled={readOnly || running}
            onChange={touch(setSplitRows)}
            taxLabel={steuerSpalte(reverseCharge, vorsteuerBeleg, rows)}
            error={(feld, key) => error(`${feld === "netto" ? "aufteilung" : "kategorie"}-${key}`)}
            onDissolve={() => {
              // Zurück zu einer Kategorie: die der ersten Zeile
              touch(setCategory)(splitRows[0]?.category ?? "");
              setOwnAccountId(splitRows[0]?.ownAccountId ?? "");
              setSplitRows([]);
            }}
          />
        </div>
      )}

      <Bezahlung f={f} data={data} />

      {/* Bleibt auch bei Änderungen stehen; beim Speichern oder Buchen prüft der Server neu */}
      {!readOnly && issues.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Vor dem Buchen: {issues.map((issue) => issue.text).join(", ")}.{dirty && " Stand der letzten Speicherung."}
          </span>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Beleg buchen?"
        facts={[
          ...(supplierName.trim() ? [{ label: "Lieferant", value: supplierName.trim() }] : []),
          ...(documentDate ? [{ label: "Belegdatum", value: formatDate(documentDate) }] : []),
          ...(gross === null ? [] : [{ label: "Betrag", value: foreign ? `${formatDecimal(gross)} ${currencyCode}` : formatEuro(gross), strong: true }]),
        ]}
        confirmLabel="Buchen"
        onConfirm={bookNow}
        onClose={() => setConfirming(false)}
      >
        <p>Der Beleg wird gebucht und festgeschrieben; danach ist er nicht mehr änderbar.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmingDelete}
        title={supplierName.trim() ? `Beleg von ${supplierName.trim()} löschen?` : "Beleg löschen?"}
        confirmLabel="Beleg löschen"
        danger
        onConfirm={deleteNow}
        onClose={() => setConfirmingDelete(false)}
      >
        <p>Der Beleg und seine Datei werden gelöscht. Das lässt sich nicht rückgängig machen.</p>
      </ConfirmDialog>
      {!readOnly && (
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
      )}
    </form>
  );
}
