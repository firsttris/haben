import { describe, expect, it } from "vitest";
import { parseTextFormatting, plainFormattedText } from "./text-format.ts";

const run = (text: string, style: Partial<{ bold: boolean; italic: boolean; underline: boolean }> = {}) => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...style,
});

describe("Einfache Textformatierung", () => {
  it("erkennt Fett, Kursiv und Unterstreichen und lässt Absätze stehen", () => {
    expect(parseTextFormatting("*Fett* / _Kursiv_ / __Unterstrichen__\n\nText")).toEqual([
      run("Fett", { bold: true }),
      run(" / "),
      run("Kursiv", { italic: true }),
      run(" / "),
      run("Unterstrichen", { underline: true }),
      run("\n\nText"),
    ]);
  });

  it("akzeptiert auch doppelte Sternchen für Fett", () => {
    expect(parseTextFormatting("**Überschrift**")).toEqual([run("Überschrift", { bold: true })]);
  });

  it("kombiniert die drei Auszeichnungen", () => {
    expect(parseTextFormatting("*Fett _kursiv __und unterstrichen___*.")).toEqual([
      run("Fett ", { bold: true }),
      run("kursiv ", { bold: true, italic: true }),
      run("und unterstrichen", { bold: true, italic: true, underline: true }),
      run("."),
    ]);
  });

  it("erhält Dateinamen, URLs, Rechenzeichen und unvollständige Auszeichnungen", () => {
    for (const text of [
      "backup_2026_final.zip",
      "__init__.py",
      "document.__draft__.txt",
      "https://example.org/_datei_",
      "C:\\_archiv_\\2026",
      "2 * 3 = 6",
      "* offen",
      "_offen",
      "__offen",
      "**offen",
      "*leer *",
      "___",
      "***",
    ]) {
      expect(plainFormattedText(text)).toBe(text);
    }
  });

  it("behält nicht geschlossene Zeichen um gültige innere Auszeichnungen", () => {
    expect(parseTextFormatting("*offen _kursiv_")).toEqual([run("*offen "), run("kursiv", { italic: true })]);
  });

  it("wertet weder HTML noch Typst oder Markdown-Links aus", () => {
    const text = '<script>alert(1)</script> #panic("x") [Link](https://example.org)';
    expect(parseTextFormatting(text)).toEqual([run(text)]);
  });

  it("erlaubt ausdrücklich maskierte Auszeichnungszeichen", () => {
    expect(plainFormattedText("\\*wörtlich\\* und \\_ebenso\\_")).toBe("*wörtlich* und _ebenso_");
  });

  it("liefert für maschinenlesbare Texte nur den Inhalt", () => {
    expect(plainFormattedText("**Bestellung**: _Projekt_ und __Termin__")).toBe("Bestellung: Projekt und Termin");
    expect(parseTextFormatting("")).toEqual([]);
  });
});
