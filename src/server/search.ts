import type { Db } from "./db/client";
import type { documents, exercises, posts, threads } from "./db/schema";

type Document = typeof documents.$inferSelect;
type Exercise = typeof exercises.$inferSelect;
type Thread = typeof threads.$inferSelect;
type Post = typeof posts.$inferSelect;

// Stubs : Task 9 remplace les corps (index FTS5) en gardant ces signatures.
export function indexDocument(_db: Db, _doc: Document): void {}
export function indexExercise(_db: Db, _ex: Exercise): void {}
export function indexThread(_db: Db, _thread: Thread, _posts: Post[]): void {}
export function removeFromIndex(_db: Db, _kind: string, _refId: string): void {}
