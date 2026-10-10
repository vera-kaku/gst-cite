/** Renders text with every figure (amount, rate, date number) marked, so readers can match figures between an answer and its source. */
export function Figures({ text }: { text: string }) {
  const parts = text.split(/(\$?\d[\d,]*(?:\.\d+)?%?)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="fig">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}
