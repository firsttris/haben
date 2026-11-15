CREATE TABLE "file_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"files" integer NOT NULL,
	"problem_count" integer NOT NULL,
	"problems" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "file_checks_at" ON "file_checks" USING btree ("at");