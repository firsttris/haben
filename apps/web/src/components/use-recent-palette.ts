import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { buildRemoteSections, type PaletteItem } from "../lib/befehlspalette.ts";
import { getRecentPaletteItems, type RecentPaletteItem } from "../server/functions/search.ts";

const TYPES = { kontakte: "contact", rechnungen: "invoice", angebote: "quote", belege: "document" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRecent(key: string): RecentPaletteItem[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((item) => Object.values(TYPES).includes(item?.type) && typeof item?.id === "string" && UUID.test(item.id)).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function useRecentPalette(open: boolean, inhaber: boolean): PaletteItem[] {
  const path = useRouterState({ select: (state) => state.resolvedLocation?.pathname ?? state.location.pathname });
  const key = inhaber ? "haben-schnellsuche-inhaber" : "haben-schnellsuche-steuerberatung";
  const [result, setResult] = useState<{ key: string; items: PaletteItem[] } | null>(null);

  useEffect(() => {
    const [, section, id] = path.match(/^\/(kontakte|rechnungen|angebote|belege)\/([^/]+)\/?$/) ?? [];
    if (!section || !id || !UUID.test(id)) return;
    const type = TYPES[section as keyof typeof TYPES];
    const recent = readRecent(key).filter((item) => item.type !== type || item.id !== id);
    try {
      localStorage.setItem(key, JSON.stringify([{ type, id }, ...recent].slice(0, 8)));
    } catch {
      // Die Suche bleibt auch bei gesperrtem Browser-Speicher nutzbar.
    }
  }, [key, path]);

  useEffect(() => {
    setResult(null);
    if (!open) return;
    const recent = readRecent(key);
    if (recent.length === 0) return;
    let active = true;
    void getRecentPaletteItems({ data: recent })
      .then((remote) => {
        if (!active) return;
        const byId = new Map(buildRemoteSections(remote, inhaber).flatMap((section) => section.items.map((item) => [item.id, item])));
        setResult({ key, items: recent.flatMap(({ type, id }) => byId.get(`${type}-${id}`) ?? []) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key, open, inhaber]);

  return useMemo(() => (result?.key === key ? result.items : []), [key, result]);
}
