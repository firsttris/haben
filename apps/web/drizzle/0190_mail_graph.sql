ALTER TABLE "mail_settings" ALTER COLUMN "host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ALTER COLUMN "port" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ALTER COLUMN "secure" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ALTER COLUMN "ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_log" ADD COLUMN "transport" text DEFAULT 'smtp' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "transport" text DEFAULT 'smtp' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "graph_tenant_id" text;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "graph_client_id" text;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "graph_auth" text;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "graph_thumbprint" text;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "graph_mailbox" text;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_transport" CHECK (("mail_settings"."transport" = 'smtp' and "mail_settings"."host" is not null and "mail_settings"."port" is not null and "mail_settings"."secure" is not null and "mail_settings"."username" is not null and "mail_settings"."ciphertext" is not null)
        or ("mail_settings"."transport" = 'graph' and "mail_settings"."graph_tenant_id" is not null and "mail_settings"."graph_client_id" is not null and "mail_settings"."graph_auth" is not null and "mail_settings"."ciphertext" is not null
        and ("mail_settings"."graph_auth" <> 'certificate' or "mail_settings"."graph_thumbprint" is not null)));