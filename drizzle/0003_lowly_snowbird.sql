ALTER TABLE `threads` ADD `kind` text DEFAULT 'question' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `is_synthesis` integer DEFAULT false NOT NULL;