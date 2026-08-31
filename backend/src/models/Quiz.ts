import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * Questions are embedded: exactly ten, written once, and never queried
 * independently of their quiz. correctIndex lives here and is projected out on
 * every read path that reaches a browser -- see toClientQuiz().
 */
const QuizQuestionSchema = new Schema(
  {
    conceptSlug: { type: String, required: true },
    stem: { type: String, required: true },
    options: {
      type: [String],
      required: true,
      validate: { validator: (v: string[]) => v.length === 4, message: "expected 4 options" },
    },
    correctIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, required: true },
    difficulty: { type: String, enum: ["recall", "apply", "analyse"], required: true },
  },
  { _id: true }
);

const BlueprintEntrySchema = new Schema(
  {
    conceptSlug: { type: String, required: true },
    struggleScore: { type: Number, required: true },
    questionCount: { type: Number, required: true },
    difficulty: { type: String, enum: ["recall", "apply", "analyse"], required: true },
  },
  { _id: false }
);

const QuizSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "QnaSession", required: true },
    noteId: { type: Schema.Types.ObjectId, ref: "Note", required: true },
    blueprint: { type: [BlueprintEntrySchema], default: [] },
    questions: { type: [QuizQuestionSchema], default: [] },
    status: { type: String, enum: ["generating", "ready", "failed"], default: "generating" },
    modelUsed: String,
    /** Set from the request's idempotency key so a double-submit reuses the quiz. */
    idempotencyKey: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
);

export type QuizDoc = InferSchemaType<typeof QuizSchema>;
export const Quiz = defineModel("Quiz", QuizSchema);
