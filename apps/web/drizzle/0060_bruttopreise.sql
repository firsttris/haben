CREATE TABLE "invoice_taxes" (
	"invoice_id" uuid NOT NULL,
	"rate" smallint NOT NULL,
	"base" integer NOT NULL,
	"tax" integer NOT NULL,
	CONSTRAINT "invoice_taxes_invoice_id_rate_pk" PRIMARY KEY("invoice_id","rate")
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "price_includes_tax" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "price_mode" text DEFAULT 'netto' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "price_mode" text DEFAULT 'netto' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "price_mode" text DEFAULT 'netto' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_taxes" ADD CONSTRAINT "invoice_taxes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;