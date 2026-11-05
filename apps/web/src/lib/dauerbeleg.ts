import type { DauerbelegValues } from "../components/DauerbelegForm.tsx";

/** Vorlage als JSON und Vertrag als Datei für die Server Function saveDauerbeleg */
export function dauerbelegFormData(id: string | null, values: DauerbelegValues, file: File | null): FormData {
  const data = new FormData();
  if (id) data.set("id", id);
  data.set("vorlage", JSON.stringify(values));
  if (file) data.set("datei", file);
  return data;
}
