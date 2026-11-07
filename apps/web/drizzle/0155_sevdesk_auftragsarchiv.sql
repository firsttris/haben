CREATE TABLE "legacy_order_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"import_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"contact_id" uuid,
	"contact_name" text NOT NULL,
	"currency" text NOT NULL,
	"net" integer,
	"tax" integer,
	"gross" integer,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_order_documents_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_order_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_order_documents" ADD CONSTRAINT "legacy_order_documents_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_order_documents" ADD CONSTRAINT "legacy_order_documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_order_files" ADD CONSTRAINT "legacy_order_files_order_id_legacy_order_documents_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."legacy_order_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_order_documents_date" ON "legacy_order_documents" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_order_files_unique" ON "legacy_order_files" USING btree ("order_id","sha256");