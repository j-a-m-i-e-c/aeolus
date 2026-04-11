interface AeolusLogoProps {
  size?: number;
  className?: string;
}

export function AeolusLogo({ size = 120, className = "" }: AeolusLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="Aeolus"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
