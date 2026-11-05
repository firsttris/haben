import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../lib/jahre.ts";

/** Geschäftsjahr in Eingaben der Server Functions und Download-Routen */
export const yearSchema = z.number().int().min(ERSTES_JAHR).max(LETZTES_JAHR);

/** Id aus der Adresse einer Detailseite: Eine kaputte Adresse ist eine Seite, die es nicht gibt, kein Eingabefehler */
export function detailId(id: string): string {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return id;
}
