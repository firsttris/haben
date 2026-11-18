CREATE TABLE "import_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"booking_date" date NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"details" text NOT NULL,
	"transaction" jsonb NOT NULL,
	"bank_import_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conflict_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"transaction_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_resolutions_decision" CHECK ("import_resolutions"."decision" in ('keep', 'add')),
	CONSTRAINT "import_resolutions_transaction" CHECK (("import_resolutions"."decision" = 'add') = ("import_resolutions"."transaction_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_movement_id_import_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."import_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_bank_import_id_bank_imports_id_fk" FOREIGN KEY ("bank_import_id") REFERENCES "public"."bank_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_resolutions" ADD CONSTRAINT "import_resolutions_conflict_id_import_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."import_conflicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_resolutions" ADD CONSTRAINT "import_resolutions_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_conflicts_core" ON "import_conflicts" USING btree ("movement_id","kind","booking_date","amount","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "import_resolutions_conflict" ON "import_resolutions" USING btree ("conflict_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_resolutions_transaction" ON "import_resolutions" USING btree ("transaction_id");