ALTER TABLE "company" ADD COLUMN "ausgeblendete_bereiche" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "einrichtung_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "einrichtung_offen" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- #266: Bestehende Instanzen sind schon eingerichtet; die Startseite fragt sie nicht noch einmal, alle Bereiche bleiben sichtbar
UPDATE "company" SET "einrichtung_at" = now();
