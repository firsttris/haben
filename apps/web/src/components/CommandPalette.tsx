import { useRouter } from "@tanstack/react-router";
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { buildPageSection, buildRemoteSections, type PaletteItem, statusMessage } from "../lib/befehlspalette.ts";
import { moveActive } from "../lib/combobox.ts";
import { type EigeneSeiteNav, sichtbareNavSeiten } from "../lib/navigation.ts";
import { type CommandPaletteResult, searchCommandPalette } from "../server/functions/search.ts";
import { isDialogOpen } from "./ConfirmDialog.tsx";
import { useRecentPalette } from "./use-recent-palette.ts";
import { Field } from "./Field.tsx";
import { PaletteListbox } from "./PaletteListbox.tsx";
import { Icon } from "./Icon.tsx";
import { Kuerzel } from "./Kuerzel.tsx";
import type { Taste } from "../lib/tastatur.ts";

/** Öffnet die Befehlspalette von jeder Seite; angezeigt in der Navigation */
export const PALETTE_KUERZEL: readonly Taste[] = ["mod", "K"];

export interface CommandPaletteProps {
  open: boolean;
  oidcOnly: boolean;
  onOpen: () => void;
  onClose: () => void;
  onNavigate?: () => void;
  inhaber: boolean;
  gesellschaft: boolean;
  hatMitarbeiter: boolean;
  eigeneSeiten: readonly EigeneSeiteNav[];
}

function useRemotePaletteSearch(open: boolean, trimmed: string) {
  const [response, setResponse] = useState<{ query: string; result: CommandPaletteResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const latestReqRef = useRef(0);

  const resetRemote = useCallback(() => {
    latestReqRef.current += 1;
    setResponse(null);
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
          setResponse({ query: trimmed, result: res });
          setLoading(false);
        })
        .catch(() => {
          if (reqId !== latestReqRef.current) return;
          setResponse(null);
          setLoading(false);
        });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [open, trimmed, resetRemote]);

  return { remote: response?.query === trimmed ? response.result : null, loading, resetRemote };
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

function navigatePaletteItem(router: ReturnType<typeof useRouter>, item: PaletteItem) {
  if (item.kind === "page") {
    if (item.page.externalUrl) window.open(item.page.externalUrl, "_blank", "noopener,noreferrer");
    else if (item.page.settingsArea) void router.navigate({ to: "/einstellungen", search: { bereich: item.page.settingsArea } });
    else if (item.page.params) void router.navigate({ to: "/seiten/$id", params: item.page.params });
    else void router.navigate({ to: item.page.to });
    return;
  }
  void router.navigate({ to: item.to, params: { id: item.entityId } });
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
    <div className="cmd-head">
      <Field label="Seiten, Kontakte, Rechnungen, Angebote oder Belege suchen" hideLabel className="cmd-field">
        {(control) => (
          <>
            <Icon name="search" size={18} />
            <input
              {...control}
              ref={inputRef}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeItem ? `${baseId}-opt-${activeItem.id}` : undefined}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Seiten, Kontakte, Rechnungen, Angebote oder Belege suchen …"
            />
          </>
        )}
      </Field>
      <button type="button" className="btn btn-ghost cmd-close" onClick={onClose}>
        Abbrechen
      </button>
    </div>
  );
}

function PaletteFooter() {
  return (
    <div className="cmd-foot" aria-hidden="true">
      <span>
        <Kuerzel tasten={["↑↓"]} /> Navigieren
      </span>
      <span>
        <Kuerzel tasten={["Esc"]} /> Schließen
      </span>
      <span>
        <Kuerzel tasten={["↵"]} /> Öffnen
      </span>
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

function usePaletteSections(
  open: boolean,
  trimmed: string,
  {
    inhaber,
    gesellschaft,
    hatMitarbeiter,
    eigeneSeiten,
    oidcOnly,
  }: Pick<CommandPaletteProps, "inhaber" | "gesellschaft" | "hatMitarbeiter" | "eigeneSeiten" | "oidcOnly">,
) {
  const { remote, loading, resetRemote } = useRemotePaletteSearch(open, trimmed);
  const recent = useRecentPalette(open && trimmed === "", inhaber);
  const pages = useMemo(
    () => sichtbareNavSeiten({ inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten, oidcOnly }),
    [inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten, oidcOnly],
  );
  const sections = useMemo(() => {
    const pageSection = buildPageSection(pages, trimmed);
    return [
      ...(trimmed === "" && recent.length > 0 ? [{ id: "zuletzt", label: "Zuletzt angesehen", items: recent }] : []),
      ...(pageSection ? [pageSection] : []),
      ...(remote ? buildRemoteSections(remote, inhaber) : []),
    ];
  }, [pages, trimmed, remote, inhaber, recent]);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  return { sections, items, loading, resetRemote };
}

function handlePaletteNavigation(
  event: ReactKeyboardEvent<HTMLInputElement>,
  safeActive: number,
  items: PaletteItem[],
  activeItem: PaletteItem | undefined,
  onIndex: (index: number) => void,
  onSelect: (item: PaletteItem) => void,
) {
  if (event.nativeEvent.isComposing || items.length === 0) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    onIndex(moveActive(safeActive, items.length, event.key));
  } else if (event.key === "Home") {
    event.preventDefault();
    onIndex(0);
  } else if (event.key === "End") {
    event.preventDefault();
    onIndex(items.length - 1);
  } else if (event.key === "Enter" && activeItem) {
    event.preventDefault();
    onSelect(activeItem);
  }
}

export function CommandPalette({ open, onOpen, onClose, onNavigate, inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten, oidcOnly }: CommandPaletteProps) {
  const router = useRouter();
  const baseId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const optionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [query, setQuery] = useState("");
  const pointerActive = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const trimmed = query.trim();
  const { sections, items, loading, resetRemote } = usePaletteSections(open, trimmed, { inhaber, gesellschaft, hatMitarbeiter, eigeneSeiten, oidcOnly });
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
    pointerActive.current = false;
    setActiveIndex(0);
    resetRemote();
  }, [resetRemote]);

  useShortcutKey(open, openerRef, onOpen, () => closePalette(true));
  usePaletteDialog(dialogRef, inputRef, openerRef, open, resetOnOpen);
  useEffect(() => {
    if (activeItem && !pointerActive.current) optionRefs.current.get(activeItem.id)?.scrollIntoView({ block: "nearest" });
  }, [activeItem]);

  function selectItem(item: PaletteItem) {
    closePalette(false);
    onNavigate?.();
    navigatePaletteItem(router, item);
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
          pointerActive.current = false;
          setQuery(value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          pointerActive.current = false;
          handlePaletteNavigation(event, safeActive, items, activeItem, setActiveIndex, selectItem);
        }}
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
        query={trimmed}
        onNavigate={() => {
          closePalette(false);
          onNavigate?.();
        }}
        safeActive={safeActive}
        optionRefs={optionRefs}
        onHover={(index) => {
          pointerActive.current = true;
          setActiveIndex(index);
        }}
        onSelect={selectItem}
      />
      <PaletteFooter />
    </dialog>
  );
}
