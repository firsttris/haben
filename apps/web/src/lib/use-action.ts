import { useState } from "react";
import { errorMessage } from "./format.ts";

export type Notice = { tone: "ok" | "danger" | "info"; text: string } | null;

/**
 * Zustand einer Aktion: `busy` sperrt die Knöpfe gegen Doppelklick, Fehler landen als Meldung statt still im Nichts.
 * `run` liefert true, wenn die Arbeit ohne Fehler durchlief.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function run(work: () => Promise<unknown>, success?: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      if (success) setNotice({ tone: "ok", text: success });
      return true;
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, notice, setNotice, run };
}
