import mongoose from "mongoose";
import { env } from "@/config/env";

/**
 * Next dev reloads modules on every edit and serverless invocations reuse warm
 * containers -- both will open a new pool per reload unless the connection is
 * parked on globalThis. Without this you exhaust Atlas connection limits fast.
 */
type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as unknown as { _mongoose?: Cache };
const cached: Cache = (globalForMongoose._mongoose ??= { conn: null, promise: null });

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  cached.promise ??= mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    // Serverless: fail fast rather than hanging the request for 30s.
    serverSelectionTimeoutMS: 8_000,
    maxPoolSize: 10,

    /**
     * Never build indexes implicitly.
     *
     * Mongoose otherwise creates every declared index in the background the
     * moment a model is used, which on a live collection is an unannounced
     * write-blocking build -- and it silently recreated a unique index in the
     * middle of a migration whose whole job was to remove the duplicates that
     * index forbids. Index changes belong to `npm run indexes`, run
     * deliberately.
     */
    autoIndex: false,
  });

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // let the next request retry instead of caching the rejection
    throw err;
  }

  return cached.conn;
}
