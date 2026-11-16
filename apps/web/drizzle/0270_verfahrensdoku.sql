CREATE TABLE "procedure_details" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"verantwortlich" text DEFAULT '' NOT NULL,
	"datensicherung" text DEFAULT '' NOT NULL,
	"aufbewahrungsort" text DEFAULT '' NOT NULL,
	"papierbelege" text DEFAULT '' NOT NULL,
	"serverbetrieb" text DEFAULT '' NOT NULL,
	"schluesselablage" text DEFAULT '' NOT NULL,
	"ergaenzungen" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_details_single_row" CHECK ("procedure_details"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "backup_status" ADD COLUMN "target" text;