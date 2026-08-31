import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * One row per attempt, not per logical call -- a request that fails on Groq and
 * succeeds on Gemini writes two. The ratio of fellBack:true to total is the
 * health metric for the whole inference layer.
 */
const LlmCallSchema = new Schema(
  {
    task: { type: String, required: true, index: true },
    provider: { type: String, enum: ["groq", "gemini"], required: true },
    model: { type: String, required: true },
    tokensIn: Number,
    tokensOut: Number,
    latencyMs: Number,
    ok: { type: Boolean, required: true },
    fellBack: { type: Boolean, default: false },
    reason: {
      type: String,
      enum: [
        "rate_limit",
        "request_too_large",
        "invalid_generation",
        "server_error",
        "timeout",
        "schema_invalid",
        "none",
      ],
      default: "none",
    },
    /**
     * The provider's own message. Without it a failed row records only that
     * something went wrong, which is not enough to tell a rate limit from a
     * malformed request when the failure is intermittent.
     */
    errorMessage: String,
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/** Telemetry, not records of account. Expire after 30 days so it never dominates the cluster. */
LlmCallSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export type LlmCallDoc = InferSchemaType<typeof LlmCallSchema>;
export const LlmCall = defineModel("LlmCall", LlmCallSchema);
