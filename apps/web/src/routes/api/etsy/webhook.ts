import { createFileRoute } from "@tanstack/react-router";
import { etsyWebhookEmpfangen } from "../../../server/modules/etsy/index.ts";

/** Meldungen von Etsy (bezahlte und stornierte Bestellungen); ohne Anmeldung, den Absender belegt die Signatur */
export const Route = createFileRoute("/api/etsy/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const antwort = await etsyWebhookEmpfangen(await request.text(), {
          id: request.headers.get("webhook-id"),
          timestamp: request.headers.get("webhook-timestamp"),
          signature: request.headers.get("webhook-signature"),
        });
        return new Response(antwort.text, { status: antwort.status, headers: { "content-type": "text/plain; charset=utf-8" } });
      },
    },
  },
});
