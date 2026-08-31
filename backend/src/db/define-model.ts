import mongoose, { type InferSchemaType, type Model, type Schema } from "mongoose";
const { model, models } = mongoose;

/**
 * Registering a model twice throws, which happens on any watch-mode reload, so
 * every model reuses the existing registration when there is one. Going through
 * `models[name]` erases the type though -- hence the cast, in one place, rather
 * than a loosely-typed model in every file that imports one.
 */
export function defineModel<TSchema extends Schema>(
  name: string,
  schema: TSchema
): Model<InferSchemaType<TSchema>> {
  type Doc = InferSchemaType<TSchema>;
  return (models[name] as Model<Doc> | undefined) ?? model<Doc>(name, schema as Schema<Doc>);
}
