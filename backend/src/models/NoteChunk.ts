import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";
import { EMBEDDING_DIM } from "@/config/ai";

/**
 * One document per chunk rather than an array on the note: Atlas Vector Search
 * indexes a field per document, and $vectorSearch returns documents, so the
 * chunk has to be the document.
 */
const NoteChunkSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    ordinal: { type: Number, required: true },
    content: { type: String, required: true },
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === EMBEDDING_DIM,
        message: `embedding must have exactly ${EMBEDDING_DIM} dimensions`,
      },
    },
    tokenCount: Number,
  },
  { timestamps: true }
);

NoteChunkSchema.index({ noteId: 1, ordinal: 1 }, { unique: true });

export type NoteChunkDoc = InferSchemaType<typeof NoteChunkSchema>;
export const NoteChunk = defineModel("NoteChunk", NoteChunkSchema);
