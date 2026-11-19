import { formatDecimal, formatEuro } from "@haben/core";
import { ArticleDialog } from "./ArticleDialog.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FestschreibenHinweise } from "./FestschreibenHinweise.tsx";
import { NewContactDialog } from "./NewContactDialog.tsx";
import { UmsatzgrenzeDialog } from "./UmsatzgrenzeDialog.tsx";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

// Dialoge des Editors: Festschreiben, Umsatzgrenze, Entwurf löschen, neuer Kunde und neuer Artikel

export function InvoiceEditorDialogs({ editor }: { editor: InvoiceEditorModel }) {
  const {
    chooseContact,
    confirming,
    confirmingDelete,
    contact,
    currencyCode,
    deleteNow,
    earlierThanLast,
    finalizeNow,
    finalizeSaved,
    newArticle,
    newContactName,
    nextNumber,
    numberDate,
    pickArticle,
    previewGross,
    quote,
    run,
    setConfirming,
    setConfirmingDelete,
    setNewArticle,
    setNewContactName,
    setUmsatzwarnung,
    umsatzwarnung,
    units,
    ustIdPruefen,
  } = editor;
  return (
    <>
      <ConfirmDialog
        open={confirming}
        title={`${quote ? "Angebot" : "Rechnung"} festschreiben?`}
        confirmLabel="Festschreiben"
        facts={[
          { label: "Nummer", value: nextNumber },
          ...(contact ? [{ label: "Kunde", value: contact.name }] : []),
          { label: "Betrag", value: currencyCode === "EUR" ? formatEuro(previewGross) : `${formatDecimal(previewGross)} ${currencyCode}`, strong: true },
        ]}
        onConfirm={finalizeNow}
        onClose={() => setConfirming(false)}
      >
        {quote ? (
          <>
            <p>Das Angebot bekommt sein PDF. Gebucht wird nichts.</p>
            <p>Danach ist das Angebot nicht mehr änderbar; für ein geändertes kopierst du es.</p>
          </>
        ) : (
          <>
            <FestschreibenHinweise open={confirming} earlierThanLast={earlierThanLast} numberDate={numberDate} ustId={ustIdPruefen} />
            <p>PDF und XML werden erzeugt und gebucht.</p>
            <p>Danach ist die Rechnung nicht mehr änderbar; Korrekturen laufen über Storno oder Rechnungskorrektur.</p>
          </>
        )}
      </ConfirmDialog>
      {umsatzwarnung && (
        <UmsatzgrenzeDialog
          warnung={umsatzwarnung}
          action="festschreiben"
          onClose={() => setUmsatzwarnung(null)}
          onConfirm={() => void run(() => finalizeSaved(umsatzwarnung.id, umsatzwarnung))}
        >
          <p>Bei Abbruch bleibt die Rechnung als Entwurf gespeichert.</p>
        </UmsatzgrenzeDialog>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title="Entwurf löschen?"
        confirmLabel="Entwurf löschen"
        danger
        onConfirm={deleteNow}
        onClose={() => setConfirmingDelete(false)}
      >
        <p>Der Entwurf{contact ? ` für ${contact.name}` : ""} wird endgültig entfernt. Das lässt sich nicht rückgängig machen.</p>
      </ConfirmDialog>
      <NewContactDialog
        rolle="kunde"
        name={newContactName}
        onSaved={(saved) => chooseContact(saved.id, saved)}
        onPickExisting={(id) => chooseContact(id)}
        onClose={() => setNewContactName(null)}
      />
      <ArticleDialog
        units={units}
        open={newArticle !== null}
        prefill={newArticle?.prefill ?? {}}
        onSaved={(article) => {
          if (newArticle) pickArticle(newArticle.lineKey, article);
        }}
        onClose={() => setNewArticle(null)}
      />
    </>
  );
}
