import { describe, expect, it } from "vitest";
import { json, sevdeskFakeFetch } from "./test-sevdesk-api.ts";

const get = async (f: typeof fetch, path: string) => {
  const res = await f(`https://my.sevdesk.de/api/v1${path}`);
  return { status: res.status, body: await res.json() };
};

describe("nachgestellte sevDesk-API für Tests", () => {
  it("beantwortet ungenannte Pfade wie ein leeres Konto in Version 1.0", async () => {
    const f = sevdeskFakeFetch();
    expect(await get(f, "/Tools/bookkeepingSystemVersion")).toEqual({ status: 200, body: { objects: { version: "1.0" } } });
    // auch eine Sammlung, die es heute noch nicht gibt: ein neuer Abrufschritt bricht keinen Test
    expect(await get(f, "/NeueSammlung?offset=0")).toEqual({ status: 200, body: { objects: [] } });
    expect(await get(f, "/Invoice/7/getPositions?offset=0")).toEqual({ status: 200, body: { objects: [] } });
    expect(await get(f, "/AccountingType/ID_5")).toEqual({
      status: 200,
      body: { objects: [{ id: "ID_5", objectName: "AccountingType", skr03: "4980", skr04: "6850" }] },
    });
    expect((await get(f, "/Document/9/download")).status).toBe(404);
  });

  it("die Antwort des Tests kommt zuerst; Listen sind nur auf der ersten Seite gefüllt", async () => {
    const f = sevdeskFakeFetch(({ path, list }) => {
      if (path === "/Voucher") return list([{ id: "1" }]);
      if (path === "/AccountingType/ID_5") return json({ error: { message: "Nicht gefunden" } }, 404);
    });
    expect(await get(f, "/Voucher?offset=0")).toEqual({ status: 200, body: { objects: [{ id: "1" }] } });
    expect(await get(f, "/Voucher?offset=100")).toEqual({ status: 200, body: { objects: [] } });
    expect((await get(f, "/AccountingType/ID_5")).status).toBe(404);
  });
});
