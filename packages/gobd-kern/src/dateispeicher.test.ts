import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dateispeicher, sha256Of } from "./dateispeicher.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gobd-kern-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const inhalt = new TextEncoder().encode("Rechnung 2026-001 über 119,00 €");

describe("dateispeicher", () => {
  it("legt die Datei unter ihrem SHA-256 in einem Ordner mit den ersten zwei Zeichen ab", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const hash = await speicher.speichern(inhalt);
    expect(hash).toBe(sha256Of(inhalt));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(speicher.pfad(hash)).toBe(join(dir, hash.slice(0, 2), hash));
    expect(new Uint8Array(await readFile(speicher.pfad(hash)))).toEqual(inhalt);
  });

  it("liefert für gleichen Inhalt denselben Hash und lässt die vorhandene Datei liegen", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const a = await speicher.speichern(inhalt);
    const b = await speicher.speichern(new Uint8Array(inhalt));
    expect(b).toBe(a);
    expect(new Uint8Array(await speicher.laden(a))).toEqual(inhalt);
  });

  it("meldet eine veränderte Datei beim Lesen als beschädigt, mit der Bezeichnung des Aufrufers", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir, bezeichnung: "Belegdatei" });
    const hash = await speicher.speichern(inhalt);
    await writeFile(speicher.pfad(hash), "verändert");
    await expect(speicher.laden(hash)).rejects.toThrow(`Belegdatei ${hash} ist beschädigt`);
  });

  it("ersetzt eine beschädigte Datei beim erneuten Speichern durch das Original", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const hash = await speicher.speichern(inhalt);
    await writeFile(speicher.pfad(hash), "");
    await speicher.speichern(inhalt);
    expect(new Uint8Array(await speicher.laden(hash))).toEqual(inhalt);
  });

  it("lehnt einen Hash ab, der kein SHA-256 in Kleinbuchstaben ist, damit kein Pfad aus dem Speicher führt", () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    expect(() => speicher.pfad("../../etc/passwd")).toThrow("Ungültiger Hash");
    expect(() => speicher.pfad("A".repeat(64))).toThrow("Ungültiger Hash");
  });

  it("entfernt eine Datei; eine fehlende Datei ist kein Fehler", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const hash = await speicher.speichern(inhalt);
    await speicher.entfernen(hash);
    await expect(speicher.laden(hash)).rejects.toThrow();
    await expect(speicher.entfernen(hash)).resolves.toBeUndefined();
  });

  it("prüft eine Datei gegen ihren Hash: vorhanden und unverändert, beschädigt oder fehlend", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const hash = await speicher.speichern(inhalt);
    expect(await speicher.pruefen(hash)).toBe("ok");
    await writeFile(speicher.pfad(hash), "verändert");
    expect(await speicher.pruefen(hash)).toBe("beschädigt");
    await rm(speicher.pfad(hash));
    expect(await speicher.pruefen(hash)).toBe("fehlt");
  });

  it("prüft auch Dateien, die größer sind als ein Lesepuffer", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const gross = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    const hash = await speicher.speichern(gross);
    expect(await speicher.pruefen(hash)).toBe("ok");
  });

  it("meldet beim Prüfen andere Lesefehler als einen fehlenden Eintrag als Fehler", async () => {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const hash = sha256Of(inhalt);
    await mkdir(speicher.pfad(hash), { recursive: true });
    await expect(speicher.pruefen(hash)).rejects.toThrow();
  });

  it("liest das Verzeichnis erst beim Zugriff", async () => {
    let wurzel = join(dir, "erst");
    const speicher = dateispeicher({ verzeichnis: () => wurzel });
    wurzel = join(dir, "dann");
    const hash = await speicher.speichern(inhalt);
    expect(speicher.pfad(hash).startsWith(join(dir, "dann"))).toBe(true);
  });
});

describe("pruefenAlle", () => {
  async function bestand() {
    const speicher = dateispeicher({ verzeichnis: () => dir });
    const heil = await speicher.speichern(new TextEncoder().encode("heil"));
    const veraendert = await speicher.speichern(new TextEncoder().encode("verändert"));
    await writeFile(speicher.pfad(veraendert), "anders");
    const fehlt = await speicher.speichern(new TextEncoder().encode("fehlt"));
    await rm(speicher.pfad(fehlt));
    return { speicher, heil, veraendert, fehlt };
  }

  it("prüft alle Dateien nacheinander und nennt die Befunde in der Reihenfolge der Hashes", async () => {
    const { speicher, heil, veraendert, fehlt } = await bestand();
    expect(await speicher.pruefenAlle([fehlt, heil, veraendert])).toEqual({
      dateien: 3,
      befundAnzahl: 2,
      befunde: [
        { sha256: fehlt, befund: "fehlt" },
        { sha256: veraendert, befund: "beschädigt" },
      ],
    });
  });

  it("zählt alle Befunde, gibt aber nur die ersten maxBefunde einzeln zurück", async () => {
    const { speicher, heil, veraendert, fehlt } = await bestand();
    const ergebnis = await speicher.pruefenAlle([heil, veraendert, fehlt], { maxBefunde: 1 });
    expect(ergebnis).toEqual({ dateien: 3, befundAnzahl: 2, befunde: [{ sha256: veraendert, befund: "beschädigt" }] });
  });

  it("meldet eine fehlende Datei nicht, die laut nochGenutzt niemand mehr braucht, und fragt nur bei fehlenden nach", async () => {
    const { speicher, heil, veraendert, fehlt } = await bestand();
    const gefragt: string[] = [];
    const nochGenutzt = async (sha256: string) => {
      gefragt.push(sha256);
      return false;
    };
    const ergebnis = await speicher.pruefenAlle([heil, veraendert, fehlt], { nochGenutzt });
    expect(ergebnis).toEqual({ dateien: 3, befundAnzahl: 1, befunde: [{ sha256: veraendert, befund: "beschädigt" }] });
    expect(gefragt).toEqual([fehlt]);
  });

  it("meldet eine Datei, die sich nicht lesen lässt, mit Ursache und prüft die übrigen weiter", async () => {
    const { speicher, heil, fehlt } = await bestand();
    const gesperrt = sha256Of(new TextEncoder().encode("gesperrt"));
    await mkdir(speicher.pfad(gesperrt), { recursive: true });
    const ergebnis = await speicher.pruefenAlle([gesperrt, heil, fehlt]);
    expect(ergebnis).toEqual({
      dateien: 3,
      befundAnzahl: 2,
      befunde: [
        { sha256: gesperrt, befund: "nicht lesbar", ursache: "EISDIR" },
        { sha256: fehlt, befund: "fehlt" },
      ],
    });
  });

  it("nimmt jede Folge von Hashes, auch die Schlüssel einer Map", async () => {
    const { speicher, heil, fehlt } = await bestand();
    const verweise = new Map([
      [heil, "a.pdf"],
      [fehlt, "b.pdf"],
    ]);
    expect(await speicher.pruefenAlle(verweise.keys())).toMatchObject({ dateien: 2, befundAnzahl: 1 });
  });
});
