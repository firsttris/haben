CREATE TABLE "store_connections" (
	"store" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"fetch_from" date NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_connections_store" CHECK ("store_connections"."store" in ('googleplay', 'appstore')),
	CONSTRAINT "store_connections_config" CHECK ("store_connections"."config"->>'store' = "store_connections"."store")
);
--> statement-breakpoint
CREATE TABLE "store_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"payout_transaction_id" uuid NOT NULL,
	"difference_transaction_id" uuid,
	"covered" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_payouts_bank_transaction_id_unique" UNIQUE("bank_transaction_id"),
	CONSTRAINT "store_payouts_payout_transaction_id_unique" UNIQUE("payout_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "store_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"report_kind" text NOT NULL,
	"part" text NOT NULL,
	"period" text NOT NULL,
	"sha256" text NOT NULL,
	"archive_file_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_reports_period_format" CHECK ("store_reports"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "store_reports_kind" CHECK (("store_reports"."store" = 'googleplay' and "store_reports"."report_kind" = 'earnings') or ("store_reports"."store" = 'appstore' and "store_reports"."report_kind" = 'finance_detail'))
);
--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_payout_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("payout_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_difference_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("difference_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_reports" ADD CONSTRAINT "store_reports_archive_file_id_archive_files_id_fk" FOREIGN KEY ("archive_file_id") REFERENCES "public"."archive_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_reports_period" ON "store_reports" USING btree ("store","report_kind","period","part");