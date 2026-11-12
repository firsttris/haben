---
title: "Eigene Seiten: Werkzeuge ins Menü einbinden"
description: >-
  Eigene Werkzeuge wie n8n-Formulare, Bestellübersichten oder Lagerlisten als Seite ins Menü von
  Haben einbinden.
---

# Eigene Seiten

Eine eigene Seite hängt ein eigenes Werkzeug ins Menü von Haben, etwa eine Bestellübersicht, ein Formular oder eine Lagerliste aus [n8n](https://n8n.io). Haben zeigt die Seite in einem Rahmen neben dem Menü oder öffnet sie in einem neuen Tab. So arbeitest du in einer Oberfläche, und Haben bleibt die Buchhaltung: Bestellungen, Versand oder Lager gehören nicht in den Kern, aber du kannst sie dir selbst danebenstellen.

Haben speichert nur Name, Adresse und wie sich die Seite öffnet. Was die Seite zeigt und tut, liegt bei dir.

## Einrichten

1. **Einstellungen → Eigene Seiten** öffnen.
2. Einen **Namen im Menü** vergeben (z. B. „Bestellungen“, höchstens 40 Zeichen) und die **Adresse** der Seite eintragen, mit `https://` oder `http://`. Benutzername und Passwort in der Adresse (`https://nutzer:passwort@…`) lehnt Haben ab, weil sie sonst im Menü und im Änderungsprotokoll stünden.
3. Unter **Öffnen** wählen, wie der Menüeintrag die Seite zeigt:
   - **In Haben, neben dem Menü**: im Rahmen, ohne Haben zu verlassen. Die Seite muss das Einbetten erlauben (siehe unten).
   - **In neuem Tab**: als eigener Tab des Browsers, ohne Rahmen. Das geht mit jeder Seite, auch mit solchen, die das Einbetten verbieten, etwa [Paperless-ngx](https://docs.paperless-ngx.com).
4. **Seite hinzufügen.** Die Seite steht jetzt im Menü unter **Eigene Seiten**. Das Symbol davor zeigt, wie sie sich öffnet: ein Fenster mit Seitenleiste für **In Haben**, ein Pfeil aus dem Kasten für **In neuem Tab**.

Ist **In Haben** gewählt, ruft Haben die Adresse nach der Eingabe einmal auf und prüft, ob die Seite das Einbetten verbietet. Dann erscheint ein Hinweis mit dem Header, der es verbietet, und dem Rat, **In neuem Tab** zu wählen. Der Hinweis hält nichts auf: Haben sieht die Seite vom Server aus, nicht aus deinem Browser. Erreicht der Server sie nicht, etwa weil sie nur in deinem Netz läuft oder ein Proxy davor erst die Anmeldung zeigt, sagt Haben das, und du siehst nach dem Speichern im Menü, ob sie erscheint.

**Bearbeiten** ändert Name, Adresse oder wie sich die Seite öffnet, **Entfernen** nimmt die Seite aus dem Menü. Die Seite selbst bleibt dabei, wo sie ist. Jede Änderung steht im Änderungsprotokoll.

Über **In neuem Tab öffnen** oben rechts öffnest du eine eingebettete Seite ohne Rahmen, etwa wenn sie mehr Platz braucht.

## Was die Seite können muss

- **Eine eigene Adresse.** Die Seite muss unter einer anderen Herkunft laufen als Haben, also auf einer anderen Subdomain (`n8n.example.de` neben `haben.example.de`) oder einem anderen Port (`http://192.168.1.20:5678`). Die Adresse von Haben selbst lehnt Haben ab: Eine Seite derselben Herkunft hätte im Rahmen die volle Sitzung und könnte Rechnungen festschreiben oder an ELSTER senden.
- **Einbetten erlauben** (nur für **In Haben**). Viele Seiten verbieten, dass eine andere Seite sie im Rahmen zeigt (`X-Frame-Options: DENY` oder `SAMEORIGIN`, oder `Content-Security-Policy: frame-ancestors` ohne die Adresse von Haben). Dann bleibt der Rahmen leer oder der Browser meldet, dass die Verbindung abgelehnt wurde. Abhilfe: die Seite mit diesem Header ausliefern, mit der Adresse deiner Haben-Instanz:

  ```
  Content-Security-Policy: frame-ancestors https://haben.example.de
  ```

  Liefert ein Workflow in n8n die Seite über den Knoten **Respond to Webhook**, setzt du den Header dort unter den Response-Headers. Lässt sich die Seite nicht ändern, wähle **In neuem Tab**.
- **Gleiches Protokoll** (nur für **In Haben**). Läuft Haben unter `https://`, zeigt der Browser im Rahmen keine Seite mit `http://` an (gemischte Inhalte). Läuft Haben im Heimnetz unter `http://`, geht beides.

## Anmeldung und Zugriff auf Haben

Haben gibt der Seite nichts mit: keine Sitzung, kein Token, nicht einmal die eigene Adresse (der Rahmen schickt keinen Referrer). Die Seite kümmert sich selbst um ihre Anmeldung, etwa mit der Anmeldung von n8n oder einem Reverse-Proxy davor.

Braucht die Seite Daten aus Haben, nutzt sie die [REST-API](api.md) mit einem eigenen API-Token. Das Token gehört auf den Server, also in den Workflow in n8n, nicht in das JavaScript der Seite: Was im Browser steht, kann jeder lesen, der die Seite öffnet. Für eine Bestellübersicht, die Rechnungen anlegt, reichen meist die Rechte „Kontakte lesen, anlegen und ändern“ und „Rechnungen lesen, Entwürfe anlegen, ändern und löschen“. Wie bei der API sonst bucht dabei nichts und nichts wird festgeschrieben: Die Rechnung schreibst du in Haben fest.

## Was die Seite im Rahmen darf

Der Rahmen ist eingeschränkt (`sandbox`). Erlaubt ist, was solche Werkzeuge brauchen:

| Erlaubt | Wofür |
| --- | --- |
| Skripte, Formulare, eigene Herkunft | Die Seite funktioniert wie im eigenen Tab, mit ihrer eigenen Anmeldung |
| Neue Fenster und Downloads | Etwa ein Versandetikett als PDF |
| Dialoge | `alert`, `confirm` und Drucken (`print()`), etwa für den Etikettendrucker |

Nicht erlaubt ist, das Fenster von Haben wegzunavigieren oder auf Haben zuzugreifen. Eine Seite, die mehr braucht, öffnest du mit **In neuem Tab öffnen** oder stellst sie auf **In neuem Tab**. Auch im neuen Tab bekommt sie keine Adresse von Haben mit (`noreferrer`).

## Beispiel: Bestellungen aus n8n

1. In n8n einen Workflow mit einem **Webhook** (GET) anlegen, der die offenen Bestellungen liest und als HTML-Seite mit **Respond to Webhook** zurückgibt, mit dem Header `Content-Security-Policy: frame-ancestors https://haben.example.de`.
2. Knöpfe auf der Seite („Briefmarke drucken“, „Als versendet markieren“) schicken ein Formular an weitere Webhooks desselben Workflows.
3. Für die Rechnung zu einer Bestellung ruft der Workflow `POST /api/v1/rechnungen` mit der Bestellnummer als externer Referenz auf ([Ablauf für Bestellungen](api.md#ablauf-für-bestellungen)).
4. In Haben unter **Einstellungen → Eigene Seiten** die Adresse des Webhooks eintragen, etwa `https://n8n.example.de/webhook/bestellungen`.

[Zurück zur Übersicht](ueberblick.md)
