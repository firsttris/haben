import { APIError } from "better-auth";
import { eq } from "drizzle-orm";
import type { auth } from "./auth.ts";
import { runPasswordChange } from "./auth-transaction.ts";
import { withActor } from "./db/actor.ts";
import { schema } from "./db/index.ts";

/** Passwort, Sitzungswiderruf und Protokolleintrag werden gemeinsam festgeschrieben. */
export async function changePasswordRequest(authentication: ReturnType<typeof auth>, request: Request): Promise<Response> {
  const current = await authentication.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!current) return Response.json({ message: "Bitte erneut anmelden." }, { status: 401 });
  const userId = current.user.id;
  try {
    return await withActor(userId, async (tx) => {
      // Zwei Passwortwechsel desselben Kontos müssen das alte Passwort nacheinander prüfen.
      await tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for("update");
      // Better Auth prüft Sitzung und Passwort und stellt beim Widerruf eine Ersatzsitzung aus.
      // https://github.com/better-auth/better-auth/blob/v1.7.14/packages/better-auth/src/api/routes/update-user.ts
      const response = await runPasswordChange(tx, () => authentication.handler(request));
      if (!response.ok) throw response;
      // Auch die Ersatzsitzung widerrufen und kein neues Sitzungscookie oder Token ausgeben.
      await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await tx.insert(schema.passwordChanges).values({ userId });
      return Response.json({ token: null, user: current.user }, { headers: { "cache-control": "no-store" } });
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof APIError && error.statusCode < 500) return Response.json(error.body, { status: error.statusCode });
    throw error;
  }
}
