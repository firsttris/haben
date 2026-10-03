import { createServerFn } from "@tanstack/react-start";
import { calendarTokenActive, createCalendarToken, listFristen, revokeCalendarToken } from "../fristen.ts";
import { authMiddleware } from "../middleware.ts";
import { today } from "../today.ts";

export const getFristen = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const now = today();
    const [fristen, abo] = await Promise.all([listFristen(now), calendarTokenActive()]);
    return { today: now, fristen, abo };
  });

/** Neuer Abo-Link; das Token kommt nur in dieser Antwort vor */
export const createFristenAbo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => ({ token: await createCalendarToken(context.user.id) }));

export const revokeFristenAbo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await revokeCalendarToken(context.user.id);
    return { ok: true };
  });
