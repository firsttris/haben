import { useEffect } from "react";
import { isDialogOpen } from "./ConfirmDialog.tsx";

/** J/K springen zum nächsten bzw. vorigen Umsatz der Liste (`index` ist die Stelle des gewählten Umsatzes darin) */
export function useUmsatzTasten(sichtbar: readonly { id: string }[], index: number, gehe: (id: string) => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (!step) return;
      const next = sichtbar[index + step];
      if (next) {
        event.preventDefault();
        gehe(next.id);
        document.getElementById(`tx-${next.id}`)?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sichtbar, index, gehe]);
}
