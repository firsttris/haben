CREATE TABLE "lstb_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"art" text NOT NULL,
	"kind" text NOT NULL,
	"km_id" text,
	"ref_km_id" text,
	"werte" jsonb,
	"angaben" jsonb NOT NULL,
	"datum" date NOT NULL,
	"grund" text DEFAULT '' NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"protocol_pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lstb_submissions_ref" CHECK ("lstb_submissions"."art" = 'neu' or "lstb_submissions"."kind" = 'portal' or "lstb_submissions"."ref_km_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "lstb_submissions" ADD CONSTRAINT "lstb_submissions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lstb_submissions_employee_year" ON "lstb_submissions" USING btree ("employee_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "lstb_submissions_km_id" ON "lstb_submissions" USING btree ("km_id") WHERE "lstb_submissions"."kind" = 'send' and "lstb_submissions"."ok";