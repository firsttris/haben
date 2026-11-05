CREATE TABLE "quote_choices" (
	"quote_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_choices_quote_id_position_pk" PRIMARY KEY("quote_id","position")
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "payment_plan_templates" jsonb DEFAULT '[{"name":"30/40/30","rows":[{"label":"Anzahlung","share":{"kind":"prozent","value":3000},"due":"Auftragserteilung"},{"label":"Abschlag","share":{"kind":"prozent","value":4000},"due":"Lieferung"},{"label":"Schlussrechnung","share":{"kind":"rest"},"due":"Abnahme"}]},{"name":"50/50","rows":[{"label":"Anzahlung","share":{"kind":"prozent","value":5000},"due":"Auftragserteilung"},{"label":"Schlussrechnung","share":{"kind":"rest"},"due":"Abnahme"}]}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_plan_row" smallint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "payment_plan" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "payment_plan_in_confirmation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_choices" ADD CONSTRAINT "quote_choices_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_discount" CHECK ("invoice_lines"."discount_percent" is null or "invoice_lines"."discount_amount" is null);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_discount_percent" CHECK ("invoice_lines"."discount_percent" is null or "invoice_lines"."discount_percent" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_row" CHECK ("invoices"."payment_plan_row" is null or ("invoices"."variant" = 'abschlag' and "invoices"."quote_id" is not null and "invoices"."payment_plan_row" >= 0));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount" CHECK ("invoices"."discount_percent" is null or "invoices"."discount_amount" is null);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_percent" CHECK ("invoices"."discount_percent" is null or "invoices"."discount_percent" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_discount" CHECK ("quote_lines"."discount_percent" is null or "quote_lines"."discount_amount" is null);--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_discount_percent" CHECK ("quote_lines"."discount_percent" is null or "quote_lines"."discount_percent" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_kind" CHECK ("quote_lines"."kind" is null or "quote_lines"."kind" in ('optional', 'alternative'));--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount" CHECK ("quotes"."discount_percent" is null or "quotes"."discount_amount" is null);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_percent" CHECK ("quotes"."discount_percent" is null or "quotes"."discount_percent" between 1 and 10000);