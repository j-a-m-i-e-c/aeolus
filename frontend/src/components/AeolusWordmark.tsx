// frontend/src/components/AeolusWordmark.tsx — compact product wordmark used beside the Aeolus glyph.

interface AeolusWordmarkProps {
  compact?: boolean;
  className?: string;
}

export function AeolusWordmark({ compact = false, className = "" }: AeolusWordmarkProps) {
  return (
    <span
      className={`${compact ? "text-base" : "text-[1.32rem]"} leading-none text-primary ${className}`}
      style={{
        fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
        fontWeight: 600,
        letterSpacing: "-0.035em",
      }}
    >
      Aeolus
    </span>
  );
}
