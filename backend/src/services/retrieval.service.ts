import { NoteChunk } from "@/models/NoteChunk";
import { cosine } from "./ai/embeddings";
import { embedTexts } from "./ai/providers";
import { logger } from "@/utils/logger";
import type { Types } from "mongoose";

export type RetrievedChunk = {
  chunkId: string;
  ordinal: number;
  content: string;
  score: number;
};

const VECTOR_INDEX = "note_chunk_embedding";

/**
 * Retrieval has two paths on purpose.
 *
 * Atlas Vector Search is the real one and the only one that scales. But it is
 * an Atlas-side index that does not exist until someone creates it, and a
 * missing index fails the aggregation rather than returning nothing -- which on
 * a fresh clone looks like a broken app. So a failed $vectorSearch falls back to
 * scoring every chunk in process, which is exact and perfectly fast at the size
 * of one seeded note.
 */
export async function retrieve(
  noteId: Types.ObjectId,
  query: string,
  k = 5
): Promise<RetrievedChunk[]> {
  const [queryVector] = await embedTexts([query]);
  if (!queryVector) throw new Error("failed to embed the query");

  try {
    const hits = await NoteChunk.aggregate<{
      _id: Types.ObjectId;
      ordinal: number;
      content: string;
      score: number;
    }>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(k * 20, 100),
          limit: k,
          filter: { noteId },
        },
      },
      { $project: { ordinal: 1, content: 1, score: { $meta: "vectorSearchScore" } } },
    ]);

    if (hits.length > 0) {
      return hits.map((h) => ({
        chunkId: String(h._id),
        ordinal: h.ordinal,
        content: h.content,
        score: h.score,
      }));
    }
    logger.warn("vector search returned nothing; falling back to in-process scoring");
  } catch (err) {
    logger.warn({ err }, `$vectorSearch failed (is the "${VECTOR_INDEX}" index created?); scoring in process`);
  }

  const all = await NoteChunk.find({ noteId }, { ordinal: 1, content: 1, embedding: 1 }).lean();

  return all
    .map((c) => ({
      chunkId: String(c._id),
      ordinal: c.ordinal,
      content: c.content,
      score: cosine(queryVector, c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
