interface AeolusLogoProps {
  size?: number;
  className?: string;
}

export function AeolusLogo({ size = 120, className = "" }: AeolusLogoProps) {
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
    >
      <defs>
        <linearGradient id="aeolus-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3BA4FF" />
          <stop offset="100%" stopColor="#5CE1E6" />
        </linearGradient>
      </defs>
      {/* Bold A */}
      <path
        d="M100 30 L155 170 L128 170 L114 132 L86 132 L72 170 L45 170 Z M92 112 L108 112 L100 82 Z"
        fill="url(#aeolus-grad)"
        fillRule="evenodd"
      />
      {/* Wind curves */}
      <path
        d="M35 145 Q70 125 105 145 Q140 165 175 145"
        fill="none"
        stroke="url(#aeolus-grad)"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M50 160 Q80 145 110 160 Q140 175 170 160"
        fill="none"
        stroke="url(#aeolus-grad)"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}
