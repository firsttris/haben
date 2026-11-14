CREATE TABLE "annual_submission_figures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annual_submission_figures" ADD CONSTRAINT "annual_submission_figures_submission_id_annual_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."annual_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annual_submission_figures_eindeutig" ON "annual_submission_figures" USING btree ("submission_id","field");