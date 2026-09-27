// frontend/src/components/AeolusWordmark.tsx — compact product wordmark used beside the Aeolus glyph.
//
// Manrope Bold is the wordmark face, self-hosted at the single 700 weight it uses
// (imported in main.tsx). It is deliberately NOT the interface face: Inter remains
// the UI stack in tailwind.config.js, and this component is the only place Manrope
// is applied, so the wordmark reads as a mark rather than as a heading style that
// might spread through the dashboard.
//
// The stack falls back through the system UI sans rather than bare `sans-serif`, so
// a first paint before the woff2 lands is a near miss rather than a serif or an
// arbitrary default.

const WORDMARK_FONT =
  '"Manrope", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

interface AeolusWordmarkProps {
  compact?: boolean;
  className?: string;
}

export function AeolusWordmark({ compact = false, className = "" }: AeolusWordmarkProps) {
  return (
    <span
      className={`${compact ? "text-base" : "text-[1.45rem]"} leading-none text-primary ${className}`}
      style={{
        fontFamily: WORDMARK_FONT,
        fontWeight: 700,
        letterSpacing: "0.015em",
      }}
    >
      Aeolus
    </span>
  );
}
