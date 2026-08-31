/**
 * Next inlines NEXT_PUBLIC_* at build time only when referenced as a full
 * static property path, so these cannot be read through a dynamic key.
 */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

export const clientEnv = {
  apiUrl: required(process.env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL"),
};
