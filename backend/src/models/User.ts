import mongoose, { type InferSchemaType } from "mongoose";
const { Schema } = mongoose;
import { defineModel } from "@/db/define-model";

/**
 * The onboarding profile is 1:1 with the user and bounded, so it is embedded
 * rather than given its own collection -- it is never read without the user.
 */
const ProfileSchema = new Schema(
  {
    year: { type: Number, min: 1, max: 5 },
    branch: { type: String, trim: true },
    /** 1-5 self-rated comfort. Feeds the difficulty tier of the quiz blueprint. */
    comfortLevel: { type: Number, min: 1, max: 5 },
    goal: { type: String, trim: true },
    completedAt: Date,
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, trim: true },

    /**
     * scrypt hash, stored as "salt:derivedKey" in hex. select:false so it is
     * never pulled into a document by accident -- a query has to ask for it
     * explicitly, which makes leaking it a deliberate act rather than an
     * oversight.
     */
    passwordHash: { type: String, required: true, select: false },

    /**
     * Set when the account first completes an emailed code. Until then the
     * password alone gets you nothing: registration issues no session.
     */
    emailVerifiedAt: Date,

    lastLoginAt: Date,
    profile: ProfileSchema,
  },
  { timestamps: true }
);

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = defineModel("User", UserSchema);
