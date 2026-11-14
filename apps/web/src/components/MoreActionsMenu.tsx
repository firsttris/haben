import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onSelect: () => void;
};

function enabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
}

/**
 * Menüknopf für Dokumentaktionen im Seitenkopf auf schmalen Bildschirmen (#396), nach dem Muster „Menu Button“ der
 * WAI-ARIA APG: öffnet mit Enter, Leertaste oder Pfeil nach unten/oben, hält die Pfeiltasten im Menü und setzt den
 * Fokus bei Escape zurück auf den Auslöser.
 */
export function MoreActionsMenu({
  label = "Weitere Aktionen",
  items,
  triggerRef,
}: {
  label?: string;
  items: ActionMenuItem[];
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<"first" | "last">("first");
  const container = useRef<HTMLDivElement>(null);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const setTriggerRef = (node: HTMLButtonElement | null) => {
    ownTrigger.current = node;
    if (triggerRef) triggerRef.current = node;
  };

  const closeMenu = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) ownTrigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const all = enabledMenuItems(menu.current);
    (initialFocus === "last" ? all.at(-1) : all[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, initialFocus]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setInitialFocus(e.key === "ArrowUp" ? "last" : "first");
      setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const all = enabledMenuItems(menu.current);
    if (all.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
      return;
    }
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={container} className="more-actions-menu">
      <button
        ref={setTriggerRef}
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setInitialFocus("first");
          setOpen((was) => !was);
        }}
        onKeyDown={onTriggerKey}
      >
        {label}
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label={label} className="split-menu" onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                closeMenu(true);
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
