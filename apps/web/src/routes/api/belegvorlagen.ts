import { layoutAnleitung, layoutBeispiele, layoutJsonSchema, startvorlage } from "@haben/einvoice";
import { createFileRoute } from "@tanstack/react-router";
import { fileResponse } from "../../server/file-response.ts";
import { layoutSource } from "../../server/modules/stammdaten/index.ts";
import { requireUser } from "../../server/rollen.ts";

const text = (inhalt: string, filename: string, mimeType = "text/plain") => fileResponse(new TextEncoder().encode(inhalt), { mimeType, filename }, true);
const json = (inhalt: unknown, filename: string) => text(`${JSON.stringify(inhalt, null, 2)}\n`, filename, "application/json");

/**
 * Downloads für eigene Belegvorlagen: Startvorlage je Art, Beispieldaten, Feldvertrag als JSON Schema, die Anleitung für
 * KI-Agenten und ein gespeichertes Layout (?id=…)
 */
export const Route = createFileRoute("/api/belegvorlagen")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const url = new URL(request.url);
        const art = url.searchParams.get("art") === "mahnung" ? "mahnung" : "beleg";
        switch (url.searchParams.get("datei")) {
          case "start":
            return text(startvorlage(art), art === "mahnung" ? "startvorlage-mahnung.typ" : "startvorlage-beleg.typ");
          case "beispiele":
            return json(
              layoutBeispiele()
                .filter((b) => b.art === art)
                .map(({ name, data }) => ({ name, data })),
              `beispieldaten-${art}.json`,
            );
          case "feldvertrag":
            return json(layoutJsonSchema(), "feldvertrag.json");
          case "anleitung":
            return text(layoutAnleitung(), "SKILL.md", "text/markdown");
          case "layout": {
            const id = url.searchParams.get("id") ?? "";
            const layout = /^[0-9a-f-]{36}$/i.test(id) ? await layoutSource(id) : null;
            if (!layout) return new Response("Layout nicht gefunden", { status: 404 });
            return text(layout.source, `${layout.name.replace(/[^\p{L}\p{N}._-]+/gu, "-")}.typ`);
          }
          default:
            return new Response("Unbekannte Datei", { status: 404 });
        }
      },
    },
  },
});
