/**
 * Repairs stored notes in place, without re-authoring them.
 *
 *   npm run fix:notes --workspace=backend
 *
 * Older seeds kept the title the model echoed at the top of each section, so the
 * reader showed the same heading twice. Stripping it changes the text, which
 * means the chunks and their embeddings have to be rebuilt -- but not the prose,
 * so this costs embedding calls only and leaves the note itself untouched.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "@/db/connection";
import { Note } from "@/models/Note";
import { NoteChunk } from "@/models/NoteChunk";
import { stripEchoedTitle } from "@/services/notes.service";
import { embedAll } from "@/services/ai/embeddings";
import { chunkSections, slugify } from "@/utils/chunk";
import { logger } from "@/utils/logger";

/** Split an assembled note back into the sections it was built from. */
function splitSections(bodyMd: string): Array<{ title: string; bodyMd: string }> {
  const parts = bodyMd.split(/\n(?=## )/);
  return parts
    .map((part) => {
      const match = part.match(/^##\s+(.+?)\n([\s\S]*)$/);
      if (!match) return null;
      return { title: match[1]!.trim(), bodyMd: match[2]!.trim() };
    })
    .filter((s): s is { title: string; bodyMd: string } => s !== null);
}

async function main() {
  await connectDB();

  const notes = await Note.find({ source: "seed" });
  let repaired = 0;

  for (const note of notes) {
    const sections = splitSections(note.bodyMd);
    if (sections.length === 0) {
      logger.warn({ note: note.title }, "could not split into sections; skipping");
      continue;
    }

    const cleaned = sections.map((s) => ({ ...s, bodyMd: stripEchoedTitle(s.bodyMd, s.title) }));
    const changed = cleaned.some((c, i) => c.bodyMd !== sections[i]!.bodyMd);

    if (!changed) {
      logger.info({ note: note.title }, "already clean");
      continue;
    }

    const chunks = chunkSections(cleaned);
    const vectors = await embedAll(chunks.map((c) => c.content));

    const embedded = chunks.map((c, i) => {
      const embedding = vectors[i];
      if (!embedding) throw new Error(`missing embedding for chunk ${c.ordinal}`);
      return { ...c, embedding };
    });

    // Concept slugs are stable (they come from the section titles); only the
    // ordinals they point at move, so remap rather than regenerate.
    const concepts = note.concepts.map((concept) => ({
      slug: concept.slug,
      label: concept.label,
      summary: concept.summary,
      chunkOrdinals: chunks.filter((c) => c.sectionSlug === slugify(concept.label)).map((c) => c.ordinal),
    }));

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await NoteChunk.deleteMany({ noteId: note._id }, { session });
        await NoteChunk.insertMany(
          embedded.map((c) => ({
            noteId: note._id,
            ordinal: c.ordinal,
            content: c.content,
            embedding: c.embedding,
            tokenCount: c.tokenCount,
          })),
          { session }
        );
        await Note.updateOne(
          { _id: note._id },
          { $set: { bodyMd: cleaned.map((s) => `## ${s.title}\n\n${s.bodyMd}`).join("\n\n"), concepts } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    repaired += 1;
    logger.info({ note: note.title, chunks: chunks.length }, "repaired");
  }

  logger.info({ repaired, total: notes.length }, "done");
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, "fix-notes failed");
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
