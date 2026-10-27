# KI-Assistenten (MCP)

Haben lässt sich im Gespräch mit einem KI-Assistenten abfragen, etwa mit Claude Code, Claude Desktop oder einem lokalen Modell: „Welche Rechnungen sind überfällig?“, „Wie viel Umsatzsteuer zahle ich im Oktober?“, „Was fehlt noch für die Jahreserklärung 2025?“. Der Assistent arbeitet dabei über Werkzeuge, die Haben nach dem [Model Context Protocol (MCP)](https://modelcontextprotocol.io) anbietet.

Der Zugang kann **nur lesen**. Buchen, Festschreiben, Stornieren, Mails versenden und alles, was an ELSTER geht, machst du weiter selbst in Haben. Die Antworten der Werkzeuge enthalten dafür Links auf die passende Seite.

## Datenschutz

Was der Assistent über die Werkzeuge liest, geht an den Anbieter des Modells. Bei Claude sind das die Server von Anthropic, **auch wenn Haben nur im Heimnetz läuft und der Client auf deinem Rechner**: Lokal heißt nur, dass Haben selbst nicht aus dem Internet erreichbar sein muss. Ganz lokal bleibt es nur mit einem lokalen Modell (etwa LM Studio oder Open WebUI mit Ollama).

- Der Zugang ist standardmäßig aus und wird ausdrücklich eingeschaltet.
- Kein Werkzeug gibt ELSTER-Zertifikat, PIN, Passwörter, API-Schlüssel oder die Steuer-ID heraus.
- Texte aus Belegen, Bankumsätzen und Bescheiden stammen von Dritten. Haben sagt dem Assistenten, dass das Daten sind und keine Anweisungen; weil der Zugang nichts ändern kann, bleibt der mögliche Schaden auf das Lesen begrenzt.

## Einrichten

1. **Einstellungen → KI-Assistenten** öffnen und **Zugang für KI-Assistenten einschalten**.
2. Unter **API-Tokens** einen Namen vergeben (z. B. „Claude Code am Laptop“), die Gültigkeit wählen (30 Tage, 90 Tage oder ein Jahr) und **Token anlegen**.
3. Das Token sofort kopieren: Haben speichert nur seinen SHA-256-Hash und zeigt es nie wieder an.

Jeder Assistent sollte sein eigenes Token bekommen. **Widerrufen** sperrt ein Token sofort; abgelaufene und widerrufene bleiben zur Nachvollziehbarkeit in der Liste. Wer den Zugang wieder ausschaltet, sperrt alle Tokens auf einmal.

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

Ein Connector aus den Einstellungen von claude.ai (auch für die Handy-App und claude.ai im Browser) geht noch nicht: Dort ruft Anthropic Haben aus dem Internet auf und erwartet OAuth. Das ist der nächste Schritt ([#96](https://github.com/firsttris/haben/issues/96)).

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
| `rechnungen` | Ausgangsrechnungen, filterbar nach Status, Jahr und Kunde |
| `belege` | Belege zu prüfen, gebucht oder alle |
| `bankumsaetze_ohne_zuordnung` | Bankumsätze ohne Zuordnung je Konto |
| `umsatzsteuer_voranmeldung` | Kennzahlen eines Monats aus den Buchungen, gespeicherter Stand, Vorprüfung und Abgleich mit dem Journal |
| `ustva_ausfuellliste` | Werte der Voranmeldung zum Eintragen in Mein ELSTER, in der Reihenfolge des Formulars, siehe [Mein ELSTER mit KI-Assistent](elster-mit-assistent.md) |
| `euer` | Einnahmen-Überschuss-Rechnung eines Jahres mit Monatswerten |
| `jahreserklaerung` | Stand von Umsatzsteuererklärung, Anlage EÜR und Einkommensteuer mit Hinweisen und Steuerprognose |
| `vorausgefuellte_belege` | abgerufene Belege der vorausgefüllten Steuererklärung (VaSt) ohne persönliche Stammdaten |
| `lexoffice_abgleich` | Umzug aus Lexware Office: Verbindung, letzter Abruf mit fehlgeschlagenen Belegen, je Jahr die Prüfungen, Summen, Steuerarten und die nachgerechnete Umsatzsteuer je Monat |
| `lexoffice_belege` | abgerufene Lexoffice-Belege eines Jahres oder Monats mit Beträgen je Steuersatz, Steuerart und Zahlungen |
| `lexoffice_beleg` | ein Lexoffice-Beleg mit allen Feldern, Dateien und der gespeicherten Antwort der API (ohne Steuernummern) |
| `lexoffice_konten` | Soll, Haben und Saldo je Konto aus dem archivierten DATEV-Buchungsstapel für ein Jahr oder einen Monat, mit Summen der Erträge und Aufwendungen |
| `lexoffice_buchungen` | einzelne DATEV-Buchungen eines Jahres oder Monats, filterbar nach Konto oder nach Buchungen ohne passenden Beleg |

### Voranmeldungen aus Lexware Office vergleichen

Die `lexoffice_`-Werkzeuge helfen beim [Umzug aus Lexoffice](lexoffice.md). Was der Assistent damit prüfen kann:

- **Vollständigkeit:** `lexoffice_abgleich` zeigt je Jahr, welche Prüfungen offen sind (fehlender DATEV-Stapel, ELSTER-Protokolle, Kontoauszüge, Belege ohne Datei), welche Dateien abgelegt sind und welche Belege der Abruf nicht lesen konnte.
- **Voranmeldungen:** Gib dem Assistenten die Zahlen einer in Lexware Office abgegebenen Voranmeldung (aus dem ELSTER-Protokoll) und frag etwa „Vergleich die Voranmeldung März 2025 aus Lexoffice mit dem Altbestand in Haben: Kz 81 12.345, Kz 66 1.234“. Er nimmt die nachgerechneten Monatswerte aus `lexoffice_abgleich` und geht bei einer Abweichung mit `lexoffice_belege` und `lexoffice_beleg` bis auf den einzelnen Beleg zurück.
- **Konten und EÜR:** Die Lexware-API liefert keine Buchungen. Die stehen im DATEV-Buchungsstapel, den du im Archiv ablegst. `lexoffice_konten` rechnet daraus Salden je Konto und Monat oder Jahr, `lexoffice_buchungen` zeigt die einzelnen Buchungen eines Kontos. Leg Saldenliste oder EÜR aus Lexware Office daneben (Zahlen ins Gespräch kopieren), dann vergleicht der Assistent Konto für Konto.

Den Abruf selbst und das Hochladen der Exporte machst du in Haben. PDFs im Archiv kann der Assistent nicht lesen.

Beträge kommen in Euro, Datumsangaben als JJJJ-MM-TT. Die Listen sind auf 50 Einträge begrenzt (bis 200 auf Wunsch), damit der Assistent nicht mit Tausenden Zeilen arbeiten muss.

## Protokoll und Grenzen

Unter **Letzte Aufrufe** steht, welcher Assistent wann welches Werkzeug benutzt hat und ob es geklappt hat, ohne Eingaben und Ergebnisse. Haben hebt das 90 Tage auf. Je Token sind 120 Anfragen pro Minute erlaubt; schickt ein Client mehrere Nachrichten in einer Anfrage (Batch), zählt jede einzeln.

Das Ein- und Ausschalten des Zugangs steht im Änderungsprotokoll. Die Tokens selbst sind Zugangsdaten wie die Passkeys und stehen nicht darin.
