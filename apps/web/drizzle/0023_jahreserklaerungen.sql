CREATE TABLE "annual_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form" text NOT NULL,
	"year" smallint NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"figures" jsonb NOT NULL,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"protocol_pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "einkunftsart" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "taetigkeit" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "annual_submissions_form_year" ON "annual_submissions" USING btree ("form","year");--> statement-breakpoint
CREATE UNIQUE INDEX "annual_submissions_sent" ON "annual_submissions" USING btree ("form","year") WHERE "annual_submissions"."kind" = 'send' and "annual_submissions"."ok";