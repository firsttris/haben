import { describe, expect, it } from "vitest";
import { isLocalRepository, ohneZugangsdaten } from "./restic-ziel.ts";

/** Formen von RESTIC_REPOSITORY nach der restic-Doku (Abschnitt „Preparing a new repository“) und den Verbindungszeichenketten von rclone */
describe("ohneZugangsdaten", () => {
  it("entfernt ein Passwort mit @ vollständig (Go url.Parse nimmt das letzte @ der Authority)", () => {
    expect(ohneZugangsdaten("rest:https://nutzer:ge@heim@backup.example:8000/haben")).toBe("rest:https://backup.example:8000/haben");
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
