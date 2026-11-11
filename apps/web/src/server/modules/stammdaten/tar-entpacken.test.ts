import { describe, expect, it } from "vitest";
import { safePath, untarGz } from "./tar-entpacken.ts";
import { tarEintrag, tarGz } from "./test-paket.ts";

const eintrag = tarEintrag;
const archiv = tarGz;
const grenzen = { maxUnpackedBytes: 1024 * 1024, maxFiles: 10 };

describe("tar.gz eines Pakets entpacken", () => {
  it("liest Dateien und überspringt Ordner, ohne „./“", () => {
    const files = untarGz(archiv(eintrag("./", "", "5"), eintrag("./typst.toml", "[package]"), eintrag("./src/lib.typ", "#let x = 1")), grenzen);
    expect(files.map((f) => [f.path, f.data.toString()])).toEqual([
      ["typst.toml", "[package]"],
      ["src/lib.typ", "#let x = 1"],
    ]);
  });

  it("liest GNU-Langnamen", () => {
    const lang = `${"a".repeat(120)}/lib.typ`;
    expect(untarGz(archiv(eintrag("././@LongLink", lang, "L"), eintrag("abgeschnitten", "x")), grenzen)[0]!.path).toBe(lang);
  });

  it("lehnt eine Archivbombe ab, bevor sie entpackt im Speicher liegt", () => {
    const bombe = archiv(eintrag("gross.bin", Buffer.alloc(20 * 1024 * 1024)));
    expect(bombe.length).toBeLessThan(100 * 1024);
    expect(() => untarGz(bombe, grenzen)).toThrow(/entpackt größer als 1 MB/);
  });

  it("lehnt zu viele Dateien ab", () => {
    const viele = Array.from({ length: 11 }, (_, i) => eintrag(`d${i}.typ`, "x"));
    expect(() => untarGz(archiv(...viele), grenzen)).toThrow(/mehr als 10 Dateien/);
  });

  it("lehnt Pfade außerhalb des Pakets ab", () => {
    expect(() => untarGz(archiv(eintrag("../../etc/x", "x")), grenzen)).toThrow(/außerhalb des Pakets/);
    expect(() => untarGz(archiv(eintrag("/etc/passwd", "x")), grenzen)).toThrow(/außerhalb des Pakets/);
    expect(() => safePath("src/../../x")).toThrow(/außerhalb/);
  });

  it("lehnt Links und andere Einträge ab", () => {
    expect(() => untarGz(archiv(eintrag("link", "", "2")), grenzen)).toThrow(/keine Datei/);
    expect(() => untarGz(archiv(eintrag("hart", "", "1")), grenzen)).toThrow(/keine Datei/);
  });

  it("lehnt ein Archiv ab, das kein gzip ist", () => {
    expect(() => untarGz(Buffer.from("kein gzip"), grenzen)).toThrow(/kein gültiges/);
  });
});
