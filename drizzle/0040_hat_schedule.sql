CREATE TABLE "hat_schedule" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shifts" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hat_schedule_single_row" CHECK ("hat_schedule"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "hat_schedule" ADD CONSTRAINT "hat_schedule_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;