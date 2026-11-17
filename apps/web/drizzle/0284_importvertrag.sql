CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"fetch_id" text NOT NULL,
	"part_index" integer NOT NULL,
	"part_last" boolean NOT NULL,
	"coverage_from" date NOT NULL,
	"coverage_to" date NOT NULL,
	"blocking" integer NOT NULL,
	"open_from" date,
	"fingerprint" text NOT NULL,
	"bank_import_id" uuid NOT NULL,
	"checkpoint" date,
	"complete" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_event_id" text NOT NULL,
	"component" text NOT NULL,
	"kind" text NOT NULL,
	"booking_date" date NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"details" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_movements_component" CHECK ("import_movements"."component" in ('main', 'fee'))
);
--> statement-breakpoint
CREATE TABLE "import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"account_kind" text NOT NULL,
	"cutover_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_sources_kind" CHECK ("import_sources"."account_kind" in ('bank', 'psp'))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_import_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."import_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_bank_import_id_bank_imports_id_fk" FOREIGN KEY ("bank_import_id") REFERENCES "public"."bank_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_movements" ADD CONSTRAINT "import_movements_source_id_import_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."import_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_movements" ADD CONSTRAINT "import_movements_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_movements" ADD CONSTRAINT "import_movements_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_sources" ADD CONSTRAINT "import_sources_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_key" ON "import_batches" USING btree ("source_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "import_batches_source_created" ON "import_batches" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_movements_identity" ON "import_movements" USING btree ("source_id","source_event_id","component");--> statement-breakpoint
CREATE UNIQUE INDEX "import_movements_transaction" ON "import_movements" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_sources_identity" ON "import_sources" USING btree ("provider","external_account_id");