CREATE TABLE "sevdesk_accounting_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"accounting_type_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sevdesk_accounting_types" ADD CONSTRAINT "sevdesk_accounting_types_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sevdesk_accounting_types_stand" ON "sevdesk_accounting_types" USING btree ("accounting_type_id",md5("raw"::text));