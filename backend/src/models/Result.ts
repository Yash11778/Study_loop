import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

const PerConceptSchema = new Schema(
  {
    conceptSlug: { type: String, required: true },
    label: { type: String, required: true },
    asked: { type: Number, required: true },
    correct: { type: Number, required: true },
    mastery: { type: Number, required: true }, // 0-1
  },
  { _id: false }
);

/**
 * Its own collection rather than embedded in the attempt: the result is
 * addressed directly by the email link and the PDF route, and it has a
 * lifecycle (feedback generated, PDF rendered, mail sent) the attempt does not.
 */
const ResultSchema = new Schema(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    score: { type: Number, required: true },
    band: { type: String, enum: ["needs_work", "developing", "solid", "strong"], required: true },
    perConcept: { type: [PerConceptSchema], default: [] },
    feedbackMd: String,
    pdfUrl: String,
  },
  { timestamps: true }
);

export type ResultDoc = InferSchemaType<typeof ResultSchema>;
export const Result = defineModel("Result", ResultSchema);
