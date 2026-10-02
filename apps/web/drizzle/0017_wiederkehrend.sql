CREATE TABLE "recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"contact_id" uuid NOT NULL,
	"format" "invoice_format" DEFAULT 'zugferd' NOT NULL,
	"payment_term_days" smallint DEFAULT 14 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"tax_treatment" text DEFAULT 'regulaer' NOT NULL,
	"exemption_reason" text DEFAULT '' NOT NULL,
	"lines" jsonb NOT NULL,
	"interval_months" smallint NOT NULL,
	"anchor_day" smallint NOT NULL,
	"next_date" date NOT NULL,
	"end_date" date,
	"service_period" text DEFAULT 'laufend' NOT NULL,
	"mode" text DEFAULT 'entwurf' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_interval" CHECK ("recurring_invoices"."interval_months" in (1, 3, 6, 12)),
	CONSTRAINT "recurring_anchor_day" CHECK ("recurring_invoices"."anchor_day" between 1 and 31)
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurring_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurring_date" date;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_recurring_date" ON "invoices" USING btree ("recurring_id","recurring_date");