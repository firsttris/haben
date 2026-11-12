---
title: "KI-Assistenten per MCP: Buchhaltung im Gespräch abfragen"
description: >-
  Haben per MCP mit Claude oder einem lokalen Modell verbinden: offene Rechnungen, Umsatzsteuer
  und Auswertungen im Gespräch abfragen, nur mit Lesezugriff.
---

# KI-Assistenten (MCP)

Haben lässt sich im Gespräch mit einem KI-Assistenten abfragen, etwa mit Claude Code, Claude Desktop oder einem lokalen Modell: „Welche Rechnungen sind überfällig?“, „Wie viel Umsatzsteuer zahle ich im Oktober?“, „Was fehlt noch für die Jahreserklärung 2025?“. Der Assistent arbeitet dabei über Werkzeuge, die Haben nach dem [Model Context Protocol (MCP)](https://modelcontextprotocol.io) anbietet.

Der Zugang kann **nur lesen**. Buchen, Festschreiben, Stornieren, Mails versenden und alles, was an ELSTER geht, machst du weiter selbst in Haben. Die Antworten der Werkzeuge enthalten dafür Links auf die passende Seite.

## Datenschutz

Was der Assistent über die Werkzeuge liest, geht an den Anbieter des Modells. Bei Claude sind das die Server von Anthropic, **auch wenn Haben nur im Heimnetz läuft und der Client auf deinem Rechner**: Lokal heißt nur, dass Haben selbst nicht aus dem Internet erreichbar sein muss. Ganz lokal bleibt es nur mit einem lokalen Modell (etwa LM Studio oder Open WebUI mit Ollama).

- Der Zugang ist standardmäßig aus und wird ausdrücklich eingeschaltet.
- Kein Werkzeug gibt ELSTER-Zertifikat, PIN, Passwörter, API-Schlüssel oder die Steuer-ID heraus.
- Texte aus Belegen, Bankumsätzen und Bescheiden stammen von Dritten. Haben sagt dem Assistenten, dass das Daten sind und keine Anweisungen; weil der Zugang nichts ändern kann, bleibt der mögliche Schaden auf das Lesen begrenzt.

## Einrichten

1. **Einstellungen → KI-Assistenten und API** öffnen und **Zugang für KI-Assistenten und API einschalten**.
2. Unter **API-Tokens** einen Namen vergeben (z. B. „Claude Code am Laptop“), die Gültigkeit wählen (30 Tage, 90 Tage oder ein Jahr) und **Token anlegen**. Unter **Rechte** ist „KI-Assistent (MCP): Buchhaltung lesen“ (`haben:lesen`) schon angekreuzt; die übrigen Rechte gehören zur [REST-API](api.md) und braucht ein Assistent nicht.
3. Das Token sofort kopieren: Haben speichert nur seinen SHA-256-Hash und zeigt es nie wieder an.

Tokens legt nur der Inhaber an; ein [Zugang für die Steuerberatung](steuerberatung.md) sieht sie nicht und kann keine anlegen.

Jeder Assistent sollte sein eigenes Token bekommen. **Widerrufen** sperrt ein Token nach einer Rückfrage sofort; abgelaufene und widerrufene bleiben zur Nachvollziehbarkeit in der Liste. Wer ein Token angelegt, übernommen oder widerrufen hat und wann, steht im Änderungsprotokoll. Wer den Zugang wieder ausschaltet, sperrt alle Tokens auf einmal, auch die für die REST-API. Ein Token ohne `haben:lesen` lehnt `/api/mcp` mit 403 ab.

### Claude Code

Haben zeigt den Befehl nach dem Anlegen fertig an:

```bash
claude mcp add --transport http haben https://haben.example.de/api/mcp \
  --header "Authorization: Bearer hb_…"
```

### Claude Desktop

Claude Desktop bindet lokal konfigurierte Server über die Datei `claude_desktop_config.json` ein (Einstellungen › Entwickler › Konfiguration bearbeiten). Für einen HTTP-Server wie Haben geht das über die Brücke `mcp-remote`:

```json
{
  "mcpServers": {
    "haben": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://haben.example.de/api/mcp", "--header", "Authorization: Bearer ${HABEN_TOKEN}"],
      "env": { "HABEN_TOKEN": "hb_…" }
    }
  }
}
```

Ein Connector aus den Einstellungen von claude.ai (auch für die Handy-App und claude.ai im Browser) geht noch nicht: Dort ruft Anthropic Haben aus dem Internet auf und erwartet OAuth. Das ist geplant, aber noch nicht dran (Spalte „Später“ im [Project „Roadmap“](https://github.com/users/firsttris/projects/2)).

### Claude-App auf dem Handy über deinen Rechner

Ohne Connector und ohne Freigabe nach außen geht die Handy-App, wenn das Gespräch in einer Session auf deinem Rechner läuft. Claude Desktop lädt die Server aus `claude_desktop_config.json` auch in die lokalen Sessions im Code-Tab ([Doku von Anthropic](https://code.claude.com/docs/en/desktop#mcp-servers-from-the-claude-desktop-chat-app)), Haben steht dort also ohne weiteren Eintrag bereit. Eine solche Session führst du mit `/remote-control` in der Claude-App auf dem Handy weiter ([Remote Control](https://code.claude.com/docs/en/remote-control)), ebenso eine Session von Claude Code im Terminal. Mit [Dispatch](https://code.claude.com/docs/en/desktop#sessions-from-dispatch) lässt du vom Handy aus eine neue Session auf dem Rechner starten.

Den Aufruf an Haben macht dabei dein Rechner, nicht Anthropic. Haben muss also nicht aus dem Internet erreichbar sein, und die Anmeldung bleibt beim API-Token. Dafür muss der Rechner an sein und Claude Desktop oder Claude Code laufen. Remote Control gibt es in den Abos Pro, Max, Ultra, Team und Enterprise, Dispatch nur in Pro, Max und Ultra. Mit Remote Control speichert Anthropic außerdem den Verlauf der Session, damit alle Geräte denselben Stand sehen.

### Andere Clients

Jeder MCP-Client, der Streamable HTTP mit eigenem Header spricht, funktioniert: Adresse `https://<deine Adresse>/api/mcp`, Header `Authorization: Bearer <Token>`. Der Endpunkt ist zustandslos und nimmt nur POST an.

### Haben im Heimnetz mit eigenem Zertifikat

Caddy signiert Zertifikate für lokale Namen wie `haben.lan` mit seiner eigenen CA. Node-Clients wie Claude Code und `mcp-remote` vertrauen ihr nur, wenn du sie angibst, etwa mit `NODE_EXTRA_CA_CERTS=/pfad/zu/caddy-root.crt` (das Root-Zertifikat liegt im Caddy-Datenverzeichnis unter `pki/authorities/local/root.crt`). Die Alternative ist eine echte Domain mit DNS-Challenge, die nur intern auflöst.

## Werkzeuge

| Werkzeug | Liefert |
| --- | --- |
| `uebersicht` | aktuelle Voranmeldung mit Zahllast und Fälligkeit, offene und überfällige Rechnungen, Umsatz im Monat, Belege zu prüfen, Bankumsätze ohne Zuordnung, ausstehende AfA, Einspruchsfristen, ELSTER-Zertifikat, nächste Fristen |
| `fristen` | offene Steuerfristen, auf Wunsch auch Erledigtes der letzten 60 Tage |
| `offene_posten` | offene Forderungen und Verbindlichkeiten mit Summen und Tagen über Fälligkeit |
| `ueberfaellige_rechnungen` | überfällige Rechnungen mit letzter Mahnstufe |
| `rechnungen` | Ausgangsrechnungen, filterbar nach Status, Jahr und Kunde oder Rechnungsnummer |
| `belege` | Belege zu prüfen, gebucht oder alle |
| `bankumsaetze_ohne_zuordnung` | Bankumsätze ohne Zuordnung je Konto |
| `umsatzsteuer_voranmeldung` | Kennzahlen eines Monats oder Quartals aus den Buchungen, gespeicherter Stand, Vorprüfung und Abgleich mit dem Journal |
| `ustva_ausfuellliste` | Werte der Voranmeldung zum Eintragen in Mein ELSTER, in der Reihenfolge des Formulars, siehe [Mein ELSTER mit KI-Assistent](elster-mit-assistent.md) |
| `euer` | Einnahmen-Überschuss-Rechnung eines Jahres mit Monatswerten |
| `jahreserklaerung` | Stand von Umsatzsteuererklärung, Anlage EÜR und Einkommensteuer mit Hinweisen und Steuerprognose |
| `vorausgefuellte_belege` | abgerufene Belege der vorausgefüllten Steuererklärung (VaSt) ohne persönliche Stammdaten |
| `archiv_auftragsdokumente` | aus sevDesk archivierte Angebote, Auftragsbestätigungen und Lieferscheine eines Jahres, filterbar nach Art und Nummer oder Kontakt, siehe [Umzug aus sevDesk](sevdesk.md#angebote-auftragsbestätigungen-und-lieferscheine) |
| `archiv_auftragsdokument` | ein archiviertes Auftragsdokument mit Positionen und Dateien |
| `lexoffice_abgleich` | Umzug aus Lexware Office: Verbindung, letzter Abruf mit fehlgeschlagenen Belegen, je Jahr die Prüfungen, Summen, Steuerarten und die nachgerechnete Umsatzsteuer je Monat |
| `lexoffice_belege` | abgerufene Lexoffice-Belege eines Jahres oder Monats mit Beträgen je Steuersatz, Steuerart und Zahlungen |
| `lexoffice_beleg` | ein Lexoffice-Beleg mit allen Feldern, Dateien und der gespeicherten Antwort der API (ohne Steuernummern) |
| `lexoffice_konten` | Soll, Haben und Saldo je Konto aus dem archivierten DATEV-Buchungsstapel für ein Jahr oder einen Monat, mit Summen der Erträge und Aufwendungen |
| `lexoffice_buchungen` | einzelne DATEV-Buchungen eines Jahres oder Monats, filterbar nach Konto oder nach Buchungen ohne passenden Beleg |

### Voranmeldungen aus Lexware Office vergleichen

Die `lexoffice_`-Werkzeuge helfen beim [Umzug aus Lexoffice](lexoffice.md). Was der Assistent damit prüfen kann:

- **Vollständigkeit:** `lexoffice_abgleich` zeigt je Jahr, welche Prüfungen offen sind (fehlender DATEV-Stapel, ELSTER-Protokolle, Kontoauszüge, Belege ohne Datei), welche Dateien abgelegt sind und welche Belege der Abruf nicht lesen konnte.
- **Voranmeldungen:** Gib dem Assistenten die Zahlen einer in Lexware Office abgegebenen Voranmeldung (aus dem ELSTER-Protokoll) und frag etwa „Vergleich die Voranmeldung März 2025 aus Lexoffice mit dem Altbestand in Haben: Kz 81 12.345, Kz 66 1.234“. Er nimmt die nachgerechneten Monatswerte aus `lexoffice_abgleich` und geht bei einer Abweichung mit `lexoffice_belege` und `lexoffice_beleg` bis auf den einzelnen Beleg zurück. Buchungen ohne Beleg stehen dort mit der Notiz „Buchung ohne Beleg“; Was weder Einnahme noch Ausgabe ist (im Einzelunternehmen Privatentnahmen, -einlagen und Geldtransit ohne Beleg, bei GmbH und UG Gesellschafter, Stammkapital, Darlehen sowie Körperschaft- und Gewerbesteuer, siehe [Einordnung](lexoffice.md#einordnung-bei-gmbh-und-ug)), lässt `lexoffice_belege` weg, wie die Monatswerte, und nennt es summiert unter `nichtEinnahmeOderAusgabe`; `lexoffice_abgleich` ebenso je Jahr.
- **Konten und EÜR:** Die Lexware-API liefert keine Buchungen. Die stehen im DATEV-Buchungsstapel, den du im Archiv ablegst. `lexoffice_konten` rechnet daraus Salden je Konto und Monat oder Jahr, `lexoffice_buchungen` zeigt die einzelnen Buchungen eines Kontos. Leg Saldenliste oder EÜR aus Lexware Office daneben (Zahlen ins Gespräch kopieren), dann vergleicht der Assistent Konto für Konto.

Den Abruf selbst und das Hochladen der Exporte machst du in Haben. PDFs im Archiv kann der Assistent nicht lesen.

Beträge kommen in Euro, Datumsangaben als JJJJ-MM-TT. Die Listen sind auf 50 Einträge begrenzt (bis 200 auf Wunsch).

## Protokoll und Grenzen

Unter **Letzte Aufrufe** steht, welcher Assistent wann welches Werkzeug benutzt hat und ob es geklappt hat, ohne Eingaben und Ergebnisse. Haben hebt das 90 Tage auf. Je Token sind 120 Anfragen pro Minute erlaubt, zusammen mit Aufrufen der REST-API; schickt ein Client mehrere Nachrichten in einer Anfrage (Batch), zählt jede einzeln.

Im Änderungsprotokoll stehen das Ein- und Ausschalten des Zugangs und wer ein Token angelegt, übernommen, widerrufen oder deaktiviert hat. Das Token selbst und sein Hash sind Zugangsdaten wie die Passkeys und stehen nicht darin.

Im SSO-Modus hat jedes Token einen verantwortlichen Inhaber; verliert er die Inhaberrolle, deaktiviert Haben seine Tokens, siehe [Tokens nach Gruppenentzug](installation.md#tokens-nach-gruppenentzug).
