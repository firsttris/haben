import { useInvoiceEditorArticles } from "./use-invoice-editor-articles.ts";
import { useInvoiceEditorFigures } from "./use-invoice-editor-figures.ts";
import { useInvoiceEditorPersist } from "./use-invoice-editor-persist.ts";
import { useInvoiceEditorState } from "./use-invoice-editor-state.ts";
import type { InvoiceEditorProps } from "./invoice-editor-types.ts";

// Alles, was die Teile des Editors brauchen, in einem Objekt

export function useInvoiceEditor(props: InvoiceEditorProps) {
  const state = useInvoiceEditorState(props);
  const figures = { ...state, ...useInvoiceEditorFigures(state) };
  return { ...figures, ...useInvoiceEditorArticles(figures), ...useInvoiceEditorPersist(figures) };
}

export type InvoiceEditorModel = ReturnType<typeof useInvoiceEditor>;
