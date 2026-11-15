CREATE TABLE "sevdesk_tax_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sevdesk_tax_sets_import_id_unique" UNIQUE("import_id")
);
--> statement-breakpoint
ALTER TABLE "sevdesk_tax_sets" ADD CONSTRAINT "sevdesk_tax_sets_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;