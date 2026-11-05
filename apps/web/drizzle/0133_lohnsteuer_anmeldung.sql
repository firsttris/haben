CREATE TABLE "lsta_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"zeitraum" smallint NOT NULL,
	"berichtigt" boolean DEFAULT false NOT NULL,
	"kennzahlen" jsonb NOT NULL,
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
	CONSTRAINT "lsta_submissions_zeitraum" CHECK (("lsta_submissions"."zeitraum" between 1 and 12) or ("lsta_submissions"."zeitraum" between 41 and 44) or "lsta_submissions"."zeitraum" = 19)
);
--> statement-breakpoint
CREATE TABLE "lsta_turnus" (
	"year" smallint PRIMARY KEY NOT NULL,
	"turnus" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lsta_submissions_period" ON "lsta_submissions" USING btree ("year","zeitraum");