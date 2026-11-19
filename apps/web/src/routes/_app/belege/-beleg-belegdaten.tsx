import type { ReactNode } from "react";
import { EigenesKontoWahl, passendesKonto } from "../../../components/EigenesKontoWahl.tsx";
import { CategoryCombobox } from "../../../components/CategoryCombobox.tsx";
import { ContactCombobox, savedAsChoice } from "../../../components/ContactCombobox.tsx";
import { NewContactDialog } from "../../../components/NewContactDialog.tsx";
import { formatDate } from "../../../lib/format.ts";
import { privatanteilVorgabe } from "../../../lib/anteil.ts";
import { Field } from "../../../components/Field.tsx";
import { KATEGORIE_BEISPIEL } from "../../../components/KategorieGruppen.ts";
import type { DocumentFormState } from "./-beleg-zustand.ts";
import type { Detail } from "./-beleg-vorschau.tsx";
import { AnlageFelder } from "./-beleg-anlage.tsx";
import { BelegWeitereAngaben } from "./-beleg-weitere-angaben.tsx";

/** Erste Karte des Belegformulars: Lieferant, Rechnungsnummer, Datum, Kategorie, Anlage und weitere Angaben */
export function Belegdaten({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { categories, ownAccounts } = data;
  const {
    locked,
    readOnly,
    running,
    invoiceNumber,
    setInvoiceNumber,
    documentDate,
    setDocumentDate,
    category,
    setCategory,
    ownAccountId,
    setOwnAccountId,
    setPrivateShare,
    splitRows,
    splitting,
    splitBlocked,
    startSplitting,
    touch,
  } = f;
  return (
    <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
      <legend className="visually-hidden">Belegdaten</legend>
      <div className="form-grid">
        <Lieferant f={f} data={data} />
        <Field label="Rechnungsnummer">
          {(control) => <input {...control} value={invoiceNumber} onChange={(e) => touch(setInvoiceNumber)(e.target.value)} />}
        </Field>
        <Field label="Belegdatum">
          {(control) => <input {...control} type="date" value={documentDate} onChange={(e) => touch(setDocumentDate)(e.target.value)} />}
        </Field>
        {splitting ? (
          <p className="small" style={{ gridColumn: "1 / -1", margin: 0 }}>
            <strong>Kategorie:</strong> aufgeteilt auf {splitRows.length} Zeilen, siehe <a href="#aufteilung">Aufteilung auf Kategorien</a>.
          </p>
        ) : (
          <Field label="Kategorie" hint={kategorieHinweis(f, data)} style={{ gridColumn: "1 / -1" }}>
            {(control) => (
              <CategoryCombobox
                {...control}
                categories={categories}
                value={category}
                onChoose={(next) => {
                  touch(setCategory)(next);
                  setOwnAccountId(passendesKonto(ownAccounts, next, ownAccountId));
                  // Vorgabe aus den Firmendaten, z. B. Telefon 20 %
                  setPrivateShare(privatanteilVorgabe(data.privateShares, next));
                }}
              />
            )}
          </Field>
        )}
        {/* Beide Seiten: eigenes Konto (main, #842) und der Hinweis bei gebuchtem Beleg (#1112) */}
        {!splitting && category !== "anlage" && (
          <EigenesKontoWahl
            accounts={ownAccounts}
            category={category}
            value={ownAccountId}
            onChange={touch(setOwnAccountId)}
            style={{ gridColumn: "1 / -1" }}
          />
        )}
        {!splitting && locked && !data.cancellation && data.cancellationIssues.length === 0 && (
          // Ein gebuchter Beleg ist gesperrt; statt den Knopf stillschweigend zu verstecken, sagt die Seite warum (#1112).
          // Nur, wenn er sich stornieren lässt: Bei einem Anlagegut oder einem übernommenen Beleg nennt die Seite den Grund
          <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
            Gebucht: Die Aufteilung auf mehrere Kategorien geht vor dem Buchen. Ein gebuchter Beleg lässt sich stornieren und die Kopie danach aufteilen.
          </p>
        )}
        {!splitting && !readOnly && (
          <p className="small" style={{ gridColumn: "1 / -1", margin: 0 }}>
            <button type="button" className="link-button" onClick={startSplitting} disabled={splitBlocked !== null} aria-describedby="split-start-hint">
              Auf mehrere Kategorien aufteilen
            </button>
            <span id="split-start-hint" className="muted">
              {splitBlocked
                ? ` · mit ${splitBlocked} noch nicht möglich`
                : " · z. B. Handelsware, Software und Bürobedarf auf einer Rechnung; ein Beleg, eine Zahlung"}
            </span>
          </p>
        )}
        {category === "anlage" && !splitting && <AnlageFelder f={f} data={data} />}
        <BelegWeitereAngaben f={f} data={data} />
      </div>
    </fieldset>
  );
}

/** Lieferant als Name oder Kontakt (#1253), mit dem Dialog für einen neuen Kontakt */
function Lieferant({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { readOnly, running, supplierName, supplierUstId, supplierContactId, newSupplierName, setNewSupplierName, touch, pickSupplier, typeSupplierName } = f;
  return (
    <>
      {/* Ein Feld für Name und Kontakt (#1253): Der Name darf frei stehen, eine Wahl aus den Kontakten verknüpft ihn */}
      <Field label="Lieferant" hint={supplierContactId ? "Aus den Kontakten gewählt." : undefined}>
        {(control) => (
          <ContactCombobox
            {...control}
            rolle="lieferant"
            contacts={data.suppliers}
            contactId={supplierContactId ?? ""}
            freitext={{ value: supplierName, onInput: touch(typeSupplierName) }}
            placeholder="Name eintragen oder Kontakt suchen"
            disabled={readOnly || running}
            onChoose={(id) => touch(pickSupplier)(data.suppliers.find((s) => s.id === id) ?? null)}
            onCreate={readOnly ? undefined : setNewSupplierName}
          />
        )}
      </Field>
      <NewContactDialog
        rolle="lieferant"
        name={newSupplierName}
        // Anschrift und E-Mail aus der E-Rechnung, Name und USt-IdNr. wie am Beleg; die IBAN nur als Vorschlag zum Übernehmen (#329)
        prefill={{
          ...data.supplierSuggestion?.contact,
          ...(supplierName ? { name: supplierName } : {}),
          ...(supplierUstId ? { ustId: supplierUstId } : {}),
        }}
        ibanSuggestion={data.supplierSuggestion?.iban ?? null}
        onSaved={(saved) => touch(pickSupplier)(savedAsChoice(saved))}
        onPickExisting={(id) => touch(pickSupplier)(data.suppliers.find((c) => c.id === id) ?? null)}
        onClose={() => setNewSupplierName(null)}
      />
    </>
  );
}

/** Hinweis an der Kategorie: wie Belege des Lieferanten bisher gebucht wurden, sonst ein Beispiel */
function kategorieHinweis(f: DocumentFormState, data: Detail): ReactNode {
  const { category, setCategory, setPrivateShare, touch } = f;
  if (!data.categoryHint) return category === "" ? KATEGORIE_BEISPIEL : undefined;
  return (
    <>
      Bisher{" "}
      {data.categoryHint.count === data.categoryHint.total
        ? `${data.categoryHint.count}×`
        : `${data.categoryHint.count} von ${data.categoryHint.total} Belegen`}{" "}
      als {data.categories.find((c) => c.value === data.categoryHint!.category)?.label ?? data.categoryHint.category} gebucht, zuletzt am{" "}
      {formatDate(data.categoryHint.last)}
      {category !== data.categoryHint.category && (
        <>
          {" · "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              const hint = data.categoryHint!.category;
              touch(setCategory)(hint);
              setPrivateShare(privatanteilVorgabe(data.privateShares, hint));
            }}
          >
            übernehmen
          </button>
        </>
      )}
    </>
  );
}
