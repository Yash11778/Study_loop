import { EMBEDDING_DIM } from "@/config/ai";
import { embedTexts } from "./providers";

/**
 * Gemini caps the batch size, and a seed of a few dozen chunks is already over
 * a comfortable single request, so batching is not optional.
 */
const BATCH = 32;

export async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const vectors = await embedTexts(texts.slice(i, i + BATCH));
    out.push(...vectors.map(normalise));
  }

  // The Atlas index is created with a fixed dimension and silently returns
  // nothing if the stored vectors disagree, so assert here where the error is
  // still traceable to a model change.
  for (const [i, v] of out.entries()) {
    if (v.length !== EMBEDDING_DIM) {
      throw new Error(
        `Embedding ${i} has ${v.length} dimensions but EMBEDDING_DIM is ${EMBEDDING_DIM}. ` +
          `The embedding model in config/ai.ts changed shape -- update EMBEDDING_DIM, drop the ` +
          `Atlas vector index, and re-run the seed.`
      );
    }
  }

  return out;
}

/**
 * gemini-embedding-001 only returns unit vectors at its full 3072 dimensions --
 * a truncated vector comes back with a norm well below 1. Cosine is invariant to
 * scale so it would survive either way, but normalising here keeps every stored
 * vector on the unit sphere, which is what lets the Atlas index be switched to
 * dotProduct later without re-embedding.
 */
function normalise(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/** Cosine similarity for the in-process fallback search. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
