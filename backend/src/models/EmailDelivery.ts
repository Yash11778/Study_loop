import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * Exists so a send that dies after the response is flushed is recoverable. The
 * retry cron reads pending/failed rows; the unique index on resultId makes the
 * send idempotent under double-submit.
 */
const EmailDeliverySchema = new Schema(
  {
    resultId: { type: Schema.Types.ObjectId, ref: "Result", required: true, unique: true },
    to: { type: String, required: true },
    resendId: String,
    status: {
      type: String,
      enum: ["pending", "sent", "delivered", "bounced", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: String,
    sentAt: Date,
  },
  { timestamps: true }
);

export type EmailDeliveryDoc = InferSchemaType<typeof EmailDeliverySchema>;
export const EmailDelivery = defineModel("EmailDelivery", EmailDeliverySchema);
