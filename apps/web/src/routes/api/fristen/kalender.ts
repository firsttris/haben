import { createFileRoute } from "@tanstack/react-router";
import { checkCalendarToken, fristenToIcs, listFristen } from "../../../server/fristen.ts";
import { env } from "../../../server/env.ts";
import { today } from "../../../server/today.ts";

/**
 * Offene Fristen als Kalender-Abo (iCalendar). Kalender-Apps melden sich nicht an, deshalb gilt der
 * geheime Token im Link; ohne gültigen Token gibt es nichts.
 */
export const Route = createFileRoute("/api/fristen/kalender")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (!(await checkCalendarToken(url.searchParams.get("token") ?? ""))) return new Response("Nicht gefunden", { status: 404 });
        const ics = fristenToIcs(await listFristen(today()), env().BETTER_AUTH_URL.replace(/\/$/, ""));
        return new Response(ics, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'inline; filename="haben-fristen.ics"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
