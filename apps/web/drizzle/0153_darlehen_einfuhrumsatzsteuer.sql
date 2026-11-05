ALTER TYPE "public"."allocation_kind" ADD VALUE 'darlehen';--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lender" text NOT NULL,
	"term" text NOT NULL,
	"purpose" text NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"opening_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "loan_id" uuid;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "loan_part" text;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz62" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocations_loan" ON "allocations" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_loan" CHECK (case when "allocations"."kind"::text = 'darlehen' then "allocations"."loan_id" is not null and "allocations"."loan_part" is not null else "allocations"."loan_id" is null and "allocations"."loan_part" is null end);