import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderDocumentPreview } from "../server/functions/invoices.ts";
import type { DocumentPreview, DocumentPreviewInput } from "../server/modules/rechnungen/index.ts";
import { outdatedAfterRender, renderDelay, rendersOnDemand } from "./vorschau-render.ts";

export type LoadedSheet = Omit<DocumentPreview, "svg" | "ms"> & { url: string };

/**
 * Hält das gesetzte Blatt zum Formular aktuell, solange die Vorschau zu sehen ist. Was während eines Laufs veraltet, wird
 * verworfen; bis das neue Bild dekodiert ist, bleibt das alte stehen, damit nichts flackert.
 */
export function useRenderedSheet(input: DocumentPreviewInput, revision: string | null) {
  const render = useServerFn(renderDocumentPreview);
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
      // Wer während eines langsamen Laufs weitertippt, sieht weiter den Knopf
      setOutdated(outdatedAfterRender(requested, currentKey.current, ms));
    } catch (error) {
      if (run === latest.current) setFailure(error instanceof Error ? error.message : "Die Vorschau ließ sich nicht erzeugen.");
    }
  }, [render]);

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
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  return { sheet, failure, outdated, refresh: load };
}
