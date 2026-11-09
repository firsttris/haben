CREATE TABLE "local_owner_recoveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_issuers" (
	"issuer" text PRIMARY KEY NOT NULL,
	"initialized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"initialized_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_roles" (
	"user_id" text NOT NULL,
	"issuer" text NOT NULL,
	"role" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sso_roles_user_id_issuer_pk" PRIMARY KEY("user_id","issuer"),
	CONSTRAINT "sso_roles_role" CHECK ("sso_roles"."role" in ('inhaber', 'steuerberatung'))
);
--> statement-breakpoint
CREATE TABLE "sso_takeovers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"token_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"previous_responsible_id" text,
	"responsible_id" text
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "calendar_token_created_by" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "calendar_token_responsible_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "calendar_token_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "calendar_token_disabled_reason" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "responsible_id" text;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "oidc_issuer" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_role" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sso_roles" ADD CONSTRAINT "sso_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_oidc_identity_unique" ON "account" USING btree ("provider_id","account_id") WHERE "account"."provider_id" = 'oidc';