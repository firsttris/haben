import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { BESTAETIGEN_HOECHSTENS, ersteMarkierbare, umschalten } from "../lib/bestaetigen-grenze.ts";
import { useAction } from "../lib/use-action.ts";
import { confirmProposalsFn } from "../server/functions/bank-bestaetigen.ts";
import { isDialogOpen } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * Vorschläge der Bankliste bestätigen (#1440, Stufe 2): Umsätze mit einem Vorschlag lassen sich markieren und gemeinsam
 * bestätigen; der Server berechnet den Vorschlag neu und bucht alles oder nichts (server/modules/bank/bestaetigen.ts).
 * Haben bucht dabei nie von selbst: Gebucht wird erst mit dem Klick.
 */

export type MitVorschlag = { id: string; bestaetigung: { text: string } | null };

/** Markierung der Umsätze mit Vorschlag; Umsätze, die nicht mehr in der Liste stehen, fallen heraus */
export function useBestaetigen(umsaetze: readonly MitVorschlag[]) {
  const router = useRouter();
  const confirmFn = useServerFn(confirmProposalsFn);
  const action = useAction();
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const markierbar = umsaetze.filter((u) => u.bestaetigung).map((u) => u.id);
  const markierbarKey = markierbar.join(",");

  // Nach dem Buchen oder bei anderem Filter zeigt die Liste andere Umsätze: nichts Unsichtbares bleibt markiert
  // biome-ignore lint/correctness/useExhaustiveDependencies: markierbarKey steht für die Liste der markierbaren Umsätze
  useEffect(() => {
    setMarked((prev) => {
      const behalten = markierbar.filter((id) => prev.has(id));
      return behalten.length === prev.size ? prev : new Set(behalten);
    });
  }, [markierbarKey]);

  const toggle = (id: string) => {
    const { markiert, voll } = umschalten(marked, id);
    setMarked(markiert);
    if (voll) action.setNotice({ tone: "info", text: `Höchstens ${BESTAETIGEN_HOECHSTENS} Umsätze lassen sich auf einmal bestätigen.` });
  };

  const confirm = (ids: readonly string[]) =>
    action.run(async () => {
      const result = await confirmFn({ data: { transactionIds: [...ids] } });
      setMarked(new Set());
      await router.invalidate();
      action.setNotice({ tone: "ok", text: result.count === 1 ? "Ein Umsatz bestätigt und gebucht." : `${result.count} Umsätze bestätigt und gebucht.` });
    });

  return {
    markierbar,
    marked,
    toggle,
    /** Höchstens so viele, wie der Server auf einmal bucht: sonst scheitert der Klick erst beim Bestätigen */
    setAlle: (an: boolean) => setMarked(new Set(an ? ersteMarkierbare(markierbar) : [])),
    confirm,
    busy: action.busy,
    notice: action.notice,
  };
}

type Bestaetigen = ReturnType<typeof useBestaetigen>;

/** Leiste über der Liste: alle Vorschläge markieren und die markierten gemeinsam bestätigen */
export function BestaetigenLeiste({ b }: { b: Bestaetigen }) {
  if (b.markierbar.length === 0) return <NoticeBanner notice={b.notice} />;
  const grenze = Math.min(b.markierbar.length, BESTAETIGEN_HOECHSTENS);
  const alle = b.marked.size === grenze;
  return (
    <>
      <div className="tx-confirm-bar">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" className="row-check" checked={alle} onChange={(e) => b.setAlle(e.target.checked)} disabled={b.busy} />
          <span>
            {b.markierbar.length > grenze
              ? `Die ersten ${grenze} von ${b.markierbar.length} Vorschlägen markieren`
              : `Alle ${b.markierbar.length} Vorschläge markieren`}
          </span>
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={b.busy || b.marked.size === 0} onClick={() => void b.confirm([...b.marked])}>
          {b.marked.size === 0 ? "Markierte bestätigen" : `${b.marked.size} bestätigen`}
        </button>
      </div>
      <NoticeBanner notice={b.notice} />
    </>
  );
}

/** Markierfeld einer Zeile; Umsätze ohne Vorschlag lassen sich nicht markieren */
export function ZeilenMarkierung({ id, b, label }: { id: string; b: Bestaetigen; label: string }) {
  if (!b.markierbar.includes(id)) return null;
  return (
    <span className="tx-check">
      <input
        type="checkbox"
        className="row-check"
        aria-label={`${label} markieren`}
        checked={b.marked.has(id)}
        onChange={() => b.toggle(id)}
        disabled={b.busy}
      />
    </span>
  );
}

/** Leertaste markiert den Umsatz mit Fokus zum gemeinsamen Bestätigen */
export function useLeertasteMarkiert(b: Bestaetigen) {
  const { markierbar, toggle } = b;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key !== " " || isDialogOpen() || !target.id?.startsWith("tx-")) return;
      const id = target.id.slice(3);
      if (!markierbar.includes(id)) return;
      event.preventDefault();
      toggle(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markierbar, toggle]);
}
