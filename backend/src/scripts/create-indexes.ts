/**
 * Syncs Mongoose's declared indexes, then creates the Atlas Vector Search index
 * that $vectorSearch needs.
 *
 * The vector index is an Atlas-side search index, not a normal database index --
 * syncIndexes() does not touch it. The driver can create it on Atlas via
 * createSearchIndex; on a deployment without Atlas Search that call fails, and
 * the app falls back to exact in-process cosine scoring.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "@/db/connection";
import { EMBEDDING_DIM } from "@/config/ai";
import * as models from "@/models";
import { NoteChunk } from "@/models/NoteChunk";
import { QnaSession } from "@/models/QnaSession";
import { QnaTurn } from "@/models/QnaTurn";
import { logger } from "@/utils/logger";

export const VECTOR_INDEX_NAME = "note_chunk_embedding";

const VECTOR_INDEX = {
  name: VECTOR_INDEX_NAME,
  type: "vectorSearch" as const,
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIM, similarity: "cosine" },
      // Declared as a filter field so retrieval can scope to one note without a
      // post-filter that would throw away most of the k results.
      { type: "filter", path: "noteId" },
    ],
  },
};

async function main() {
  await connectDB();

  /**
   * Migrate sessions created before one-session-per-topic was enforced.
   *
   * Earlier builds opened a fresh session on every visit, so a student can hold
   * several for one topic -- which the unique index rejects. The survivor is the
   * one with the most turns, because that is the one holding the actual work;
   * the rest are closed rather than deleted, so their turns stay on record and
   * only the active slot is freed.
   *
   * The index is dropped first: it cannot be reconciled while the duplicates it
   * forbids are still present, and syncIndexes would fail before this ran.
   */
  const SESSION_INDEX = "userId_1_noteId_1";
  const existingIndexes = await QnaSession.collection.indexes();

  if (existingIndexes.some((i) => i.name === SESSION_INDEX)) {
    await QnaSession.collection.dropIndex(SESSION_INDEX);
    logger.info({ index: SESSION_INDEX }, "dropped session index so duplicates can be resolved");
  }

  // A closed session must never hold the active slot, whatever it says now.
  await QnaSession.updateMany({ endedAt: { $exists: true } }, { $set: { active: false } });

  const openSessions = await QnaSession.find(
    { endedAt: { $exists: false } },
    { userId: 1, noteId: 1 }
  ).lean();

  logger.info({ open: openSessions.length }, "open sessions found");

  if (openSessions.length > 0) {
    const turnCounts = await QnaTurn.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([
      { $match: { sessionId: { $in: openSessions.map((s) => s._id) } } },
      { $group: { _id: "$sessionId", n: { $sum: 1 } } },
    ]);
    const turnsBySession = new Map(turnCounts.map((t) => [String(t._id), t.n]));

    const byPair = new Map<string, typeof openSessions>();
    for (const session of openSessions) {
      const key = `${session.userId}:${session.noteId}`;
      byPair.set(key, [...(byPair.get(key) ?? []), session]);
    }

    let kept = 0;
    let closed = 0;

    for (const group of byPair.values()) {
      const ranked = [...group].sort(
        (a, b) => (turnsBySession.get(String(b._id)) ?? 0) - (turnsBySession.get(String(a._id)) ?? 0)
      );

      await QnaSession.updateOne({ _id: ranked[0]!._id }, { $set: { active: true } });
      kept += 1;

      for (const stale of ranked.slice(1)) {
        await QnaSession.updateOne({ _id: stale._id }, { $set: { active: false, endedAt: new Date() } });
        closed += 1;
      }
    }

    logger.info({ kept, closed }, "sessions migrated to one active per student per topic");
  }

  for (const [name, model] of Object.entries(models)) {
    await model.syncIndexes();
    logger.info({ collection: name }, "indexes synced");
  }

  const collection = NoteChunk.collection;

  /**
   * listSearchIndexes is typed as returning only { name }, but Atlas also
   * reports build state, which is the part worth waiting on.
   */
  type SearchIndexInfo = { name: string; status?: string; queryable?: boolean };
  const listIndex = async (): Promise<SearchIndexInfo | undefined> =>
    (await collection.listSearchIndexes(VECTOR_INDEX_NAME).toArray())[0] as SearchIndexInfo | undefined;

  try {
    const existing = await listIndex();

    if (existing) {
      logger.info({ name: VECTOR_INDEX_NAME, status: existing.status }, "vector index already exists");

      // A definition change needs an update, not a create -- createSearchIndex
      // would fail with a duplicate-name error.
      await collection.updateSearchIndex(VECTOR_INDEX_NAME, VECTOR_INDEX.definition);
      logger.info("vector index definition updated");
    } else {
      await collection.createSearchIndex(VECTOR_INDEX);
      logger.info({ name: VECTOR_INDEX_NAME }, "vector index created -- it builds in the background");
    }

    // Building takes a little while; $vectorSearch returns nothing until it is
    // queryable, which otherwise looks exactly like a bad query.
    for (let i = 0; i < 30; i++) {
      const index = await listIndex();
      if (index?.queryable) {
        logger.info("vector index is queryable");
        return;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    logger.warn("vector index is still building; retrieval falls back to in-process cosine until it is ready");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      "could not create the Atlas Vector Search index. Retrieval still works via exact " +
        "in-process cosine scoring, which is correct but scans every chunk. " +
        "On a free Atlas tier, create it by hand: Atlas > Atlas Search > Create Index > JSON editor:\n" +
        JSON.stringify(VECTOR_INDEX, null, 2)
    );
  }
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "index setup failed");
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
