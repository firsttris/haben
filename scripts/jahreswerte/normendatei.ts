/* Inhalt von normen.json, wie `--normen-schreiben` ihn schreibt */
import type { Norm } from "./normen.ts";

export const normenDatei = (normen: readonly Norm[]): string => `${JSON.stringify({ normen }, null, 2)}\n`;
