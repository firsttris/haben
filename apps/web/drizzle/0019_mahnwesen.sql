ALTER TYPE "public"."allocation_kind" ADD VALUE 'mahnerloes';--> statement-breakpoint
CREATE TABLE "dunnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"open" integer NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"flat_fee" integer DEFAULT 0 NOT NULL,
	"interest" integer DEFAULT 0 NOT NULL,
	"interest_rate" integer DEFAULT 0 NOT NULL,
	"interest_days" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"intro" text NOT NULL,
	"closing" text NOT NULL,
	"pdf" "bytea" NOT NULL,
	"pdf_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "dunning" jsonb DEFAULT '{"baseRate":null,"fees":{"1":0,"2":0,"3":0},"deadlineDays":10}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dunnings" ADD CONSTRAINT "dunnings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;