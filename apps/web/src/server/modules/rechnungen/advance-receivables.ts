import { advanceReceivables } from "@haben/core";
import { db, type Db, type Tx } from "../../db/index.ts";

/** Nur der additive Bilanzweg; Quelle für OPOS, Journalgegenprobe und Restlaufzeiten. */
export async function advanceReceivablesAt(cutoff: string, _q: Db | Tx = db) {
  return advanceReceivables([], [], [], cutoff);
}
