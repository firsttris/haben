CREATE TABLE "zm_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"berichtigt" boolean DEFAULT false NOT NULL,
	"zeilen" jsonb NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"protocol_pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zm_submissions_month" CHECK (("zm_submissions"."month" between 1 and 12) or ("zm_submissions"."month" between 41 and 44))
);
--> statement-breakpoint
CREATE INDEX "zm_submissions_period" ON "zm_submissions" USING btree ("year","month");