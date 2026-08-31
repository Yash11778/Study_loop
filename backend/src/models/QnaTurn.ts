import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * In Postgres this was its own table. Here signals live inside the turn that
 * produced them -- there are one to three per turn, they are written once with
 * the turn, and they are only ever read by aggregating across turns anyway.
 */
const SignalSchema = new Schema(
  {
    conceptSlug: { type: String, required: true },
    weight: { type: Number, required: true },
    reason: {
      type: String,
      enum: ["first_question", "follow_up", "explicit_confusion", "baseline"],
      required: true,
    },
  },
  { _id: false }
);

const QnaTurnSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "QnaSession", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    citedChunkIds: { type: [Schema.Types.ObjectId], default: [] },
    signals: { type: [SignalSchema], default: [] },
    latencyMs: Number,
  },
  { timestamps: true }
);

export type QnaTurnDoc = InferSchemaType<typeof QnaTurnSchema>;
export const QnaTurn = defineModel("QnaTurn", QnaTurnSchema);
