import { createFileRoute } from "@tanstack/react-router";
import { fileResponse } from "../../server/file-response.ts";
import { loadBackground } from "../../server/modules/stammdaten/index.ts";
import { requireUser } from "../../server/rollen.ts";

/** Briefpapier für Vorschau und Einstellungen */
export const Route = createFileRoute("/api/briefpapier")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const background = await loadBackground();
        if (!background) return new Response("Kein Briefpapier", { status: 404 });
        return fileResponse(
          background.data,
          {
            mimeType: background.format === "png" ? "image/png" : "image/jpeg",
            filename: `briefpapier.${background.format}`,
          },
          false,
        );
      },
    },
  },
});
