CREATE TABLE "legacy_dunning_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dunning_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_dunnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"source" text DEFAULT 'sevdesk' NOT NULL,
	"import_id" uuid NOT NULL,
	"invoice_external_id" text,
	"level" smallint,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"sent_date" date,
	"status" text NOT NULL,
	"contact_id" uuid,
	"contact_name" text NOT NULL,
	"currency" text NOT NULL,
	"total" integer,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_dunnings_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "legacy_dunning_files" ADD CONSTRAINT "legacy_dunning_files_dunning_id_legacy_dunnings_id_fk" FOREIGN KEY ("dunning_id") REFERENCES "public"."legacy_dunnings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_dunnings" ADD CONSTRAINT "legacy_dunnings_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_dunnings" ADD CONSTRAINT "legacy_dunnings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_dunning_files_unique" ON "legacy_dunning_files" USING btree ("dunning_id","sha256");--> statement-breakpoint
CREATE INDEX "legacy_dunnings_invoice" ON "legacy_dunnings" USING btree ("invoice_external_id");