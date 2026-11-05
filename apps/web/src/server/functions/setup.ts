import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { count } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { listCustomPages } from "../modules/eigene-seiten/index.ts";
import { loadCompany } from "../modules/stammdaten/index.ts";
import { sessionUser } from "../rollen.ts";

/** Öffentlich: ob Haben schon eingerichtet ist und ob jemand angemeldet ist. */
export const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const [row] = await db.select({ n: count() }).from(schema.user);
  const user = await sessionUser(getRequestHeaders());
  return {
    initialized: (row?.n ?? 0) > 0,
    user: user ? { name: user.name, email: user.email, role: user.role } : null,
    // Für die Navigation: eine GmbH oder UG hat keine Pauschalen; erst nach der Anmeldung
    rechtsform: user ? (await loadCompany()).rechtsform : null,
    // Eigene Seiten (#199) als Menüeinträge des Inhabers, ebenfalls erst nach der Anmeldung
    eigeneSeiten: user?.role === "inhaber" ? (await listCustomPages()).map(({ id, name }) => ({ id, name })) : [],
  };
});
