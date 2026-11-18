import { describe, expect, it } from "vitest";
import { clientError, INTERNAL_ERROR, userClientError, UserError } from "../server/errors.ts";
import { feldfehlerAdapter } from "./feldfehler.ts";
import { fehlerFelder } from "./format.ts";

/**
 * Wie TanStack Start einen Fehler zum Browser bringt: Greift der Adapter, als JSON über dessen Form; sonst über das
 * eingebaute ShallowErrorPlugin, das nur die Meldung kennt
 */
function uebertragen(error: Error): { json: string; error: Error } {
  if (!feldfehlerAdapter.test(error)) {
    const json = JSON.stringify({ message: error.message });
    return { json, error: new Error(JSON.parse(json).message) };
  }
  const json = JSON.stringify(feldfehlerAdapter.toSerializable(error));
  return { json, error: feldfehlerAdapter.fromSerializable(JSON.parse(json)) };
}

describe("Feldfehler vom Server zum Browser", () => {
  it("bringt von einem Fachfehler mit Feldern nur Meldung und Felder mit, weder Stack noch Ursache noch Weiteres", () => {
    const fachfehler = Object.assign(new UserError("Noch nicht bereit: Lieferant FR1234", { felder: ["supplierUstId"], cause: new Error("SQL intern") }), {
      intern: "geheim",
    });
    const fuerBrowser = userClientError(fachfehler)!;
    // Bun hängt an jeden Error noch line, column und sourceURL; übertragen wird davon nichts, siehe json
    for (const name of ["stack", "cause", "intern"]) expect(Object.hasOwn(fuerBrowser, name), name).toBe(false);
    expect(fuerBrowser).toMatchObject({ message: "Noch nicht bereit: Lieferant FR1234", felder: ["supplierUstId"] });
    expect(feldfehlerAdapter.toSerializable(fuerBrowser as Error & { felder: string[] })).toStrictEqual({
      message: "Noch nicht bereit: Lieferant FR1234",
      felder: ["supplierUstId"],
    });

    const { json, error } = uebertragen(fuerBrowser);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(["felder", "message"]);
    expect(json).not.toMatch(/stack|SQL intern|geheim|cause|sourceURL/);
    expect(error.message).toBe("Noch nicht bereit: Lieferant FR1234");
    expect(fehlerFelder(error)).toEqual(["supplierUstId"]);
  });

  it("nimmt auch von einem Fehler mit Stack und weiteren Eigenschaften nur Meldung und Felder", () => {
    const error = Object.assign(new Error("Kurs prüfen"), { felder: ["exchangeRate"], intern: 1 });
    expect(feldfehlerAdapter.toSerializable(error)).toStrictEqual({ message: "Kurs prüfen", felder: ["exchangeRate"] });
  });

  it("greift nicht bei Fehlern ohne Felder: Sie kommen wie bisher nur mit der Meldung an", () => {
    for (const ohne of [userClientError(new UserError("Konto fehlt"))!, Object.assign(new Error("leer"), { felder: [] }), clientError("Nicht angemeldet.")]) {
      expect(feldfehlerAdapter.test(ohne), ohne.message).toBe(false);
      expect(fehlerFelder(uebertragen(ohne).error)).toEqual([]);
    }
    expect(Object.hasOwn(userClientError(new UserError("Konto fehlt"))!, "felder")).toBe(false);
    expect(feldfehlerAdapter.test({ message: "kein Error", felder: ["note"] })).toBe(false);
  });

  it("gibt interne Fehler nicht weiter: Der Browser bekommt nur „Interner Fehler“", () => {
    const intern = Object.assign(new TypeError("relation documents: /srv/haben/geheim"), { felder: ["note"] });
    expect(userClientError(intern)).toBeUndefined();
    const { json, error } = uebertragen(clientError(INTERNAL_ERROR));
    expect(json).toBe(JSON.stringify({ message: INTERNAL_ERROR }));
    expect(error.message).toBe(INTERNAL_ERROR);
    expect(fehlerFelder(error)).toEqual([]);
  });
});
