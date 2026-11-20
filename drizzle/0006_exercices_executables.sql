-- Fusion de branches : cette migration existait sous 0004_complex_mentallo (déjà appliquée sur
-- certaines bases). IF NOT EXISTS la rend rejouable sans erreur sur ces bases.
CREATE TABLE IF NOT EXISTS `check_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`message` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `check_reports_exercise_idx` ON `check_reports` (`exercise_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `code_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`language` text NOT NULL,
	`code` text NOT NULL,
	`passed` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `code_attempts_user_exercise_idx` ON `code_attempts` (`user_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exercise_checks` (
	`exercise_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`language` text,
	`reference_code` text,
	`reference_source` text,
	`tests` text DEFAULT '[]' NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`verified_by` text,
	`model` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `exercise_checks_status_idx` ON `exercise_checks` (`status`,`updated_at`);