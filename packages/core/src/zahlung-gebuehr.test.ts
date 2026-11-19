import { describe, expect, it } from "vitest";
import { gebuehrReferenzen, gruppiereGebuehren, vorauswahlUmsatz, zahlungsReferenz } from "./zahlung-gebuehr.ts";

const u = (id: string, bankReference: string | null, amount = 100, bankAccountId = "k1", open = amount) => ({ id, bankAccountId, bankReference, amount, open });
const zahlung = (id: string, ref: string) => u(id, ref, 5_600);
const gebuehr = (id: string, ref: string) => u(id, ref, -109);

describe("zahlungsReferenz und gebuehrReferenzen", () => {
  it("erkennt die Gebühr an ihrem Anhang und nennt die Zahlung", () => {
    expect(zahlungsReferenz("txn_1-gebuehr")).toBe("txn_1");
    expect(zahlungsReferenz("ref|gebuehr")).toBe("ref");
    expect(zahlungsReferenz("txn_1")).toBeNull();
    expect(zahlungsReferenz("-gebuehr")).toBeNull();
    expect(zahlungsReferenz(null)).toBeNull();
  });

  it("nennt die möglichen Referenzen der Gebühr nur für eine Zahlung", () => {
    expect(gebuehrReferenzen("txn_1")).toEqual(["txn_1-gebuehr", "txn_1|gebuehr"]);
    expect(gebuehrReferenzen("txn_1-gebuehr")).toEqual([]);
    expect(gebuehrReferenzen("")).toEqual([]);
  });
});

describe("gruppiereGebuehren", () => {
  const ids = (list: ReturnType<typeof gruppiereGebuehren<ReturnType<typeof u>>>) => list.map((g) => [g.umsatz.id, g.gebuehr?.id ?? null]);

  it("fasst Gebühr und Zahlung zusammen, an der Stelle der Zahlung, und lässt andere Zeilen stehen", () => {
    const list = [gebuehr("fee", "txn_1-gebuehr"), u("x", "ref-x"), zahlung("pay", "txn_1"), u("payout", "txn_2", -4_000)];
    expect(ids(gruppiereGebuehren(list))).toEqual([
      ["x", null],
      ["pay", "fee"],
      ["payout", null],
    ]);
  });

  it("erkennt auch die Gebühr einer Shopify-Zeile (Anhang |gebuehr)", () => {
    expect(ids(gruppiereGebuehren([zahlung("pay", "ref"), gebuehr("fee", "ref|gebuehr")]))).toEqual([["pay", "fee"]]);
  });

  it("lässt eine Gebühr ohne Zahlung in der Liste als eigene Zeile", () => {
    expect(ids(gruppiereGebuehren([gebuehr("fee", "txn_1-gebuehr")]))).toEqual([["fee", null]]);
  });

  it("trennt Konten: gleiche Referenz auf einem anderen Konto gehört nicht zusammen", () => {
    const list = [u("pay", "txn_1", 5_600, "k1"), u("fee", "txn_1-gebuehr", -109, "k2")];
    expect(ids(gruppiereGebuehren(list))).toEqual([
      ["pay", null],
      ["fee", null],
    ]);
  });

  it("bildet keine Gruppe, wenn zwei Gebühren oder zwei Zahlungen zur selben Referenz passen", () => {
    expect(ids(gruppiereGebuehren([zahlung("pay", "txn_1"), gebuehr("f1", "txn_1-gebuehr"), gebuehr("f2", "txn_1|gebuehr")]))).toEqual([
      ["pay", null],
      ["f1", null],
      ["f2", null],
    ]);
    expect(ids(gruppiereGebuehren([zahlung("p1", "txn_1"), zahlung("p2", "txn_1"), gebuehr("fee", "txn_1-gebuehr")]))).toEqual([
      ["p1", null],
      ["p2", null],
      ["fee", null],
    ]);
  });

  it("gruppiert nur ganz offene Umsätze, damit jede Zuordnung einzeln erreichbar bleibt", () => {
    const bezahlt = { ...zahlung("pay", "txn_1"), open: 0 };
    expect(ids(gruppiereGebuehren([bezahlt, gebuehr("fee", "txn_1-gebuehr")]))).toEqual([
      ["pay", null],
      ["fee", null],
    ]);
    const gebuehrTeilweise = { ...gebuehr("fee", "txn_1-gebuehr"), open: -50 };
    expect(ids(gruppiereGebuehren([zahlung("pay", "txn_1"), gebuehrTeilweise]))).toEqual([
      ["pay", null],
      ["fee", null],
    ]);
  });

  it("gruppiert keine Erstattung mit gutgeschriebener Gebühr und keinen Eingang als Gebühr", () => {
    const erstattung = u("ref", "txn_1", -1_000);
    const gutschrift = u("gut", "txn_1-gebuehr", 30);
    expect(ids(gruppiereGebuehren([erstattung, gutschrift]))).toEqual([
      ["ref", null],
      ["gut", null],
    ]);
  });

  it("fasst nur Umsätze der genannten Konten zusammen, ein Bankkonto mit gleicher Referenz bleibt einzeln", () => {
    const list = [zahlung("pay", "RE-1"), gebuehr("fee", "RE-1-gebuehr")];
    expect(ids(gruppiereGebuehren(list, new Set(["k1"])))).toEqual([["pay", "fee"]]);
    expect(ids(gruppiereGebuehren(list, new Set(["anderes"])))).toEqual([
      ["pay", null],
      ["fee", null],
    ]);
  });

  it("kommt mit Umsätzen ohne Referenz zurecht", () => {
    expect(gruppiereGebuehren([u("a", null), u("b", null)]).map((g) => g.umsatz.id)).toEqual(["a", "b"]);
  });
});

describe("vorauswahlUmsatz", () => {
  const konten = new Set(["k1"]);

  it("wählt den ersten sichtbaren offenen Umsatz, nicht die ausgeblendete Gebühr davor", () => {
    // Betrag aufsteigend: die Gebühr steht vor der Zahlung, ist aber in der Zeile der Zahlung aufgegangen
    const list = [gebuehr("fee", "RE-1-gebuehr"), zahlung("pay", "RE-1")];
    expect(vorauswahlUmsatz(list, konten)?.id).toBe("pay");
  });

  it("überspringt zugeordnete Umsätze und fällt sonst auf den ersten sichtbaren zurück", () => {
    const erledigt = u("alt", null, 100, "k1", 0);
    expect(vorauswahlUmsatz([erledigt, u("offen", null)], konten)?.id).toBe("offen");
    expect(vorauswahlUmsatz([erledigt], konten)?.id).toBe("alt");
    expect(vorauswahlUmsatz([], konten)).toBeUndefined();
  });
});
