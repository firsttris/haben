import type { HTMLAttributes } from "react";

/** Griff oben an einem Blatt von unten; die Geste kommt von useSwipeToClose, sichtbar ist er nur in Handybreite (styles.css) */
export function SheetGrip(props: HTMLAttributes<HTMLDivElement>) {
  return <div className="sheet-grip" aria-hidden="true" {...props} />;
}
