ALTER TYPE "public"."allocation_kind" ADD VALUE 'sondervorauszahlung';--> statement-breakpoint
CREATE TABLE "vat_extension_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"kz38" integer,
	"berichtigt" boolean DEFAULT false NOT NULL,
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
	CONSTRAINT "vat_extension_submissions_kz38" CHECK ("vat_extension_submissions"."kz38" is null or "vat_extension_submissions"."kz38" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vat_extensions" (
	"year" smallint PRIMARY KEY NOT NULL,
	"active" boolean NOT NULL,
	"sondervorauszahlung" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz39" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "vat_extension_submissions_year" ON "vat_extension_submissions" USING btree ("year");