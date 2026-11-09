import type { ArticleOption } from "./ArticleCombobox.tsx";
import { ArticleForm, type ArticlePrefill } from "./ArticleForm.tsx";
import { FormDialog } from "./FormDialog.tsx";

/** Neuen Artikel aus der Trefferliste einer Position anlegen; die Eingaben im Entwurf bleiben stehen */
export function ArticleDialog({
  open,
  prefill,
  onSaved,
  onClose,
}: {
  open: boolean;
  prefill: ArticlePrefill;
  onSaved: (article: ArticleOption) => void;
  onClose: () => void;
}) {
  return (
    <FormDialog open={open} title="Neuen Artikel anlegen" onClose={onClose}>
      <ArticleForm
        inDialog
        article={null}
        prefill={prefill}
        onDone={(_notice, saved) => {
          if (saved) onSaved(saved);
          onClose();
        }}
      />
    </FormDialog>
  );
}
