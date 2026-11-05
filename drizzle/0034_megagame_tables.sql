CREATE TABLE "level_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"class" text NOT NULL,
	"level" integer NOT NULL,
	"source" text NOT NULL,
	"awarded_by" text,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checks_passed" boolean NOT NULL,
	"override_reason" text,
	"card_photo_url" text,
	"note" text,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "level_events_level_range" CHECK ("level_events"."level" between 1 and 5),
	CONSTRAINT "level_events_source_known" CHECK ("level_events"."source" in ('picker', 'volunteer')),
	CONSTRAINT "level_events_card_photo_https" CHECK ("level_events"."card_photo_url" is null or "level_events"."card_photo_url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "quest_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"quest_id" uuid NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"confirmed_by" text,
	"undone_at" timestamp with time zone,
	"undone_by" text,
	"undo_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_progress_status_known" CHECK ("quest_progress"."status" in ('attempted', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"class" text,
	"kind" text NOT NULL,
	"answers" text[] DEFAULT '{}' NOT NULL,
	"evidence" text,
	"hint" text,
	"min_level" integer,
	"max_level" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quests_code_unique" UNIQUE("code"),
	CONSTRAINT "quests_kind_known" CHECK ("quests"."kind" in ('answer', 'evidence')),
	CONSTRAINT "quests_level_window_needs_class" CHECK ("quests"."class" is not null or ("quests"."min_level" is null and "quests"."max_level" is null))
);
--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_awarded_by_user_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_progress" ADD CONSTRAINT "quest_progress_undone_by_user_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "level_events_live_unique" ON "level_events" USING btree ("user_id","class","level") WHERE "level_events"."voided_at" is null and "level_events"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "level_events_user_id_idx" ON "level_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_progress_user_quest_unique" ON "quest_progress" USING btree ("user_id","quest_id");--> statement-breakpoint
CREATE INDEX "quest_progress_quest_id_idx" ON "quest_progress" USING btree ("quest_id");--> statement-breakpoint
CREATE INDEX "quest_progress_confirmed_by_idx" ON "quest_progress" USING btree ("confirmed_by");