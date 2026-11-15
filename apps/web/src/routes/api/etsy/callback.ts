import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { completeEtsyConnection, EtsyError } from "../../../server/modules/etsy/index.ts";

/** Rückleitung von Etsy nach der Freigabe; führt zurück in die Einstellungen zum Bereich Bank */
export const Route = createFileRoute("/api/etsy/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const params = new URL(request.url).searchParams;
        try {
          await completeEtsyConnection(user.id, {
            state: params.get("state") ?? "",
            code: params.get("code") ?? undefined,
            error: params.get("error") ?? undefined,
            errorDescription: params.get("error_description") ?? undefined,
          });
        } catch (error) {
          // Der Zustand der Verbindung steht in den Einstellungen; ein unerwarteter Fehler darf die Rückleitung nicht sprengen
          if (!(error instanceof EtsyError)) throw error;
        }
        const target = new URL("/einstellungen", request.url);
        target.searchParams.set("bereich", "bank");
        return new Response(null, { status: 303, headers: { location: `${target.pathname}${target.search}` } });
      },
    },
  },
});
