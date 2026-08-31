import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * A one-time sign-in code. The code itself is never stored -- only a SHA-256
 * hash -- so a leaked database dump cannot be used to log in as anyone.
 */
const LoginCodeSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    /** Wrong guesses. Enough of them burns the code. */
    attempts: { type: Number, default: 0 },
    consumedAt: Date,
  },
  { timestamps: true }
);

/** Mongo removes expired codes on its own; no cleanup job to forget about. */
LoginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type LoginCodeDoc = InferSchemaType<typeof LoginCodeSchema>;
export const LoginCode = defineModel("LoginCode", LoginCodeSchema);
