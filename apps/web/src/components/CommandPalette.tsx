import { useRouter } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildPageSection, buildRemoteSections, type PaletteItem, type PaletteSection, statusMessage } from "../lib/befehlspalette.ts";
import { moveActive } from "../lib/combobox.ts";
import { type EigeneSeiteNav, sichtbareNavSeiten } from "../lib/navigation.ts";
import { type CommandPaletteResult, searchCommandPalette } from "../server/functions/search.ts";
import { isDialogOpen } from "./ConfirmDialog.tsx";
import { Icon } from "./Icon.tsx";

export interface CommandPaletteProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onNavigate?: () => void;
  inhaber: boolean;
  gesellschaft: boolean;
  hatMitarbeiter: boolean;
  eigeneSeiten: readonly EigeneSeiteNav[];
}

function useRemotePaletteSearch(open: boolean, trimmed: string) {
  const [remote, setRemote] = useState<CommandPaletteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const latestReqRef = useRef(0);

  const resetRemote = useCallback(() => {
    latestReqRef.current += 1;
    setRemote(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open || trimmed.length < 2) {
      resetRemote();
      return;
    }
    const reqId = ++latestReqRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchCommandPalette({ data: { query: trimmed } })
        .then((res) => {
          if (reqId !== latestReqRef.current) return;
          setRemote(res);
          setLoading(false);
        })
        .catch(() => {
          if (reqId !== latestReqRef.current) return;
          setRemote(null);
          setLoading(false);
        });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [open, trimmed, resetRemote]);

  return { remote, loading, resetRemote };
}

function useShortcutKey(open: boolean, openerRef: RefObject<HTMLElement | null>, onOpen: () => void, onClose: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      if (open) {
        event.preventDefault();
        onClose();
        return;
      }
      if (isDialogOpen()) return;
      event.preventDefault();
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpen();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, openerRef, onOpen, onClose]);
}

function navigatePaletteItem(router: ReturnType<typeof useRouter>, item: PaletteItem, query: string) {
  if (item.kind === "page") {
    if (item.page.externalUrl) window.open(item.page.externalUrl, "_blank", "noopener,noreferrer");
    else if (item.page.params) void router.navigate({ to: "/seiten/$id", params: item.page.params });
    else void router.navigate({ to: item.page.to });
    return;
  }
  if (item.kind === "more") {
    void router.navigate({ to: item.to, search: { suche: query } });
    return;
  }
  void router.navigate({ to: item.to, params: { id: item.entityId } });
}

interface PaletteListboxProps {
  baseId: string;
  listboxId: string;
  sections: PaletteSection[];
  loading: boolean;
  trimmedLength: number;
  safeActive: number;
  optionRefs: RefObject<Map<string, HTMLDivElement>>;
  onHover: (index: number) => void;
  onSelect: (item: PaletteItem) => void;
}

function PaletteListbox({ baseId, listboxId, sections, loading, trimmedLength, safeActive, optionRefs, onHover, onSelect }: PaletteListboxProps) {
  let runningIndex = 0;
  return (
    <div id={listboxId} role="listbox" aria-label="Suchergebnisse" className="cmd-list" onMouseDown={(event) => event.preventDefault()}>
      {sections.length === 0 ? (
        <p className="cmd-empty">
          {loading ? "Suche läuft …" : trimmedLength < 2 ? "Mindestens 2 Zeichen für Belege und Kontakte eingeben." : "Keine Treffer gefunden."}
        </p>
      ) : (
        sections.map((section) => {
          const headingId = `${baseId}-group-${section.id}`;
          return (
            <div key={section.id} role="group" aria-labelledby={headingId} className="cmd-group">
              <div id={headingId} className="cmd-group-label">
                {section.label}
              </div>
              {section.items.map((item) => {
                const index = runningIndex++;
                const selected = index === safeActive;
                return (
                  <div
                    key={item.id}
                    id={`${baseId}-opt-${item.id}`}
                    ref={(node) => {
                      if (node) optionRefs.current.set(item.id, node);
                      else optionRefs.current.delete(item.id);
                    }}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    data-active={selected || undefined}
                    className={item.kind === "more" ? "cmd-option cmd-more" : "cmd-option"}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onSelect(item)}
                  >
                    <Icon name={item.icon} size={16} />
                    <span className="cmd-option-title">{item.title}</span>
                    <span className="cmd-option-meta">{item.meta}</span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}

function PaletteHeader({
  inputRef,
  listboxId,
  open,
  activeItem,
  baseId,
  query,
  onQueryChange,
  onKeyDown,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  listboxId: string;
  open: boolean;
  activeItem: PaletteItem | undefined;
  baseId: string;
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className="cmd-input-wrap">
      <Icon name="search" size={18} />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Seiten, Kontakte, Rechnungen oder Belege suchen"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeItem ? `${baseId}-opt-${activeItem.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Seiten, Kontakte, Rechnungen oder Belege suchen …"
      />
      <button type="button" className="btn-icon cmd-close" aria-label="Befehlspalette schließen" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function PaletteFooter({ short }: { short: boolean }) {
  return (
    <div className="cmd-foot" aria-hidden="true">
      <span>
        <kbd className="cmd-kbd">↑↓</kbd> auswählen
      </span>
      <span>
        <kbd className="cmd-kbd">Enter</kbd> öffnen
      </span>
      <span>
        <kbd className="cmd-kbd">Esc</kbd> schließen
      </span>
      {short && <span className="cmd-foot-hint">Ab 2 Zeichen auch Kontakte, Rechnungen und Belege</span>}
    </div>
  );
}

function usePaletteDialog(
  dialogRef: RefObject<HTMLDialogElement | null>,
  inputRef: RefObject<HTMLInputElement | null>,
  openerRef: RefObject<HTMLElement | null>,
  open: boolean,
  onReset: () => void,
) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (!openerRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
      onReset();
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [dialogRef, inputRef, openerRef, open, onReset]);
}

export function CommandPalette({ open, onOpen, onClose, onNavigate, inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten }: CommandPaletteProps) {
  const router = useRouter();
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const trimmed = query.trim();
  const { remote, loading, resetRemote } = useRemotePaletteSearch(open, trimmed);

  const pages = useMemo(
    () => sichtbareNavSeiten({ inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten }),
    [inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten],
  );
  const sections = useMemo(() => {
    const pageSection = buildPageSection(pages, trimmed);
    return [...(pageSection ? [pageSection] : []), ...(trimmed.length >= 2 && remote ? buildRemoteSections(remote, inhaber) : [])];
  }, [pages, trimmed, remote, inhaber]);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const safeActive = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1);
  const activeItem = safeActive >= 0 ? items[safeActive] : undefined;

  const closePalette = useCallback(
    (restoreFocus: boolean) => {
      if (dialogRef.current?.open) dialogRef.current.close();
      resetRemote();
      onClose();
      const opener = openerRef.current;
      openerRef.current = null;
      if (restoreFocus && opener?.isConnected) opener.focus();
    },
    [onClose, resetRemote],
  );

  const resetOnOpen = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    resetRemote();
  }, [resetRemote]);

  useShortcutKey(open, openerRef, onOpen, () => closePalette(true));
  usePaletteDialog(dialogRef, inputRef, openerRef, open, resetOnOpen);

  useEffect(() => {
    if (activeItem) optionRefs.current.get(activeItem.id)?.scrollIntoView({ block: "nearest" });
  }, [activeItem]);

  function selectItem(item: PaletteItem) {
    closePalette(false);
    onNavigate?.();
    navigatePaletteItem(router, item, trimmed);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(moveActive(safeActive, items.length, event.key));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      selectItem(activeItem);
    }
  }

  const listboxId = `${baseId}-listbox`;
  const titleId = `${baseId}-title`;
  return (
    <dialog
      ref={dialogRef}
      className="cmd-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closePalette(true);
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) closePalette(true);
      }}
    >
      <h2 id={titleId} className="visually-hidden">
        Befehlspalette
      </h2>
      <PaletteHeader
        inputRef={inputRef}
        listboxId={listboxId}
        open={open}
        activeItem={activeItem}
        baseId={baseId}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          setActiveIndex(0);
        }}
        onKeyDown={handleInputKeyDown}
        onClose={() => closePalette(true)}
      />
      <div className="visually-hidden" role="status" aria-live="polite">
        {open ? statusMessage(loading, trimmed.length, items.length) : ""}
      </div>
      <PaletteListbox
        baseId={baseId}
        listboxId={listboxId}
        sections={sections}
        loading={loading}
        trimmedLength={trimmed.length}
        safeActive={safeActive}
        optionRefs={optionRefs}
        onHover={setActiveIndex}
        onSelect={selectItem}
      />
      <PaletteFooter short={trimmed.length < 2} />
    </dialog>
  );
}
