ALTER TYPE "public"."allocation_kind" ADD VALUE 'kapest';--> statement-breakpoint
CREATE TABLE "dividends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"beschluss_date" date NOT NULL,
	"auszahlungstag" date,
	"zufluss" date NOT NULL,
	"brutto" integer NOT NULL,
	"empfaenger" jsonb NOT NULL,
	"entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dividends_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "kapest_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dividend_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"protocol_pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kapest_submissions" ADD CONSTRAINT "kapest_submissions_dividend_id_dividends_id_fk" FOREIGN KEY ("dividend_id") REFERENCES "public"."dividends"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kapest_submissions_dividend" ON "kapest_submissions" USING btree ("dividend_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kapest_submissions_sent" ON "kapest_submissions" USING btree ("dividend_id") WHERE "kapest_submissions"."kind" = 'send' and "kapest_submissions"."ok";