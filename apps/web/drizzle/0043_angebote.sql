CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"tax_rate" smallint NOT NULL,
	"net" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_number_counters" (
	"year" smallint PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"number_year" smallint,
	"number_counter" integer,
	"contact_id" uuid,
	"contact_version" integer,
	"issue_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"service_from" date,
	"service_to" date,
	"note" text DEFAULT '' NOT NULL,
	"tax_treatment" text DEFAULT 'regulaer' NOT NULL,
	"exemption_reason" text DEFAULT '' NOT NULL,
	"net" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"seller" jsonb,
	"buyer" jsonb,
	"pdf" "bytea",
	"pdf_sha256" text,
	"decision" text,
	"decided_at" timestamp with time zone,
	"invoice_id" uuid,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_number_unique" UNIQUE("number"),
	CONSTRAINT "quotes_final_has_number" CHECK ("quotes"."status" = 'draft' or ("quotes"."number" is not null and "quotes"."locked_at" is not null)),
	CONSTRAINT "quotes_decision_final" CHECK ("quotes"."decision" is null or "quotes"."status" = 'final')
);
--> statement-breakpoint
ALTER TABLE "mail_log" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_counter" ON "quotes" USING btree ("number_year","number_counter");--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;