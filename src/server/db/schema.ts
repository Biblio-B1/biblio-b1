import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const ROLES = ["admin", "member"] as const;
export const DOC_TYPES = ["course", "photo", "exercise", "exam", "note"] as const;
export const DOC_SOURCES = ["upload", "local", "github"] as const;
export const PROGRESS_STATUSES = ["todo", "doing", "mastered"] as const;
export const LANGS = ["fr", "en"] as const;
export const THREAD_TARGETS = ["document", "exercise"] as const;

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ROLES }).notNull().default("member"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_name_lower_idx").on(sql`lower(${t.name})`)]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // jeton de session haché
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

export const invites = sqliteTable("invites", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export const subjects = sqliteTable("subjects", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color").notNull().default("#6b7280"),
  rules: text("rules", { mode: "json" }).$type<unknown>(), // règles de classement
  createdAt: createdAt(),
});

export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    title: text("title").notNull(),
    type: text("type", { enum: DOC_TYPES }).notNull(),
    subjectId: text("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    subjectConfirmed: integer("subject_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    filePath: text("file_path").notNull(),
    mime: text("mime").notNull(),
    sha256: text("sha256").notNull().unique(),
    text: text("text").notNull().default(""),
    source: text("source", { enum: DOC_SOURCES }).notNull(),
    sourcePath: text("source_path"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    correctionOfId: text("correction_of_id").references(
      (): import("drizzle-orm/sqlite-core").AnySQLiteColumn => documents.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
  },
  (t) => [index("documents_subject_idx").on(t.subjectId)],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    solution: text("solution"),
    hints: text("hints", { mode: "json" }).$type<string[]>(),
    lang: text("lang", { enum: LANGS }).notNull().default("fr"),
    groupKey: text("group_key").notNull(), // relie les versions FR/EN
    subjectId: text("subject_id").references(() => subjects.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("exercises_document_idx").on(t.documentId),
    index("exercises_group_idx").on(t.groupKey),
  ],
);

export const progress = sqliteTable(
  "progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    status: text("status", { enum: PROGRESS_STATUSES }).notNull().default("todo"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const threads = sqliteTable(
  "threads",
  {
    id: id(),
    targetType: text("target_type", { enum: THREAD_TARGETS }).notNull(),
    targetId: text("target_id").notNull(),
    question: text("question").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("threads_target_idx").on(t.targetType, t.targetId)],
);

export const posts = sqliteTable(
  "posts",
  {
    id: id(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(), // markdown
    imagePath: text("image_path"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("posts_thread_idx").on(t.threadId)],
);
