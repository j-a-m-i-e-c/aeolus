import { motion } from "framer-motion";

interface AeolusLogoProps {
  size?: number;
  className?: string;
}

export function AeolusLogo({ size = 120, className = "" }: AeolusLogoProps) {
  return (
    <div style={{ width: size, height: size }} className={className}>
      <motion.svg
        viewBox="0 0 200 200"
        width="100%"
        height="100%"
        initial="hidden"
        animate="visible"
      >
        {/* Gradient */}
        <defs>
          <linearGradient id="aeolusGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3BA4FF" />
            <stop offset="100%" stopColor="#5CE1E6" />
          </linearGradient>
        </defs>

        {/* Bold A */}
        <motion.path
          d="M100 30 L160 170 L130 170 L115 135 L85 135 L70 170 L40 170 Z"
          fill="url(#aeolusGradient)"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />

        {/* Wind Swirl (draw animation) */}
        <motion.path
          d="M40 120 C80 90, 120 90, 160 120 C120 150, 80 150, 40 120"
          fill="none"
          stroke="url(#aeolusGradient)"
          strokeWidth="10"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            duration: 1.4,
            ease: "easeInOut",
            delay: 0.3,
          }}
        />

        {/* Subtle floating motion */}
        <motion.g
          animate={{ rotate: [0, 2, 0] }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{ originX: "50%", originY: "50%" }}
        >
          {/* Secondary wind layer */}
          <motion.path
            d="M50 140 C90 110, 110 110, 150 140"
            fill="none"
            stroke="url(#aeolusGradient)"
            strokeWidth="6"
            strokeLinecap="round"
            opacity={0.6}
          />
        </motion.g>
      </motion.svg>
    </div>
  );
}