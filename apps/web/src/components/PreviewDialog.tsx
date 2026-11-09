import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useSwipeToClose } from "../lib/use-swipe-to-close.ts";
import { returnsFocusOnClose } from "../lib/vorschau.ts";
import { Icon } from "./Icon.tsx";
import { SheetGrip } from "./SheetGrip.tsx";
import { SheetScroll } from "./SheetScroll.tsx";

/** Wie die Breite in styles.css, ab der die Überblendung ein Blatt von unten ist */
const SHEET_MEDIA = "(max-width: 720px)";

/**
 * Modaler <dialog> als Seitenleiste, die von rechts hereinfährt: hält den Fokus, Escape und ein Klick neben das Blatt
 * schließen ihn. Er bleibt im Dokument, bis er hinausgefahren ist; ohne Bewegung (prefers-reduced-motion) sofort weg.
 */
export function PreviewDialog({
  label,
  caption,
  onClosing,
  onDismissed,
  onClose,
  designPanel,
  designOpen,
  onToggleDesign,
  children,
}: {
  label: string;
  caption: ReactNode;
  onClosing: () => void;
  /** Sofort beim Schließen, nicht erst nach der Fahrt: Wer schnell wieder öffnet, ersetzt den Dialog, bevor onClose käme */
  onDismissed: () => void;
  onClose: () => void;
  designPanel: ReactNode;
  designOpen: boolean;
  onToggleDesign: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const replaced = useRef(false);
  const pressedBeside = useRef(false);
  const swipe = useSwipeToClose(ref, () => ref.current?.close(), SHEET_MEDIA);
  const designSheet = useRef<HTMLDivElement>(null);
  const designSwipe = useSwipeToClose(designSheet, onToggleDesign, SHEET_MEDIA);

  useEffect(() => {
    replaced.current = false;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      replaced.current = true;
    };
  }, []);

  const closed = () => {
    onDismissed();
    const dialog = ref.current;
    if (returnsFocusOnClose(document.activeElement, document.body, (element) => dialog?.contains(element) ?? false)) onClosing();
    if (!dialog || parseFloat(getComputedStyle(dialog).transitionDuration) === 0) return onClose();
    let done = false;
    const finish = () => {
      if (done || replaced.current) return;
      done = true;
      onClose();
    };
    dialog.addEventListener("transitionend", finish, { once: true });
    window.setTimeout(finish, 500);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={ref}
      className="preview-dialog"
      data-design={designOpen || undefined}
      aria-labelledby={titleId}
      onClose={closed}
      onPointerDown={(e) => {
        pressedBeside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Nur was daneben begann: Eine Textauswahl, die dort endet, meldet der Browser ebenfalls am Dialog
        if (e.target === e.currentTarget && pressedBeside.current) e.currentTarget.close();
      }}
    >
      <SheetGrip {...swipe} />
      <div className="preview-dialog-head">
        <div className="preview-dialog-title" {...swipe}>
          <h2 id={titleId}>{label}</h2>
          <span className="small muted">{caption}</span>
        </div>
        <div className="preview-dialog-actions">
          {designPanel && (
            <button type="button" className="btn btn-sm" aria-pressed={designOpen} onClick={onToggleDesign}>
              <Icon name="settings" size={16} />
              Gestaltung
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => ref.current?.close()}>
            <Icon name="close" size={16} />
            Schließen
          </button>
        </div>
      </div>
      <div className="preview-dialog-main" data-design={designOpen || undefined}>
        <SheetScroll className="preview-dialog-body">{children}</SheetScroll>
        {designOpen && (
          <div ref={designSheet} className="design-sheet">
            <SheetGrip {...designSwipe} />
            {designPanel}
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
