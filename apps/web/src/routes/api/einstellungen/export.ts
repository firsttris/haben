import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { exportSettings, settingsExportFilename } from "../../../server/modules/instanzwechsel/index.ts";

/**
 * Einstellungen und Stammdaten als JSON für eine neue Instanz (#488). Nur für den Inhaber: Die Datei enthält persönliche
 * Angaben, Steuer-ID und Bankverbindung, die die Steuerberatung für ihre Arbeit nicht braucht.
 */
export const Route = createFileRoute("/api/einstellungen/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const now = new Date();
        return new Response(JSON.stringify(await exportSettings(now), null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${settingsExportFilename(now)}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
