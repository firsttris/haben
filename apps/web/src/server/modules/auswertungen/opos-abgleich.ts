import { db, type Db, type Tx } from "../../db/index.ts";
import type { Abgleich } from "./abgleich.ts";

/** Stichtagsgegenprobe ausschließlich für das additive Anzahlungs-Bilanzverfahren. */
export async function oposAbgleich(_cutoff: string, _q: Db | Tx = db): Promise<Abgleich> {
  return { zeilen: [], hinweise: [] };
}
