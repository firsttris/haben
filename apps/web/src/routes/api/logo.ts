import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../server/auth.ts";
import { fileResponse } from "../../server/file-response.ts";
import { loadLogo } from "../../server/logo.ts";

/** Firmenlogo für Vorschau und Einstellungen */
export const Route = createFileRoute("/api/logo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const logo = await loadLogo();
        if (!logo) return new Response("Kein Logo", { status: 404 });
        return fileResponse(logo.data, { mimeType: logo.format === "png" ? "image/png" : "image/jpeg", filename: `logo.${logo.format}` }, false);
      },
    },
  },
});
