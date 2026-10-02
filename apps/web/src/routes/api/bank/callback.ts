import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { BankError } from "../../../server/bank.ts";
import { completeConnection } from "../../../server/bank-sync.ts";

/** Rückleitung der Bank nach der Freigabe im Enable-Banking-Ablauf; leitet weiter auf /bank */
export const Route = createFileRoute("/api/bank/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const params = new URL(request.url).searchParams;
        const state = params.get("state");
        let message: string;
        let ok = false;
        if (!state) {
          message = "Die Rückleitung der Bank ist unvollständig.";
        } else {
          try {
            const result = await completeConnection(session.user.id, {
              state,
              code: params.get("code") ?? undefined,
              error: params.get("error") ?? undefined,
              errorDescription: params.get("error_description") ?? undefined,
            });
            ({ message, ok } = result);
          } catch (error) {
            if (!(error instanceof BankError)) throw error;
            message = error.message;
          }
        }
        const target = new URL("/bank", request.url);
        target.searchParams.set("abruf", ok ? "ok" : "fehler");
        target.searchParams.set("meldung", message.slice(0, 500));
        return new Response(null, { status: 303, headers: { location: `${target.pathname}${target.search}` } });
      },
    },
  },
});
