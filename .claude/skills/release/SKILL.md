---
name: "release"
description: "Eine neue Version von Haben veröffentlichen: Art des Releases vorschlagen (Release Candidate, Minor, Patch), vorher prüfen, nach OK des Maintainers über „Bump version“ auslösen und danach kontrollieren, dass Image, GitHub-Release und das Schließen der umgesetzten Issues durchgelaufen sind. Beim RC den Testauftrag für den Server erzeugen."
---

# Release

Wie Haben veröffentlicht wird, steht in [`docs/entwicklung.md`](../../../docs/entwicklung.md) unter „Veröffentlichen“ und „Release Candidates“; was mit den Issues passiert, unter „Branches, Titel und Commits“ (Vom Issue zum Release). Image, Tags, GitHub-Release und das Schließen der Issues macht `.github/workflows/release.yml`, sobald der Tag da ist. Dieser Skill entscheidet, prüft und kontrolliert.

**Ausgelöst wird nur nach ausdrücklichem OK des Maintainers.** Ein Release geht an alle Nutzer, und ob ein RC stabil ist, entscheidet er nach seinem Test.

## 1. Stand

```sh
git fetch origin main --tags
git describe --tags --abbrev=0 origin/main                     # letzter Tag
git tag --list 'v*' --sort=-v:refname | head                   # läuft gerade ein RC?
git log --oneline <letzter-tag>..origin/main                   # was seitdem gemergt ist
```

Die Squash-Commits auf `main` sind die PR-Beschreibungen; ihre erste Zeile ist der Titel mit `(#PR)`.

## 2. Art vorschlagen

| Lage | Vorschlag | Ergebnis aus `0.7.0` |
| --- | --- | --- |
| Neue Migrationen (`apps/web/drizzle/*.sql`) oder Änderungen an Festschreibung, Audit-Log, Siegeln oder ELSTER (`packages/elster`, ERiC, Übermittlung) | erst ein RC: `preminor` (neue Funktionen) oder `prepatch` (nur Fixes) | `v0.8.0-rc.1` bzw. `v0.7.1-rc.1` |
| Neue Funktionen ohne das oben | `minor` | `v0.8.0` |
| Nur Fixes und Doku | `patch` | `v0.7.1` |
| RC läuft, Fix nachgeschoben | `prerelease` | `v0.8.0-rc.2` |
| RC läuft und ist beim Maintainer stabil | `patch` | `v0.8.0` |
| Bruch mit bestehenden Instanzen | `major`, nur auf ausdrücklichen Wunsch | |

Neue Migrationen: `git diff --name-only --diff-filter=A <letzter-tag>..origin/main -- apps/web/drizzle`.

## 3. Vorher prüfen

- **CI auf `main` grün** für den aktuellen Stand (letzter Lauf von `ci.yml` auf `main`).
- **Zwischen RC und fertiger Version nur Fixes:** `git log --oneline <rc-tag>..origin/main` darf keine neuen Funktionen enthalten; sonst erst ein weiterer RC.
- **Was geschlossen wird:** Eine fertige Version schließt jedes Issue, das seit der vorigen fertigen Version mit `Umgesetzt #…` gemergt wurde. Vorschau ohne Tag:

  ```sh
  git log --format=%B <vorige-fertige-version>..origin/main | grep -iE '^\s*umgesetzt:?\s+#'
  ```

  Nach dem Tag zeigt `bun scripts/board/release.ts vX.Y.Z --probe` dieselbe Liste.
- **Karten in „Im nächsten Release“, deren PR nur `Refs` hat:** Die schließt das Release nicht. Dem Maintainer melden; er schließt sie danach von Hand (Skill `board-pflegen`).
- **Offene Pull Requests**, die mit hinein sollen: beim Maintainer nachfragen.

## 4. Vorschlag an den Maintainer

Kurz: vorgeschlagene Art und Version mit Grund, die Liste der Änderungen (Titel der Squash-Commits), die Issues, die geschlossen werden, und offene Punkte aus Schritt 3. Auf sein OK warten.

## 5. Auslösen

Actions → **Bump version** (`bump.yml`) mit `bump` = die gewählte Art, auf `main`. Mit einem GitHub-Werkzeug: Workflow `bump.yml` per `workflow_dispatch`, Ref `main`, Input `bump`. Der Workflow erhöht die Version in `package.json`, committet „Release vX.Y.Z“ auf `main`, taggt, und der Tag startet `release.yml`.

## 6. Danach kontrollieren

- `release.yml` auf dem Tag: alle Jobs grün (`checks` übersprungen, wenn `main` schon geprüft war).
- Docker Hub und GHCR: Tags `:x.y.z` und `:x.y`, `:latest` nur bei einer fertigen Version; beim RC `:x.y.z-rc.n` und `:next`.
- GitHub-Release mit der Erweiterung „Haben für Mein ELSTER“ als ZIP; beim RC als Pre-release.
- Fertige Version: Job `issues-schliessen` grün, seine Ausgabe nennt die geschlossenen Issues; im Project stehen sie in „Erledigt“.
- Etwas rot: nicht neu taggen; Ursache melden, beheben, beim RC `prerelease`, sonst `patch`.

## 7. Beim RC: Testauftrag

Für den Server des Maintainers einen Auftrag erzeugen, angepasst an das, was der RC ändert:

```text
Teste auf diesem Server den Release Candidate vX.Y.Z-rc.N von Haben (Image-Tag :X.Y.Z-rc.N, auch :next). Die Instanz ist eine Testinstanz.

Regeln: Vor dem Update ein Backup von Datenbank und Dateien machen und prüfen. Nichts an ELSTER senden außer mit Testmerker, keine Mails an echte Kunden. Testdaten danach stornieren. Bei einem Fehler anhalten, Logs sichern, berichten.

Ablauf: Version notieren, Backup, Image umstellen und starten (Migrationen ohne Fehler?), dann prüfen:
<je Änderung des RC ein Punkt, etwa: Abgleich von Journal, Umsatzsteuer und EÜR; freie Buchung anlegen und stornieren; ELSTER-Test mit Testmerker; Entwurf-PDF; Bankabruf; Backup-Job>

Bericht: Version vorher/nachher, Ergebnis je Punkt, Fehler mit Log-Auszug ohne Zugangsdaten, Steuernummern oder IBANs, Einschätzung: freigeben oder Fix und nächster RC.
```
