import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count } from "drizzle-orm";
import { auth } from "../auth.ts";
import { db, schema } from "../db/index.ts";

/** Öffentlich: ob Haben schon eingerichtet ist und ob jemand angemeldet ist. */
export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const [row] = await db.select({ n: count() }).from(schema.user);
  const session = await auth().api.getSession({ headers: getRequestHeaders() });
  return {
    initialized: (row?.n ?? 0) > 0,
    user: session ? { name: session.user.name, email: session.user.email } : null,
  };
});
