import { describe, expect, it } from "vitest";
import { isLocalRepository, ohneZugangsdaten } from "./restic-ziel.ts";

/** Formen von RESTIC_REPOSITORY nach der restic-Doku (Abschnitt „Preparing a new repository“) und den Verbindungszeichenketten von rclone */
describe("ohneZugangsdaten", () => {
  it("entfernt ein Passwort mit @ vollständig (Go url.Parse nimmt das letzte @ der Authority)", () => {
    expect(ohneZugangsdaten("rest:https://nutzer:ge@heim@backup.example:8000/haben")).toBe("rest:https://backup.example:8000/haben");
  });

  it("entfernt ein Passwort mit / ohne Prozentkodierung, etwa aus openssl rand -base64, auch in der Fehlermeldung von restic", () => {
    // Go url.Parse endet die Authority am ersten /, findet kein @ und bricht mit der ganzen Adresse in der Meldung ab
    expect(ohneZugangsdaten("rest:https://nutzer:ab/cd+ef@backup.example/haben")).toBe("rest:https://backup.example/haben");
    // Go kann die Adresse nicht lesen und hält ":ab", den Anfang des Passworts, für den Port: Adresse und Port fallen weg
    expect(ohneZugangsdaten('Fatal: parse "https://nutzer:ab/cd@ef@backup.example/haben": invalid port ":ab" after host')).toBe(
      'Fatal: parse "https://": invalid port after host',
    );
    expect(ohneZugangsdaten("rest:https://nutzer:geheim@backup.example/haben?x@y")).toBe("rest:https://backup.example/haben?x@y");
  });

  it.each([
    ["rest:https://nutzer:ab/cd@ef@backup.example:8000/haben", "rest:https://backup.example:8000/haben"],
    ["rest:https://nutzer:ab%2Fcd@backup.example/haben", "rest:https://backup.example/haben"],
    ["rest:https://nutzer:a'b/cd@backup.example/haben", "rest:https://backup.example/haben"],
    ["rest:https://nutzer@example.com:ab/cd@backup.example/haben", "rest:https://backup.example/haben"],
    ["s3:https://SCHLUESSEL:ab/cd@s3.example.com/haben-backup", "s3:https://s3.example.com/haben-backup"],
    ["sftp://nutzer:ab/cd@backup.example:2222//srv/restic", "sftp://backup.example:2222//srv/restic"],
    ["rclone::webdav,url='https://nutzer:ab/cd@dav.example/haben':pfad", "rclone::webdav:pfad"],
    ["rest:https://nutzer:ab/cd@[::1]:8000/haben", "rest:https://[::1]:8000/haben"],
    ["rest:https://nutzer:ab/cd@backup.example: connection refused", "rest:https://backup.example: connection refused"],
    ["a rest:https://u:ab/cd@h1/x und b s3:https://v:ef/gh@h2/y", "a rest:https://h1/x und b s3:https://h2/y"],
    ['Fatal: parse \\"https://nutzer:ab/cd@backup.example\\": invalid port', 'Fatal: parse \\"https://backup.example\\": invalid port'],
  ])("entfernt das Passwort mit / auch in %s", (text, erwartet) => {
    expect(ohneZugangsdaten(text)).toBe(erwartet);
  });

  it.each([
    "rest:https://h/haben@2026",
    "sftp://h//srv/a@b",
    "rest:https://[::1]:8000/a@b",
    "rest:https://h/haben?x@y",
    "rest:https://h?x@y",
    "https://h/x,mail:a@b.de",
    "(https://h/x)(https://g/y@z)",
  ])("lässt das Ziel ohne Zugangsdaten %s unverändert, auch mit @ im Pfad", (text) => {
    expect(ohneZugangsdaten(text)).toBe(text);
  });

  it("entfernt, was Go aus einer Adresse nennt, die es nicht lesen kann (#1349)", () => {
    // Bei # im Passwort schneidet Go die Adresse vor der Meldung ab, ein @ im Rest sähe wie das Ende der Zugangsdaten aus
    expect(ohneZugangsdaten('Fatal: parse "https://nutzer:ab": invalid port ":ab" after host')).toBe('Fatal: parse "https://": invalid port after host');
    expect(ohneZugangsdaten('Fatal: parse "https://nutzer:ab/@cd": invalid port ":ab" after host')).toBe('Fatal: parse "https://": invalid port after host');
    // Ein Tippfehler im Port: Hinter dem letzten @ steht kein Host, die Zugangsdaten fallen trotzdem weg wie im Backup-Container
    expect(ohneZugangsdaten("rest:https://nutzer:geheim@backup.example:8OOO/haben")).toBe("rest:https://backup.example:8OOO/haben");
  });

  it("erkennt den Host mit Port auch vor „: “ wie in „unable to open repository at %v: %v“ von restic (#1349)", () => {
    // Ziffern vor dem / liest Go als Port, die Adresse ist lesbar, restic scheitert erst beim Verbinden
    expect(ohneZugangsdaten("Fatal: unable to open repository at rest:https://nutzer:12/cd@backup.example:8000: dial tcp")).toBe(
      "Fatal: unable to open repository at rest:https://backup.example:8000: dial tcp",
    );
  });

  it("entfernt Zugangsdaten nur aus der Adresse, die sie trägt", () => {
    expect(ohneZugangsdaten("(https://h/x)(https://u:p@g/y)")).toBe("(https://h/x)(https://g/y)");
  });

  it("nimmt bei Port und @ im Pfad lieber das Ziel als ein Passwort mit / in Kauf", () => {
    // nutzer:12/ab@h und h:12/ab@h sind nicht zu unterscheiden
    expect(ohneZugangsdaten("rest:https://nutzer:12/ab@h")).toBe("rest:https://h");
    expect(ohneZugangsdaten("rest:https://h:8000/a@b")).toBe("rest:https://b");
  });

  it("entfernt Nutzer und Passwort einer rclone-Verbindungszeichenkette", () => {
    expect(ohneZugangsdaten("rclone::sftp,host=backup.example,user=nutzer,pass=GEHEIM:haben")).toBe("rclone::sftp:haben");
    expect(ohneZugangsdaten("rclone:fern,pass='a:GEHEIM':haben")).toBe("rclone:fern:haben");
  });

  it("entfernt Zugangsdaten auch in s3-Adressen", () => {
    expect(ohneZugangsdaten("s3:https://SCHLUESSEL:GE@HEIM@s3.example.com/haben-backup")).toBe("s3:https://s3.example.com/haben-backup");
  });

  it("entfernt den Nutzer der sftp-Kurzform", () => {
    expect(ohneZugangsdaten("sftp:nutzer@backup.example:/srv/restic")).toBe("sftp:backup.example:/srv/restic");
  });

  it("lässt Ziele ohne Zugangsdaten und gewöhnliche Meldungen unverändert", () => {
    for (const text of ["s3:s3.example.com/haben-backup", "rclone:fern:haben", "/repo", "b2:bucket:pfad", "Kette und Siegel geprüft, Mail an max@example.com"])
      expect(ohneZugangsdaten(text)).toBe(text);
  });
});

describe("isLocalRepository", () => {
  it("Pfad ohne Backend und local: sind ein Verzeichnis im Backup-Container", () => {
    for (const repository of ["/backups", "local:/srv/restic/haben", "LOCAL:/backups", "../restic", "backups", "C:/restic"])
      expect(isLocalRepository(repository), repository).toBe(true);
  });

  it("Backends von restic liegen woanders", () => {
    for (const repository of [
      "sftp:backup.example:/srv/restic",
      "sftp://backup.example:2222//srv/restic",
      "s3:https://fsn1.your-objectstorage.com/bucket/haben",
      "rest:https://backup.example/haben",
      "b2:bucket:pfad",
      "azure:container:/haben",
      "gs:bucket:/haben",
      "swift:container:/haben",
      "rclone:fern:haben",
    ])
      expect(isLocalRepository(repository), repository).toBe(false);
  });
});
