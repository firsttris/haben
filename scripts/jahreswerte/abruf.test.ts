import { describe, expect, it } from "vitest";
import { abrufen, begrenzt, type Holen, mitWiederholung, text } from "./abruf.ts";
import { antwort, nachgestellt, netzwerkfehler } from "./nachgestellt.ts";

const URL_A = "https://example.org/a";

describe("Abruf", () => {
  it("wiederholt nach einem Netzwerkfehler oder 5xx einmal", async () => {
    let versuche = 0;
    const holen = mitWiederholung(async () => (++versuche === 1 ? new Response("", { status: 503 }) : new Response("ok")), 0);
    expect(await (await holen(URL_A)).text()).toBe("ok");
    expect(versuche).toBe(2);

    const zweimalWeg = nachgestellt({ [URL_A]: netzwerkfehler });
    expect(await abrufen(mitWiederholung(zweimalWeg, 0), URL_A)).toEqual({ art: "fehler", meldung: "Connection reset by peer" });
    expect(zweimalWeg.aufrufe).toHaveLength(2);
  });

  it("gibt jedem Versuch ein eigenes Zeitlimit, damit die Wiederholung nach einer Zeitüberschreitung eine Chance hat", async () => {
    const signale: (AbortSignal | null | undefined)[] = [];
    const holen = mitWiederholung(async (_url, init) => {
      signale.push(init?.signal);
      if (signale.length === 1) throw new DOMException("The operation timed out.", "TimeoutError");
      init?.signal?.throwIfAborted();
      return new Response("ok");
    }, 0);
    expect(await abrufen(holen, URL_A)).toMatchObject({ art: "antwort", status: 200 });
    expect(signale[0]).toBeInstanceOf(AbortSignal);
    expect(signale[1]).toBeInstanceOf(AbortSignal);
    expect(signale[1]).not.toBe(signale[0]);
  });

  it("bricht nach Ablauf der Gesamtfrist jeden Abruf sofort ab, damit der Lauf vor dem Zeitlimit des Jobs endet", async () => {
    // ERiC prüft über 300 Kandidaten zu sechst: hängt download.elster.de, wären das 56 Runden je 2 × 30 s, weit über
    // die 15 Minuten des Jobs; ohne Gesamtfrist bricht GitHub den Lauf ab, statt eine Warnung auszugeben.
    const haengt: Holen = (_url, init) => new Promise((_, ab) => init?.signal?.addEventListener("abort", () => ab(init.signal?.reason)));
    const holen = mitWiederholung(haengt, 0, 60_000, AbortSignal.timeout(50));
    const ergebnisse = await Promise.all([URL_A, URL_A, URL_A].map((url) => abrufen(holen, url)));
    expect(ergebnisse.every((e) => e.art === "fehler")).toBe(true);
    expect((await abrufen(holen, URL_A)).art).toBe("fehler");
  }, 2_000);

  it("wiederholt bei 404 nicht", async () => {
    const holen = nachgestellt({});
    expect(await abrufen(mitWiederholung(holen, 0), URL_A)).toMatchObject({ art: "antwort", status: 404 });
    expect(holen.aufrufe).toHaveLength(1);
  });

  it("folgt keiner Weiterleitung und liest den Körper nur auf Wunsch", async () => {
    const holen = nachgestellt({ [URL_A]: antwort(303, "x", { location: "/404.html" }) });
    expect(await abrufen(holen, URL_A)).toMatchObject({ status: 303, ort: "/404.html" });
    expect(holen.aufrufe[0]?.init?.redirect).toBe("manual");
    const ohne = await abrufen(nachgestellt({ [URL_A]: antwort(200, "groß") }), URL_A, {}, false);
    expect(ohne).toMatchObject({ status: 200, inhalt: new Uint8Array() });
  });

  it("dekodiert ISO-8859-1 nach dem Content-Type", async () => {
    const holen = nachgestellt({
      [URL_A]: { status: 200, bytes: new Uint8Array([0xa7, 0x20, 0xfc]), headers: { "content-type": "text/html; charset=iso-8859-1" } },
    });
    const a = await abrufen(holen, URL_A);
    expect(a.art === "antwort" && text(a)).toBe("§ ü");
  });

  it("hält die Reihenfolge bei begrenzter Parallelität", async () => {
    let gleichzeitig = 0;
    let hoechstens = 0;
    const ergebnis = await begrenzt([30, 10, 20, 0], 2, async (ms) => {
      hoechstens = Math.max(hoechstens, ++gleichzeitig);
      await new Promise((r) => setTimeout(r, ms));
      gleichzeitig--;
      return ms * 2;
    });
    expect(ergebnis).toEqual([60, 20, 40, 0]);
    expect(hoechstens).toBe(2);
  });
});
