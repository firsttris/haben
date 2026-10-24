ALTER TYPE "public"."allocation_kind" ADD VALUE 'kursdifferenz';--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text NOT NULL,
	"month" text NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_currency_month_pk" PRIMARY KEY("currency","month"),
	CONSTRAINT "exchange_rates_currency" CHECK ("exchange_rates"."currency" ~ '^[A-Z]{3}$' and "exchange_rates"."currency" <> 'EUR'),
	CONSTRAINT "exchange_rates_month" CHECK ("exchange_rates"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "exchange_rates_rate" CHECK ("exchange_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "write_offs" DROP CONSTRAINT "write_offs_target";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "tageskurs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "exchange_rate_source" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "exchange_rate_date" date;--> statement-breakpoint
ALTER TABLE "invoice_taxes" ADD COLUMN "original_base" bigint;--> statement-breakpoint
ALTER TABLE "invoice_taxes" ADD COLUMN "original_tax" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate_source" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate_date" date;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_target" CHECK (("write_offs"."kind" = 'skontoErhalten' and "write_offs"."document_id" is not null and "write_offs"."invoice_id" is null) or ("write_offs"."kind" in ('skonto', 'forderungsausfall') and "write_offs"."invoice_id" is not null and "write_offs"."document_id" is null) or ("write_offs"."kind" = 'kursdifferenz' and ("write_offs"."invoice_id" is null) <> ("write_offs"."document_id" is null) and "write_offs"."transaction_id" is not null));