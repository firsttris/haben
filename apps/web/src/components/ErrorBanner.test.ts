import { describe, expect, it } from "vitest";
import { errorKind } from "./ErrorBanner.tsx";

describe("errorKind", () => {
  it("ordnet Netzwerkfehler als nicht erreichbar ein", () => {
    expect(errorKind("connect ECONNREFUSED 127.0.0.1:1")).toBe("Server nicht erreichbar");
    expect(errorKind("getaddrinfo ENOTFOUND imap.example.de")).toBe("Server nicht erreichbar");
    expect(errorKind("Connection timed out")).toBe("Server nicht erreichbar");
  });

  it("erkennt abgelehnte Anmeldung und TLS-Probleme", () => {
    expect(errorKind("Invalid login: 535 Authentication failed")).toBe("Anmeldung abgelehnt");
    expect(errorKind("self signed certificate in certificate chain")).toBe("Verschlüsselte Verbindung fehlgeschlagen");
  });

  it("bleibt sonst allgemein", () => {
    expect(errorKind("Ordner Belege nicht gefunden")).toBe("Fehler");
  });
});
