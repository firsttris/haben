ALTER TABLE "company" ADD COLUMN "journal_ab" integer;--> statement-breakpoint
-- #542: Bestehende Instanzen mit Buchungen rechnen Voranmeldung und EÜR ab dem nächsten Kalenderjahr aus dem Journal; ihre
-- älteren Buchungen tragen teils noch keine Bemessungsgrundlage bzw. keinen Steuerschlüssel (docs/adr/journal-als-quelle.md)
UPDATE "company" SET "journal_ab" = extract(year from now() at time zone 'Europe/Berlin')::int + 1 WHERE EXISTS (SELECT 1 FROM "journal_entries");
