CREATE TABLE "archive_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"archive_id" text,
	"link" text,
	"error" text,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_target" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"url" text NOT NULL,
	"file_field" text NOT NULL,
	"header_name" text,
	"ciphertext" "bytea",
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file" text DEFAULT 'original' NOT NULL,
	"link_template" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_target_single_row" CHECK ("archive_target"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "archive_deliveries" ADD CONSTRAINT "archive_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_deliveries_invoice_url" ON "archive_deliveries" USING btree ("invoice_id","url");