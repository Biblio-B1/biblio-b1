CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text,
	`subject_confirmed` integer DEFAULT false NOT NULL,
	`file_path` text NOT NULL,
	`mime` text NOT NULL,
	`sha256` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`source_path` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`author_id` text,
	`correction_of_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`correction_of_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_sha256_unique` ON `documents` (`sha256`);--> statement-breakpoint
CREATE INDEX `documents_subject_idx` ON `documents` (`subject_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`solution` text,
	`hints` text,
	`lang` text DEFAULT 'fr' NOT NULL,
	`group_key` text NOT NULL,
	`subject_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `exercises_document_idx` ON `exercises` (`document_id`);--> statement-breakpoint
CREATE INDEX `exercises_group_idx` ON `exercises` (`group_key`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`image_path` text,
	`pinned` integer DEFAULT false NOT NULL,
	`is_summary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `posts_thread_idx` ON `posts` (`thread_id`);--> statement-breakpoint
CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `exercise_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL,
	`rules` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_slug_unique` ON `subjects` (`slug`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`question` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `threads_target_idx` ON `threads` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);