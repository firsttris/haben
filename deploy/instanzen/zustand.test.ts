import { describe, expect, it } from "vitest";
import { diensteAusPs, lauf } from "./zustand.ts";

describe("docker compose ps --format json", () => {
  it("liest ein Objekt je Zeile (Compose ab 2.21) und ein Array (älter)", () => {
    const zeilen = '{"Service":"app","State":"running","Health":"healthy"}\n{"Service":"db","State":"exited","Health":""}\n';
    const array = '[{"Service":"app","State":"running","Health":"healthy"},{"Service":"db","State":"exited","Health":""}]';
    for (const ausgabe of [zeilen, array]) {
      const d = diensteAusPs(ausgabe);
      expect(d?.get("app")).toEqual({ state: "running", health: "healthy" });
      expect(lauf(d, "app")).toBe("laeuft");
      expect(lauf(d, "db")).toBe("gestoppt");
    }
  });

  it("unterscheidet gestoppt, Neustart-Schleife und Fehler", () => {
    expect(lauf(diensteAusPs(""), "app")).toBe("gestoppt");
    expect(lauf(diensteAusPs('{"Service":"app","State":"restarting","Health":""}'), "app")).toBe("neustart");
    expect(lauf(diensteAusPs("kein json"), "app")).toBe("fehler");
    expect(lauf(diensteAusPs('{"Name":"x"}'), "app")).toBe("fehler");
    expect(lauf(null, "app")).toBe("fehler");
  });
});
