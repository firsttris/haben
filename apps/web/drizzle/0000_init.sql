CREATE TYPE "public"."bundesland" AS ENUM('BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH');--> statement-breakpoint
CREATE TYPE "public"."vat_return_status" AS ENUM('draft', 'sent');--> statement-breakpoint
CREATE TYPE "public"."versteuerung" AS ENUM('ist', 'soll');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text,
	"table_name" text NOT NULL,
	"row_id" text,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"strasse" text DEFAULT '' NOT NULL,
	"plz" text DEFAULT '' NOT NULL,
	"ort" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"steuernummer" text DEFAULT '' NOT NULL,
	"ust_id" text DEFAULT '' NOT NULL,
	"finanzamt" text DEFAULT '' NOT NULL,
	"bundesland" "bundesland",
	"versteuerung" "versteuerung" DEFAULT 'ist' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_single_row" CHECK ("company"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "elster_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"valid_until" date,
	"active" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_return_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vat_return_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ok" boolean NOT NULL,
	"code" integer NOT NULL,
	"message" text NOT NULL,
	"transfer_ticket" text,
	"request_xml" text NOT NULL,
	"response_xml" text NOT NULL,
	"server_response_xml" text NOT NULL,
	"protocol_pdf" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vat_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"kz81" integer DEFAULT 0 NOT NULL,
	"kz86" integer DEFAULT 0 NOT NULL,
	"kz66" integer DEFAULT 0 NOT NULL,
	"kz83" integer DEFAULT 0 NOT NULL,
	"status" "vat_return_status" DEFAULT 'draft' NOT NULL,
	"berichtigt" boolean DEFAULT false NOT NULL,
	"corrects_id" uuid,
	"transfer_ticket" text,
	"sent_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_returns_month" CHECK ("vat_returns"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vat_return_submissions" ADD CONSTRAINT "vat_return_submissions_vat_return_id_vat_returns_id_fk" FOREIGN KEY ("vat_return_id") REFERENCES "public"."vat_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_returns_one_draft_per_period" ON "vat_returns" USING btree ("year","month") WHERE "vat_returns"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credential_id_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");