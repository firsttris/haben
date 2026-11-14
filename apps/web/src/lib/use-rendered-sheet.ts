import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentPreview } from "../server/modules/rechnungen/index.ts";
import { afterRender, renderDelay, rendersOnDemand } from "./vorschau-render.ts";

export type LoadedSheet = Omit<DocumentPreview, "svg" | "ms"> & { url: string };

/** Server-Funktion, die das Blatt aus dem Stand des Formulars setzt: renderDocumentPreview, renderDunningPreview */
export type SheetRenderer<I> = (options: { data: I }) => Promise<DocumentPreview>;

/**
 * Hält das gesetzte Blatt zum Formular aktuell, solange die Vorschau zu sehen ist. Was während eines Laufs veraltet, wird
 * verworfen; bis das neue Bild dekodiert ist, bleibt das alte stehen, damit nichts flackert.
 */
export function useRenderedSheet<I>(renderer: SheetRenderer<I>, input: I, revision: string | null) {
  const render = useServerFn(renderer);
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const latest = useRef(0);
  const lastMs = useRef(0);
  const url = useRef<string | null>(null);
  const key = JSON.stringify([input, revision]);
  const current = useRef(input);
  current.current = input;
  const currentKey = useRef(key);
  currentKey.current = key;
  const again = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    const run = ++latest.current;
    const requested = currentKey.current;
    try {
      const { svg, ms, ...rest } = await render({ data: current.current });
      if (run !== latest.current) return;
      const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const image = new Image();
      image.src = next;
      await image.decode().catch(() => undefined);
      if (run !== latest.current) return URL.revokeObjectURL(next);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = next;
      lastMs.current = ms;
      setSheet({ ...rest, url: next });
      setFailure(null);
      // Wer während eines Laufs weitertippt, sieht bei langsamen den Knopf, bei schnellen setzt Haben gleich neu
      const folge = afterRender(requested, currentKey.current, ms);
      setOutdated(folge === "knopf");
      clearTimeout(again.current);
      if (folge === "neu") again.current = setTimeout(() => void loadRef.current(), renderDelay(ms));
    } catch (error) {
      if (run === latest.current) setFailure(error instanceof Error ? error.message : "Die Vorschau ließ sich nicht erzeugen.");
    }
  }, [render]);
  loadRef.current = load;

  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === key) return;
    const first = shown.current === null;
    shown.current = key;
    if (first) {
      void load();
      return;
    }
    if (rendersOnDemand(lastMs.current)) {
      setOutdated(true);
      return;
    }
    const timer = setTimeout(() => void load(), renderDelay(lastMs.current));
    return () => clearTimeout(timer);
  }, [key, load]);

  useEffect(
    () => () => {
      latest.current++;
      clearTimeout(again.current);
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  return { sheet, failure, outdated, refresh: load };
}
