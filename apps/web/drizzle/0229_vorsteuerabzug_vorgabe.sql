ALTER TABLE "company" ADD COLUMN "ohne_vorsteuerabzug" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "vorsteuer_anteil" smallint;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_vorsteuer_anteil_range" CHECK ("documents"."vorsteuer_anteil" between 0 and 10000);