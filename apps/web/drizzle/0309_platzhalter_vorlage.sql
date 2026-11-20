ALTER TABLE "invoices" ADD COLUMN "intro_vorlage" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "note_vorlage" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "intro_vorlage" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "note_vorlage" text DEFAULT '' NOT NULL;