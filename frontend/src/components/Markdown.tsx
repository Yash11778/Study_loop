import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for the subset the model is told to
 * produce: headings, paragraphs, lists, bold, and inline code. Pulling in a
 * full parser plus a sanitiser would be more code than the whole feature, and
 * anything outside this subset renders as plain text rather than as raw HTML --
 * which is also what keeps model output from injecting markup.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  /**
   * Bold and inline code only -- single-asterisk emphasis is deliberately NOT
   * supported.
   *
   * These notes write formulae in plain text, so "F = G*m1*m2/r^2" is full of
   * asterisks that mean multiplication. Treating them as emphasis silently
   * rewrote the physics: the middle of the equation rendered as italics and the
   * operators vanished. Occasional literal asterisks around a word are a far
   * smaller problem than mangled formulae.
   */
  /**
   * Bold, inline code, and emphasis -- but emphasis only where an asterisk
   * cannot be multiplication.
   *
   * These notes write formulae in plain text, so "F = G*m1*m2/r^2" is full of
   * asterisks that mean multiply. A naive single-asterisk rule rewrote the
   * physics: the middle of the equation became italics and the operators
   * vanished. The opening asterisk here must follow a space, a bracket or the
   * start of the line, which "G*m1" never does, while "*W*" always does.
   */
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|(?<=^|[\s(])\*[A-Za-z][^*\n]{0,40}\*(?=[\s.,;:)]|$))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-ink">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded border border-line bg-sunk px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = match.index + token.length;
    i += 1;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ children }: { children: string }) {
  const blocks = children.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <>
      {blocks.map((block, i) => {
        const key = `b${i}`;

        // Four or more hashes render at the same level as three; the notes do
        // not nest deeper than that, and "#### Why Work Is a Scalar" was
        // otherwise printed with its hashes intact.
        if (/^#{4,}\s/.test(block)) {
          const text = block.replace(/^#{4,}\s+/, "");
          return <h4 key={key} className="mt-5 font-display text-[15px] font-bold text-ink">{inline(text, key)}</h4>;
        }
        if (block.startsWith("### ")) {
          return <h3 key={key} className="mt-6 font-display text-base font-bold text-ink">{inline(block.slice(4), key)}</h3>;
        }
        if (block.startsWith("## ")) {
          return <h2 key={key} className="mt-8 font-display text-xl font-bold tracking-tight text-ink">{inline(block.slice(3), key)}</h2>;
        }
        if (block.startsWith("# ")) {
          return <h2 key={key} className="mt-8 font-display text-2xl font-extrabold tracking-tight text-ink">{inline(block.slice(2), key)}</h2>;
        }

        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={key} className="mt-3 list-disc space-y-1 pl-5 text-ink-soft">
              {lines.map((l, j) => <li key={`${key}-${j}`}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${key}-${j}`)}</li>)}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return (
            <ol key={key} className="mt-3 list-decimal space-y-1 pl-5 text-ink-soft">
              {lines.map((l, j) => <li key={`${key}-${j}`}>{inline(l.replace(/^\s*\d+\.\s+/, ""), `${key}-${j}`)}</li>)}
            </ol>
          );
        }

        return (
          <p key={key} className="mt-3 leading-relaxed text-ink-soft">
            {lines.map((l, j) => (
              <Fragment key={`${key}-${j}`}>
                {j > 0 && <br />}
                {inline(l, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
