import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

const AttemptAnswerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    chosenIndex: { type: Number, required: true, min: 0, max: 3 },
    isCorrect: { type: Boolean, required: true },
    msSpent: Number,
  },
  { _id: false }
);

const AttemptSchema = new Schema(
  {
    quizId: { type: Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    answers: { type: [AttemptAnswerSchema], default: [] },
    startedAt: { type: Date, default: Date.now },
    submittedAt: Date,
  },
  { timestamps: true }
);

/** One submitted attempt per quiz -- a resubmit should 409, not create a second score. */
AttemptSchema.index({ quizId: 1, userId: 1 }, { unique: true });

export type AttemptDoc = InferSchemaType<typeof AttemptSchema>;
export const Attempt = defineModel("Attempt", AttemptSchema);
