import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * Concepts are extracted once at seed time and then treated as fixed IDs -- the
 * signal scoring, the quiz blueprint and the result breakdown all key off these
 * slugs, so they must not drift. Bounded at ~12 per note, so embedded.
 */
const ConceptSchema = new Schema(
  {
    slug: { type: String, required: true },
    label: { type: String, required: true },
    summary: { type: String, required: true },
    /** Ordinals into the note's chunks that teach this concept. */
    chunkOrdinals: { type: [Number], default: [] },
  },
  { _id: false }
);

const NoteSchema = new Schema(
  {
    subject: { type: String, required: true, index: true },
    title: { type: String, required: true },
    bodyMd: { type: String, required: true },
    /** "seed" today; "upload" when students bring their own material. */
    source: { type: String, enum: ["seed", "upload"], default: "seed" },
    concepts: { type: [ConceptSchema], default: [] },
    seededAt: Date,
  },
  { timestamps: true }
);

export type NoteDoc = InferSchemaType<typeof NoteSchema>;
export const Note = defineModel("Note", NoteSchema);
