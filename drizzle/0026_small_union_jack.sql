CREATE TABLE "confirmations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quest_id" uuid NOT NULL,
	"requested_user_ids" text[] DEFAULT '{}' NOT NULL,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text
);
--> statement-breakpoint
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
CREATE TABLE "player_codes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "quest_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quest_id" uuid NOT NULL,
	"entered_by" text,
	"entered_answer" text NOT NULL,
	"correct" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"confirmation_id" uuid NOT NULL,
	"quest_id" uuid NOT NULL,
	"user_id" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"void_reason" text
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
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_awarded_by_user_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_events" ADD CONSTRAINT "level_events_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_codes" ADD CONSTRAINT "player_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_attempts" ADD CONSTRAINT "quest_attempts_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_attempts" ADD CONSTRAINT "quest_attempts_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_confirmation_id_confirmations_id_fk" FOREIGN KEY ("confirmation_id") REFERENCES "public"."confirmations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quest_completions" ADD CONSTRAINT "quest_completions_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confirmations_quest_id_idx" ON "confirmations" USING btree ("quest_id");--> statement-breakpoint
CREATE INDEX "confirmations_confirmed_by_idx" ON "confirmations" USING btree ("confirmed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "level_events_live_unique" ON "level_events" USING btree ("user_id","class","level") WHERE "level_events"."voided_at" is null and "level_events"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "level_events_user_id_idx" ON "level_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quest_attempts_quest_id_idx" ON "quest_attempts" USING btree ("quest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quest_completions_live_unique" ON "quest_completions" USING btree ("quest_id","user_id") WHERE "quest_completions"."voided_at" is null and "quest_completions"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "quest_completions_confirmation_id_idx" ON "quest_completions" USING btree ("confirmation_id");--> statement-breakpoint
CREATE INDEX "quest_completions_user_id_idx" ON "quest_completions" USING btree ("user_id");