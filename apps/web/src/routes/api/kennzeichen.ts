import { createFileRoute } from "@tanstack/react-router";
import { fileResponse } from "../../server/file-response.ts";
import { lesend } from "../../server/lese-route.ts";
import { loadLogo, loadNavMark } from "../../server/modules/stammdaten/index.ts";

/**
 * Logo der Firma als Zeichen in der Navigation (#504), für alle Zugänge der Instanz. Nur wenn es in den Einstellungen
 * dafür gewählt ist; sonst bleibt das Logo der Belege beim Inhaber (/api/logo).
 */
export const Route = createFileRoute("/api/kennzeichen")({
  server: {
    handlers: {
      GET: lesend(async () => {
        const logo = (await loadNavMark()).logo ? await loadLogo() : undefined;
        if (!logo) return new Response("Kein Logo als Zeichen gewählt", { status: 404 });
        return fileResponse(logo.data, { mimeType: logo.format === "png" ? "image/png" : "image/jpeg", filename: `logo.${logo.format}` }, false);
      }),
    },
  },
});
