import { formatDecimal, formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DocumentSplits } from "../../../components/DocumentSplits.tsx";
import { SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { UstIdVorBuchen } from "../../../components/UstIdVorFestschreiben.tsx";
import { steuerSpalte } from "../../../components/VorsteuerAnteil.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { checkSameInvoiceNumber } from "../../../server/functions/documents.ts";
import { BelegAktionen, useBelegAktionen } from "./-beleg-aktionen.tsx";
import { Belegdaten } from "./-beleg-belegdaten.tsx";
import { Betraege } from "./-beleg-betraege.tsx";
import { Bezahlung } from "./-beleg-bezahlung.tsx";
import type { Detail } from "./-beleg-vorschau.tsx";
import { type DocumentFormState, useDocumentForm } from "./-beleg-zustand.ts";

export function DocumentForm({ data, inhaber, onDirtyChange }: { data: Detail; inhaber: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const f = useDocumentForm({ data, inhaber, onDirtyChange });
  const aktionen = useBelegAktionen(f, data);
  const { readOnly, splitting, dirty, form, onSave } = f;
  const { issues } = data;
  const gleicheNummer = useGleicheNummer(data, f);

  return (
    <form ref={form} className="stack" onSubmit={onSave} noValidate>
      <BelegHinweise data={data} locked={f.locked} running={f.running} />

      <Belegdaten f={f} data={data} />

      <Betraege f={f} data={data} />

      {splitting && <BelegAufteilung f={f} data={data} />}

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
      {gleicheNummer.length > 0 && <MoeglicheDublette belege={gleicheNummer} offen={!f.locked && !readOnly} />}
      <ConfirmDialog
        open={aktionen.confirming}
        title="Beleg buchen?"
        facts={[
          ...(f.supplierName.trim() ? [{ label: "Lieferant", value: f.supplierName.trim() }] : []),
          ...(f.documentDate ? [{ label: "Belegdatum", value: formatDate(f.documentDate) }] : []),
          ...(f.gross === null
            ? []
            : [{ label: "Betrag", value: f.foreign ? `${formatDecimal(f.gross)} ${f.currencyCode}` : formatEuro(f.gross), strong: true }]),
        ]}
        confirmLabel="Buchen"
        onConfirm={aktionen.bookNow}
        onClose={() => aktionen.setConfirming(false)}
      >
        <p>Der Beleg wird gebucht und festgeschrieben; danach ist er nicht mehr änderbar.</p>
        {gleicheNummer.length > 0 && (
          <p>
            <strong>Mögliche Dublette:</strong> Vom selben Lieferanten gibt es schon einen Beleg mit dieser Rechnungsnummer. Ist es dieselbe Rechnung, stünde
            die Ausgabe nach dem Buchen doppelt in den Büchern, mit Vorsteuerabzug auch die Vorsteuer.
          </p>
        )}
        <UstIdVorBuchen open={aktionen.confirming} reverseCharge={f.reverseCharge} contactId={f.supplierContactId} ustId={f.supplierUstId} />
      </ConfirmDialog>
      <ConfirmDialog
        open={aktionen.confirmingDelete}
        title={f.supplierName.trim() ? `Beleg von ${f.supplierName.trim()} löschen?` : "Beleg löschen?"}
        confirmLabel="Beleg löschen"
        danger
        onConfirm={aktionen.deleteNow}
        onClose={() => aktionen.setConfirmingDelete(false)}
      >
        <p>Der Beleg und seine Datei werden gelöscht. Das lässt sich nicht rückgängig machen.</p>
      </ConfirmDialog>
      {!readOnly && <BelegAktionen f={f} data={data} aktionen={aktionen} />}
    </form>
  );
}

/** Hinweise über dem Formular: KI liest aus, Fehler beim Auslesen, Herkunft, Dauerbeleg, gebucht */
function BelegHinweise({ data, locked, running }: { data: Detail; locked: boolean; running: boolean }) {
  const doc = data.document;
  return (
    <>
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
    </>
  );
}

/** Aufteilung auf mehrere Kategorien (#271) */
function BelegAufteilung({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { readOnly, running, reverseCharge, rows, splitRows, setSplitRows, parsed, vorsteuerBeleg, foreign, error, touch, setCategory, setOwnAccountId } = f;
  return (
    <div id="aufteilung">
      <DocumentSplits
        rows={splitRows}
        amounts={
          parsed.every((p) => p.net !== null && p.tax !== null) && !foreign ? parsed.map((p) => ({ taxRate: p.taxRate, net: p.net!, tax: p.tax! })) : null
        }
        categories={data.categories}
        ownAccounts={data.ownAccounts}
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
  );
}

/**
 * Hinweis auf eine mögliche Dublette (#1314): andere Belege desselben Lieferanten mit derselben Rechnungsnummer, mit
 * Datum, Betrag, Stand und Link. Nur ein Hinweis; Speichern und Buchen bleiben möglich.
 */
function MoeglicheDublette({ belege, offen }: { belege: Detail["gleicheNummer"]; offen: boolean }) {
  return (
    <div className="banner" role="status">
      <Icon name="alert" />
      <span>
        Mögliche Dublette: Vom selben Lieferanten gibt es schon {belege.length === 1 ? "einen Beleg" : `${belege.length} Belege`} mit dieser Rechnungsnummer:{" "}
        {belege.map((b, i) => (
          <span key={b.id}>
            {i > 0 && "; "}
            <Link to="/belege/$id" params={{ id: b.id }}>
              {b.supplierName} {b.invoiceNumber}
            </Link>
            {b.documentDate && ` vom ${formatDate(b.documentDate)}`}, {formatEuro(b.gross)}, {b.gebucht ? "gebucht" : "noch nicht gebucht"}
          </span>
        ))}
        .{offen && " Ist es dieselbe Rechnung, buche sie nur einmal; Speichern und Buchen bleiben möglich, weil manche Lieferanten Nummern doppelt vergeben."}
      </span>
    </div>
  );
}

/**
 * Mögliche Dubletten zu den Eingaben (#1314, #1378): ohne Änderung an Lieferant und Nummer der Stand vom Laden, sonst
 * kurz nach dem Tippen neu vom Server. So stimmen Hinweis und Buchungsdialog auch vor dem Speichern.
 */
function useGleicheNummer(data: Detail, f: DocumentFormState): Detail["gleicheNummer"] {
  const pruefen = useServerFn(checkSameInvoiceNumber);
  const [treffer, setTreffer] = useState(data.gleicheNummer);
  const { document: doc, gleicheNummer: gespeichert } = data;
  const { supplierName, supplierUstId, supplierContactId, invoiceNumber, gross, locked, readOnly } = f;
  useEffect(() => {
    const unveraendert =
      supplierName === doc.supplierName &&
      supplierUstId === doc.supplierUstId &&
      supplierContactId === doc.supplierContactId &&
      invoiceNumber === doc.invoiceNumber;
    if (unveraendert || locked || readOnly) {
      setTreffer(gespeichert);
      return;
    }
    let gilt = true;
    const warten = setTimeout(() => {
      const eingaben = { supplierName, supplierUstId, supplierContactId, invoiceNumber, gross: gross ?? 0 };
      pruefen({ data: { id: doc.id, recurringDocumentId: doc.recurringDocumentId, ...eingaben } })
        .then((neu) => gilt && setTreffer(neu))
        .catch(() => {});
    }, 400);
    return () => {
      gilt = false;
      clearTimeout(warten);
    };
  }, [pruefen, doc, gespeichert, supplierName, supplierUstId, supplierContactId, invoiceNumber, gross, locked, readOnly]);
  return treffer;
}
