/** Nachrichten zwischen App und Render-Prozess (render-client.ts, render-worker.ts) */

export interface RenderJob {
  /** Projektwurzel; Typst liest nur Dateien darunter */
  workspace: string;
  /** Hauptdatei, absolut und unter workspace */
  main: string;
  /** Kommt als sys.inputs.data an */
  data: unknown;
  /** Logo und Briefpapier: liegen nur für diesen Lauf als Dateien neben der Vorlage */
  files: { name: string; base64: string }[];
}

export interface RenderedSheet {
  /** Alle Seiten untereinander in einem SVG */
  svg: string;
  pages: number;
  /** Maße einer Seite in Punkt */
  width: number;
  height: number;
  /** Kompilieren und SVG, ohne Warten in der Schlange */
  ms: number;
}

export type RenderRequest = RenderJob & { id: number };

export type RenderResponse = { id: number; ok: true; sheet: RenderedSheet } | { id: number; ok: false; message: string };
