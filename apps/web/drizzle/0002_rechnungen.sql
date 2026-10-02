CREATE TYPE "public"."invoice_format" AS ENUM('zugferd', 'xrechnung-cii', 'xrechnung-ubl');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('rechnung', 'storno', 'korrektur');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."kontenrahmen" AS ENUM('SKR03', 'SKR04');--> statement-breakpoint
CREATE TABLE "contact_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kundennummer" text,
	"name" text NOT NULL,
	"strasse" text DEFAULT '' NOT NULL,
	"plz" text DEFAULT '' NOT NULL,
	"ort" text DEFAULT '' NOT NULL,
	"land" text DEFAULT 'DE' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"ust_id" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"leitweg_id" text DEFAULT '' NOT NULL,
	"default_format" "invoice_format",
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"tax_rate" smallint NOT NULL,
	"net" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_number_counters" (
	"year" smallint PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "invoice_kind" DEFAULT 'rechnung' NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"number_year" smallint,
	"number_counter" integer,
	"contact_id" uuid,
	"contact_version" integer,
	"issue_date" date NOT NULL,
	"service_from" date,
	"service_to" date,
	"payment_term_days" smallint DEFAULT 14 NOT NULL,
	"due_date" date NOT NULL,
	"format" "invoice_format" DEFAULT 'zugferd' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"corrects_id" uuid,
	"net" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"seller" jsonb,
	"buyer" jsonb,
	"pdf" "bytea",
	"pdf_sha256" text,
	"xml" text,
	"xml_sha256" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_final_has_number" CHECK ("invoices"."status" = 'draft' or ("invoices"."number" is not null and "invoices"."locked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"kontenrahmen" "kontenrahmen" NOT NULL,
	"reverses_id" uuid,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account" text NOT NULL,
	"debit" integer DEFAULT 0 NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"tax_code" text,
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit" >= 0 and "journal_lines"."credit" >= 0) and ("journal_lines"."debit" = 0 or "journal_lines"."credit" = 0))
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "telefon" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "bank" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "iban" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "bic" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "kontenrahmen" "kontenrahmen" DEFAULT 'SKR03' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "payment_term_days" smallint DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "default_format" "invoice_format" DEFAULT 'zugferd' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_versions" ADD CONSTRAINT "contact_versions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_versions_contact_version" ON "contact_versions" USING btree ("contact_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_counter" ON "invoices" USING btree ("number_year","number_counter");