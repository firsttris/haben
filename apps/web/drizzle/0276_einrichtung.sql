CREATE TABLE "einrichtung" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"ausgeblendete_bereiche" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fragen_at" timestamp with time zone,
	"offen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einrichtung_single_row" CHECK ("einrichtung"."id" = 1)
);
