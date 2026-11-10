import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * API-Routen mit Zugriff „lesen“ (lese-route.ts): Für die Steuerberatung laufen Handler und Body in `runReadOnly`, so
 * lehnt `withActor` jeden Schreibversuch ab wie bei den Server Functions mit `readMiddleware`. Ohne Datenbank: Im
 * Nur-Lesen-Rahmen lehnt `withActor` ab, bevor es eine Verbindung braucht.
 */

const pruefeZugriff = vi.hoisted(() => vi.fn());
vi.mock("./rollen.ts", () => ({ pruefeZugriff }));
vi.mock("./db/index.ts", () => ({ db: {} }));

const { lesend } = await import("./lese-route.ts");
const { ReadOnlyError, isReadOnly, withActor } = await import("./db/actor.ts");

const steuerberatung = { id: "stb", name: "Kanzlei", email: "k@example.de", role: "steuerberatung" as const };
const inhaber = { id: "inhaber", name: "Inhaber", email: "i@example.de", role: "inhaber" as const };
const anfrage = () => ({ request: new Request("http://localhost:3000/api/export/2026"), params: {} });

/** Body, der seine Teile erst erzeugt, wenn jemand liest (wie das Jahresarchiv); jeder Teil sagt, ob er im Rahmen lief */
function gestreamt(teile: number, schreibtZuletzt = false): Response {
  let n = 0;
  return new Response(
    new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          if (n === teile) {
            if (schreibtZuletzt) await withActor("stb", async () => undefined);
            controller.close();
            return;
          }
          n++;
          controller.enqueue(new TextEncoder().encode(`${isReadOnly()};`));
        },
      },
      // Kein Vorrat: jeder Teil entsteht erst beim Lesen, nach dem Ende des Handlers
      { highWaterMark: 0 },
    ),
    { headers: { "Content-Type": "application/zip", "X-Test": "1" } },
  );
}

/** Liest den Body außerhalb jedes Rahmens, mit Pause vor jedem Teil, wie der HTTP-Server beim Senden */
async function liesSpaeter(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  let text = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const { value, done } = await reader.read();
    if (done) return text;
    text += new TextDecoder().decode(value);
  }
}

describe("API-Routen mit Zugriff „lesen“", () => {
  beforeEach(() => pruefeZugriff.mockReset());

  it("prüft Sitzung und Zugriff „lesen“ und gibt die Ablehnung unverändert zurück", async () => {
    const abgelehnt = new Response("Nicht angemeldet", { status: 401 });
    pruefeZugriff.mockResolvedValue(abgelehnt);
    const handler = vi.fn();
    const a = anfrage();
    expect(await lesend(handler)(a)).toBe(abgelehnt);
    expect(pruefeZugriff).toHaveBeenCalledWith(a.request, "lesen");
    expect(handler).not.toHaveBeenCalled();
  });

  it("die Steuerberatung: der Handler läuft im Nur-Lesen-Rahmen, ein Schreibversuch ergibt 403", async () => {
    pruefeZugriff.mockResolvedValue(steuerberatung);
    const gesehen: boolean[] = [];
    const ok = await lesend(async (_args, user) => {
      gesehen.push(isReadOnly());
      return new Response(user.id);
    })(anfrage());
    expect(await ok.text()).toBe("stb");
    expect(gesehen).toEqual([true]);

    const schreibt = await lesend(async () => {
      await withActor("stb", async () => undefined);
      return new Response("geschrieben");
    })(anfrage());
    expect(schreibt.status).toBe(403);
    expect(await schreibt.text()).toBe(new ReadOnlyError().message);
  });

  it("die Steuerberatung: der Rahmen gilt auch, während der gestreamte Body gelesen wird", async () => {
    pruefeZugriff.mockResolvedValue(steuerberatung);
    const response = await lesend(async () => gestreamt(3))(anfrage());
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("X-Test")).toBe("1");
    expect(await liesSpaeter(response)).toBe("true;true;true;");

    // Ein Schreibversuch erst im Stream bricht den Download ab, statt zu schreiben
    const schreibt = await lesend(async () => gestreamt(2, true))(anfrage());
    await expect(liesSpaeter(schreibt)).rejects.toBeInstanceOf(ReadOnlyError);
  });

  it("der Inhaber: Handler und Body laufen ohne Rahmen, die Antwort bleibt dieselbe", async () => {
    pruefeZugriff.mockResolvedValue(inhaber);
    const antwort = gestreamt(2);
    const response = await lesend(async (_args, user) => {
      expect(user).toBe(inhaber);
      expect(isReadOnly()).toBe(false);
      return antwort;
    })(anfrage());
    expect(response).toBe(antwort);
    expect(await liesSpaeter(response)).toBe("false;false;");
  });
});
