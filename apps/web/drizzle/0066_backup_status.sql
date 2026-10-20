CREATE TABLE "backup_status" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"snapshot" text,
	"bytes" bigint,
	"message" text DEFAULT '' NOT NULL,
	CONSTRAINT "backup_status_kind" CHECK ("backup_status"."kind" in ('backup', 'restore_check'))
);
--> statement-breakpoint
CREATE INDEX "backup_status_kind_at" ON "backup_status" USING btree ("kind","at");