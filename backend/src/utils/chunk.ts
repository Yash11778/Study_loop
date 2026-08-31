/**
 * Paragraph-aware chunking. Splitting on a fixed character count cuts formulae
 * and worked examples in half, which then retrieve as nonsense; splitting on
 * blank lines and only packing up to a budget keeps each chunk a whole thought.
 */
export type Chunk = { ordinal: number; content: string; tokenCount: number };

/** Rough but stable: English prose runs about four characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function chunkMarkdown(body: string, targetTokens = 350, overlapTokens = 60): Chunk[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  const flush = () => {
    if (!buffer.length) return;
    const content = buffer.join("\n\n");
    chunks.push({ ordinal: chunks.length, content, tokenCount: estimateTokens(content) });

    // Carry the tail of this chunk into the next so a concept that straddles a
    // boundary is still retrievable from both sides.
    const carried: string[] = [];
    let carriedTokens = 0;
    for (let i = buffer.length - 1; i >= 0 && carriedTokens < overlapTokens; i--) {
      const p = buffer[i]!;
      carried.unshift(p);
      carriedTokens += estimateTokens(p);
    }
    buffer = carried;
    bufferTokens = carriedTokens;
  };

  for (const paragraph of paragraphs) {
    const tokens = estimateTokens(paragraph);

    // A single paragraph over budget becomes its own chunk rather than being cut.
    if (tokens >= targetTokens) {
      flush();
      chunks.push({ ordinal: chunks.length, content: paragraph, tokenCount: tokens });
      buffer = [];
      bufferTokens = 0;
      continue;
    }

    if (bufferTokens + tokens > targetTokens) flush();
    buffer.push(paragraph);
    bufferTokens += tokens;
  }

  if (buffer.length) {
    const content = buffer.join("\n\n");
    chunks.push({ ordinal: chunks.length, content, tokenCount: estimateTokens(content) });
  }

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

export type SectionChunk = Chunk & { sectionSlug: string };

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Chunks each section independently, then renumbers ordinals across the whole
 * note.
 *
 * Chunking the assembled document would let one chunk straddle a section
 * boundary, which then makes "which concept does this passage teach?" ambiguous.
 * Section-at-a-time keeps that mapping exact and free -- no model call needed to
 * recover structure the note was written from.
 */
export function chunkSections(
  sections: ReadonlyArray<{ title: string; bodyMd: string }>,
  targetTokens = 350,
  overlapTokens = 60
): SectionChunk[] {
  const out: SectionChunk[] = [];

  for (const section of sections) {
    // Keep the heading with its first chunk so a retrieved passage carries its
    // own context instead of arriving as an unlabelled paragraph.
    const withHeading = `## ${section.title}\n\n${section.bodyMd}`;

    for (const chunk of chunkMarkdown(withHeading, targetTokens, overlapTokens)) {
      out.push({ ...chunk, ordinal: out.length, sectionSlug: slugify(section.title) });
    }
  }

  return out;
}
