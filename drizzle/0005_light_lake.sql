CREATE TABLE `homeworks` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text NOT NULL,
	`english_group` text,
	`attachment_path` text,
	`attachment_name` text,
	`attachment_mime` text,
	`attachment_size` integer,
	`author_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `homeworks_due_date_idx` ON `homeworks` (`due_date`);--> statement-breakpoint
CREATE INDEX `homeworks_subject_idx` ON `homeworks` (`subject_id`);