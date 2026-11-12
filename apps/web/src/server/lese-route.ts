import { ReadOnlyError, runReadOnly } from "./db/actor.ts";
import { pruefeZugriff, type SessionUser } from "./rollen.ts";

/*
 * API-Routen, die auch die Steuerberatung abruft (Zugriff „lesen“): Dateien und Exporte. Wie `readMiddleware` bei den
 * Server Functions lässt `lesend` den Handler für jede Rolle außer dem Inhaber in `runReadOnly` laufen; `withActor`
 * lehnt dort jede Transaktion ab, auch wenn beim Lesen aus Versehen geschrieben würde. `rollen.test.ts` prüft, dass jede
 * Route für die Steuerberatung diesen Weg nimmt.
 */

/**
 * Body, dessen Teile im Nur-Lesen-Rahmen entstehen. Ein gestreamter Body (Jahresarchiv) erzeugt sie erst, wenn der
 * Server sie abholt, also nach dem Ende des Handlers und außerhalb von dessen Rahmen. Bun ruft `pull` im Kontext auf,
 * in dem der Stream entstand, Node in dem des Lesers; mit dieser Hülle gilt der Rahmen in beiden Fällen. Der Body wird
 * dabei immer gestreamt, auch ein fertiger (ohne Content-Length).
 */
function imRahmen(response: Response): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) =>
        runReadOnly(async () => {
          const { value, done } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        }),
      cancel: (reason) => runReadOnly(() => reader.cancel(reason)),
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Was ein GET-Handler von TanStack Start bekommt und eine Route zum Lesen braucht: Anfrage und Pfadparameter `P` */
export interface LeseAnfrage<P extends string> {
  request: Request;
  params: Record<P, string>;
}

/**
 * GET-Handler einer Route mit Zugriff „lesen“: prüft Sitzung und Rolle, dann läuft der Handler mit dem Konto. Für die
 * Steuerberatung laufen Handler und Body im Nur-Lesen-Rahmen; ein Schreibversuch im Handler ergibt 403, einer im Stream
 * bricht den Download ab. Der Inhaber läuft ohne Rahmen; der DATEV-Export schreibt Personenkonten nur für ihn fest.
 * Die Namen der Pfadparameter gibt die Route an, etwa `lesend<"jahr">(…)`.
 */
export function lesend<P extends string = never>(
  handler: (args: LeseAnfrage<P>, user: SessionUser) => Promise<Response>,
): (args: LeseAnfrage<P>) => Promise<Response> {
  return async (args) => {
    const user = await pruefeZugriff(args.request, "lesen");
    if (user instanceof Response) return user;
    if (user.role === "inhaber") return handler(args, user);
    try {
      return await runReadOnly(async () => imRahmen(await handler(args, user)));
    } catch (error) {
      if (error instanceof ReadOnlyError) return new Response(error.message, { status: 403 });
      throw error;
    }
  };
}
