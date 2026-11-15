CREATE TABLE "legacy_vat_report_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vat_report_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_vat_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"source" text DEFAULT 'sevdesk' NOT NULL,
	"import_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint,
	"period_text" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"actual_taxation" boolean,
	"corrected" boolean NOT NULL,
	"transfer_ticket" text,
	"kz83" integer,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_vat_reports_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "legacy_vat_report_files" ADD CONSTRAINT "legacy_vat_report_files_vat_report_id_legacy_vat_reports_id_fk" FOREIGN KEY ("vat_report_id") REFERENCES "public"."legacy_vat_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_vat_reports" ADD CONSTRAINT "legacy_vat_reports_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_vat_report_files_unique" ON "legacy_vat_report_files" USING btree ("vat_report_id","sha256");--> statement-breakpoint
CREATE INDEX "legacy_vat_reports_period" ON "legacy_vat_reports" USING btree ("year","month");