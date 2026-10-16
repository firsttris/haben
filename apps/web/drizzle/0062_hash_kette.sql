CREATE TABLE "audit_chain" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"seq" bigint NOT NULL,
	"hash" "bytea" NOT NULL,
	CONSTRAINT "audit_chain_single_row" CHECK ("audit_chain"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "seals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"columns" jsonb NOT NULL,
	"digest" text NOT NULL,
	"genesis" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Erst ohne NOT NULL: 0063 verkettet die vorhandenen Einträge und setzt dann NOT NULL und den Index auf seq.
ALTER TABLE "audit_log" ADD COLUMN "seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" "bytea";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "row_hash" "bytea";--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "pruefwert_mail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "seals_row" ON "seals" USING btree ("table_name","row_id");