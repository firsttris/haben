CREATE TABLE "bank_duplicate_check" (
	"id" integer PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_duplicate_check_single" CHECK ("bank_duplicate_check"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "bank_duplicate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_duplicate_decisions_kind" CHECK (("bank_duplicate_decisions"."decision" in ('duplicate', 'distinct') and "bank_duplicate_decisions"."reverses_id" is null) or ("bank_duplicate_decisions"."decision" = 'pending' and "bank_duplicate_decisions"."reverses_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "bank_duplicate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"original_transaction_id" uuid NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_duplicate_reviews_distinct_rows" CHECK ("bank_duplicate_reviews"."transaction_id" <> "bank_duplicate_reviews"."original_transaction_id"),
	CONSTRAINT "bank_duplicate_reviews_decision" CHECK ("bank_duplicate_reviews"."decision" in ('pending', 'duplicate', 'distinct'))
);
--> statement-breakpoint
CREATE TABLE "bank_import_transactions" (
	"bank_import_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "bank_import_transactions_bank_import_id_transaction_id_pk" PRIMARY KEY("bank_import_id","transaction_id")
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "ambiguous_entry_references" text[];--> statement-breakpoint
ALTER TABLE "bank_duplicate_decisions" ADD CONSTRAINT "bank_duplicate_decisions_review_id_bank_duplicate_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."bank_duplicate_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_duplicate_decisions" ADD CONSTRAINT "bank_duplicate_decisions_reverses_id_bank_duplicate_decisions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."bank_duplicate_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_duplicate_reviews" ADD CONSTRAINT "bank_duplicate_reviews_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_duplicate_reviews" ADD CONSTRAINT "bank_duplicate_reviews_original_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("original_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_import_transactions" ADD CONSTRAINT "bank_import_transactions_bank_import_id_bank_imports_id_fk" FOREIGN KEY ("bank_import_id") REFERENCES "public"."bank_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_import_transactions" ADD CONSTRAINT "bank_import_transactions_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_duplicate_decisions_review" ON "bank_duplicate_decisions" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_duplicate_decisions_reversal" ON "bank_duplicate_decisions" USING btree ("reverses_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_duplicate_reviews_pair" ON "bank_duplicate_reviews" USING btree (least("transaction_id", "original_transaction_id"),greatest("transaction_id", "original_transaction_id"));--> statement-breakpoint
CREATE INDEX "bank_duplicate_reviews_transaction" ON "bank_duplicate_reviews" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "bank_import_transactions_transaction" ON "bank_import_transactions" USING btree ("transaction_id","bank_import_id");