CREATE TABLE "archive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"year" smallint,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_files_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "datev_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"side" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"account" text NOT NULL,
	"contra_account" text NOT NULL,
	"bu_key" text DEFAULT '' NOT NULL,
	"voucher_field1" text DEFAULT '' NOT NULL,
	"voucher_field2" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"document_link" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lexoffice_connection" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"organization_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexoffice_connection_single_row" CHECK ("lexoffice_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "lexoffice_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"progress" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lexoffice_voucher_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"role" text NOT NULL,
	"lexoffice_file_id" text,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lexoffice_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexoffice_id" text NOT NULL,
	"import_id" uuid NOT NULL,
	"type" text NOT NULL,
	"direction" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"due_date" date,
	"service_from" date,
	"service_to" date,
	"status" text NOT NULL,
	"contact_id" uuid,
	"contact_name" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net" integer NOT NULL,
	"tax" integer NOT NULL,
	"gross" integer NOT NULL,
	"taxes" jsonb NOT NULL,
	"categories" jsonb NOT NULL,
	"payment" jsonb,
	"remark" text DEFAULT '' NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexoffice_vouchers_lexoffice_id_unique" UNIQUE("lexoffice_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lexoffice_id" text;--> statement-breakpoint
ALTER TABLE "datev_bookings" ADD CONSTRAINT "datev_bookings_file_id_archive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."archive_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexoffice_voucher_files" ADD CONSTRAINT "lexoffice_voucher_files_voucher_id_lexoffice_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."lexoffice_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexoffice_vouchers" ADD CONSTRAINT "lexoffice_vouchers_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexoffice_vouchers" ADD CONSTRAINT "lexoffice_vouchers_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_files_year" ON "archive_files" USING btree ("year","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "datev_bookings_file_row" ON "datev_bookings" USING btree ("file_id","row");--> statement-breakpoint
CREATE INDEX "datev_bookings_date" ON "datev_bookings" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "lexoffice_voucher_files_unique" ON "lexoffice_voucher_files" USING btree ("voucher_id","sha256");--> statement-breakpoint
CREATE INDEX "lexoffice_vouchers_date" ON "lexoffice_vouchers" USING btree ("date");--> statement-breakpoint
CREATE INDEX "lexoffice_vouchers_number" ON "lexoffice_vouchers" USING btree ("number");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lexoffice_id_unique" UNIQUE("lexoffice_id");