ALTER TABLE "quests" DROP CONSTRAINT "quests_kind_known";--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "body_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "body_images" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "min_players" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "stamps_wizard" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "stamps_pirate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "stamps_alien" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "stamps_any" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "evidence_image" text;--> statement-breakpoint
ALTER TABLE "quests" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "quests" DROP COLUMN "answers";--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_body_images_max" CHECK (cardinality("quests"."body_images") <= 3);--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_min_players_range" CHECK ("quests"."min_players" between 1 and 100);--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_stamps_not_negative" CHECK ("quests"."stamps_wizard" >= 0 and "quests"."stamps_pirate" >= 0 and "quests"."stamps_alien" >= 0 and "quests"."stamps_any" >= 0);--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_evidence_image_https" CHECK ("quests"."evidence_image" is null or "quests"."evidence_image" like 'https://%');