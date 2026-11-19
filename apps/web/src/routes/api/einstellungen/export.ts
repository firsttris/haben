import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { exportSettingsZip, settingsExportFilename } from "../../../server/modules/instanzwechsel/index.ts";

/**
 * Einstellungen und Stammdaten als ZIP für eine neue Instanz (#488). Nur für den Inhaber: Die Datei enthält persönliche
 * Angaben, Steuer-ID und Bankverbindung, die die Steuerberatung für ihre Arbeit nicht braucht.
 */
export const Route = createFileRoute("/api/einstellungen/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const now = new Date();
        // Kopie mit eigenem ArrayBuffer, wie Response ihn als Body verlangt
        return new Response(new Uint8Array(await exportSettingsZip(now)), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${settingsExportFilename(now)}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
