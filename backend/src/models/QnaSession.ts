import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

const QnaSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    /** Cleared when a session is closed; see the index note below. */
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/**
 * At most one ACTIVE session per student per topic, so a resumed session is
 * guaranteed unique even under two simultaneous requests.
 *
 * The flag exists rather than testing `endedAt: {$exists: false}` because Mongo
 * rejects that in a partial index -- it is a $not expression, which partial
 * filters do not support. An explicit boolean is also cheaper to index.
 */
QnaSessionSchema.index(
  { userId: 1, noteId: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

export type QnaSessionDoc = InferSchemaType<typeof QnaSessionSchema>;
export const QnaSession = defineModel("QnaSession", QnaSessionSchema);
