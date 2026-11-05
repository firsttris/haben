CREATE TABLE "sv_portal_filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gegenstand" text NOT NULL,
	"art" text NOT NULL,
	"titel" text NOT NULL,
	"employee_id" uuid,
	"datum" date NOT NULL,
	"werte" jsonb NOT NULL,
	"notiz" text DEFAULT '' NOT NULL,
	"protokoll_sha256" text,
	"protokoll_dateiname" text,
	"protokoll_mime_type" text,
	"protokoll_groesse" integer,
	"revokes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sv_portal_filings_protokoll" CHECK (("sv_portal_filings"."protokoll_sha256" is null) = ("sv_portal_filings"."protokoll_dateiname" is null) and ("sv_portal_filings"."protokoll_sha256" is null) = ("sv_portal_filings"."protokoll_groesse" is null) and ("sv_portal_filings"."protokoll_sha256" is null) = ("sv_portal_filings"."protokoll_mime_type" is null))
);
--> statement-breakpoint
ALTER TABLE "sv_portal_filings" ADD CONSTRAINT "sv_portal_filings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sv_portal_filings" ADD CONSTRAINT "sv_portal_filings_revokes_id_sv_portal_filings_id_fk" FOREIGN KEY ("revokes_id") REFERENCES "public"."sv_portal_filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sv_portal_filings_gegenstand" ON "sv_portal_filings" USING btree ("gegenstand");--> statement-breakpoint
CREATE UNIQUE INDEX "sv_portal_filings_revokes" ON "sv_portal_filings" USING btree ("revokes_id");