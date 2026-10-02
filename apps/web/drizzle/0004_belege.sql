CREATE TYPE "public"."document_status" AS ENUM('neu', 'gebucht');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('keine', 'laeuft', 'fertig', 'fehler');--> statement-breakpoint
CREATE TABLE "document_amounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"tax_rate" smallint NOT NULL,
	"net" integer NOT NULL,
	"tax" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"status" "document_status" DEFAULT 'neu' NOT NULL,
	"extracted_by" text,
	"extraction_status" "extraction_status" DEFAULT 'keine' NOT NULL,
	"extraction_error" text,
	"extraction" jsonb,
	"supplier_name" text DEFAULT '' NOT NULL,
	"supplier_ust_id" text DEFAULT '' NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"document_date" date,
	"due_date" date,
	"category" text,
	"payment" text DEFAULT 'bank' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"gross" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
ALTER TABLE "document_amounts" ADD CONSTRAINT "document_amounts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_amounts_rate" ON "document_amounts" USING btree ("document_id","tax_rate");