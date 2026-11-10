import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.hoisted(() => vi.fn());
const uploadDocument = vi.hoisted(() => vi.fn());

vi.mock("./rollen.ts", () => ({ sessionUser, darf: () => true }));
vi.mock("./modules/belege/index.ts", () => ({ DocumentError: class extends Error {}, MAX_DOCUMENT_SIZE: 1024, uploadDocument }));
vi.mock("./env.ts", () => ({ env: () => ({ BETTER_AUTH_URL: "https://haben.example.de" }) }));

const { Route } = await import("../routes/api/belege/teilen.ts");

type Handlers = { POST: (context: { request: Request }) => Promise<Response> };

/** Hinter dem Proxy sieht die App http://app:3000, der Browser https://haben.example.de */
function teilen(dateien: File[] = []) {
  const body = new FormData();
  for (const datei of dateien) body.append("files", datei);
  const request = new Request("http://app:3000/api/belege/teilen", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body });
  return (Route.options.server as unknown as { handlers: Handlers }).handlers.POST({ request });
}

describe("Weiterleitung nach dem Teilen hinter einem Reverse Proxy", () => {
  beforeEach(() => {
    sessionUser.mockReset();
    uploadDocument.mockReset();
  });

  it("schickt ohne Sitzung zur Anmeldung, ohne die interne Adresse der App zu nennen", async () => {
    sessionUser.mockResolvedValue(null);
    const response = await teilen();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("öffnet nach einer einzelnen Datei den Beleg", async () => {
    sessionUser.mockResolvedValue({ id: "inhaber", role: "inhaber" });
    uploadDocument.mockResolvedValue({ id: "beleg-1" });
    const response = await teilen([new File(["x"], "beleg.pdf", { type: "application/pdf" })]);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/belege/beleg-1");
  });

  it("öffnet nach mehreren Dateien die Liste", async () => {
    sessionUser.mockResolvedValue({ id: "inhaber", role: "inhaber" });
    uploadDocument.mockResolvedValue({ id: "beleg-1" });
    const response = await teilen([new File(["x"], "a.pdf"), new File(["y"], "b.pdf")]);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/belege");
  });
});
