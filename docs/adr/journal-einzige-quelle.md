---
title: "Entscheidung: nur noch das Journal"
description: >-
  Entscheidung zu #1116: Voranmeldung und EÜR rechnen für alle Jahre aus dem Journal, ohne Stichjahr; der Abgleich prüft
  gespeicherte Daten gegen das Journal, eine Prüfung beim Update sichert die Jahre davor.
---

# Entscheidung: nur noch das Journal

**Status:** umgesetzt mit [#1116](https://github.com/firsttris/haben/issues/1116).
**Bezug:** [Entscheidung: Voranmeldung und EÜR aus dem Journal](journal-als-quelle.md) (#542, überholt in Stichjahr und
Gegenprobe), [Architektur: Entwurfsentscheidungen](../architektur.md#entwurfsentscheidungen),
[Abgleich im Journal](../buchhaltung.md#abgleich-im-journal), [Update auf das Journal](../einrichtung.md#update-auf-das-journal).

**Anlass:** Mit zwei Rechenwegen musste jede neue Funktion an Steuer und EÜR in beiden stimmen, sonst schlug der Abgleich an; das kostete jede Änderung doppelt. Das Stichjahr betraf wenig: Das erste Release war v0.1.1 am 5.10.2026, das Stichjahr kam mit v0.7.0 am 11.11.2026 (Migration `0192`, Stichjahr 2027 für Instanzen mit Buchungen). Jahre vor dem Stichjahr gibt es also nur bei Instanzen, die vor v0.7.0 gebucht haben: 2026 und Jahre, die der Datenimport ins Journal übernommen hat (`datenimport/external-import.ts`).

**Entscheidung:**

- Voranmeldung und EÜR rechnen für alle Jahre aus dem Journal. Stichjahr, Weiche und die Karte in den Einstellungen sind entfernt; das frühere Stichjahr steht in `journal_umstellung`. Die Spalte `company.journal_ab` liest Haben nicht mehr; sie bleibt, damit die bisherige Version auf derselben Datenbank weiterläuft, und fällt mit `modules/umstellung` weg. Die Listen in der Voranmeldung (Rechnungen, Belege, Zahlungen je Kennzahl) und die Zusammenfassende Meldung kommen weiter aus den Nebenbüchern; sie sind Erläuterung bzw. Daten, kein zweiter Rechenweg. Die Entscheidungen 2 bis 4 aus [Voranmeldung und EÜR aus dem Journal](journal-als-quelle.md#entscheidungen) gelten weiter, ohne Stichjahr.
- **GmbH und UG:** Ihre Übersicht nach Zahlung kommt ebenfalls aus dem Journal, ohne manuelle Buchungen (dort Abschlussbuchungen wie Rückstellungen, keine Zahlung).
- **Freie Buchungen** gibt es im Einzelunternehmen und mit Steuerschlüssel ohne Einschränkung auf ein Jahr, weiter nur außerhalb gemeldeter Zeiträume.
- **Storno von Beleg und Bareinnahme** bucht immer die Zeilen von heute, wenn sie auf jedem Konto denselben Saldo ergeben (`zeilenWieHeute`), sonst die gebuchten; so trägt auch der Storno einer alten Buchung Steuerschlüssel und Bemessungsgrundlage.
- **Prüfung beim Update** (`modules/umstellung`, nach den Migrationen in `deploy/entrypoint.sh`): Für jedes Jahr vor dem früheren Stichjahr mit Buchungen müssen gesendete Voranmeldungen mit ihren gespeicherten Werten (bei von Hand überschriebenen mit den beim Speichern berechneten), die übrigen Monate und im Einzelunternehmen die EÜR aus dem Journal so herauskommen wie aus den Nebenbüchern. Anders als beim früheren Vorziehen sperrt eine gesendete Voranmeldung nicht. Weil sie erst nach den Migrationen laufen kann, ändern die Migrationen nichts, was die bisherige Version liest. Weicht etwas ab, startet die neue Version nicht, nennt Jahr und Abweichung und ändert nichts. Mit `HABEN_ABWEICHUNG_UEBERNEHMEN` übernimmt der Betreiber die Abweichung ausdrücklich: Gesendete Voranmeldungen bleiben, wie sie gesendet sind, alles Offene rechnet aus dem Journal, und der Abgleich prüft Verprobung und gesendete Voranmeldungen dieses Jahres nicht. Wer nicht übernimmt, bleibt auf der letzten Version davor; eine Berichtigung eines abweichenden Jahres geht dann nur dort. Dafür braucht die Prüfung die alte Rechnung aus den Nebenbüchern: Sie liegt eingefroren in `modules/umstellung` und fällt mit dem Modul weg, sobald ein Release das Update über diese Version voraussetzt.
- **Ersatz für die Gegenprobe** (Vorschlag aus #1116): kein verkleinerter Abgleich gegen die Nebenbücher, sondern gespeicherte Daten gegen das Journal: Umsatzsteuer-Verprobung je Buchung (Steuer gegen Bemessungsgrundlage mal Satz, ein Cent Toleranz je Satz der Buchung, `ust-verprobung.ts`), gesendete Voranmeldungen gegen die Rechnung aus dem Journal, Steuerzeilen festgeschriebener Rechnungen und die Vorsteuer gebuchter Belege gegen ihre Buchung, Bankkonten gegen den Endsaldo des letzten Kontoauszugs; OPOS-Abgleich, AfA gegen Anlagenverzeichnis und Gewinn nach der DATEV-Formel bleiben. Alles läuft in der Integritätsprüfung und der wöchentlichen Mail, die Verprobung auch in der Vorprüfung der Voranmeldung.
- **Offen:** Referenzfälle mit Kennzahlen aus einer unabhängigen Quelle (Beispiele aus DATEV oder der Steuerberatung), je SKR03 und SKR04, Ist und Soll.
