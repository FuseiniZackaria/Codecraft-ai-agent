import { useId } from "react";

/**
 * SectionDivider — the "Anointing Line"
 *
 * A glowing brass-gold gradient stroke with a hand-tapered oil-drop
 * flourish, marking transitions between sections across the site.
 * Echoes the pouring/anointing of oil — the line "runs" left to right,
 * tapering thin-thick-thin, with a single drop falling from its lowest point.
 */
export default function SectionDivider({
  label,
  flipped = false,
  compact = false,
  className = "",
}) {
  const uid = useId().replace(/:/g, "");
  const gradId = `anoint-grad-${uid}`;
  const glowId = `anoint-glow-${uid}`;
  const height = compact ? 46 : 72;

  return (
    <div
      className={`anointing-divider ${flipped ? "is-flipped" : ""} ${
        compact ? "is-compact" : ""
      } ${className}`}
      role="separator"
      aria-hidden={label ? "false" : "true"}
    >
      {label && <span className="anointing-divider__label">{label}</span>}

      <svg
        className="anointing-divider__svg"
        viewBox={`0 0 600 ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C9A24B" stopOpacity="0" />
            <stop offset="14%" stopColor="#C9A24B" stopOpacity="0.55" />
            <stop offset="50%" stopColor="#EFE7D6" stopOpacity="1" />
            <stop offset="86%" stopColor="#C9A24B" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#C9A24B" stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-40%" y="-200%" width="180%" height="500%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* the tapered line itself */}
        <path
          className="anointing-divider__stroke"
          d={`M10 ${height / 2}
              C 150 ${height / 2 - (compact ? 6 : 10)},
                260 ${height / 2 + (compact ? 10 : 16)},
                330 ${height / 2 + (compact ? 4 : 6)}
              S 470 ${height / 2 - (compact ? 8 : 12)},
                590 ${height / 2}`}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="2.4"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        />

        {/* the falling oil drop */}
        <g className="anointing-divider__drop-wrap">
          <path
            className="anointing-divider__drop"
            d="M0 -7 C 3.6 -2, 4.4 2.6, 0 6.4 C -4.4 2.6, -3.6 -2, 0 -7 Z"
            fill="#C9A24B"
            filter={`url(#${glowId})`}
            transform={`translate(330 ${height / 2 + (compact ? 4 : 6)})`}
          />
        </g>
      </svg>

      <style>{`
        .anointing-divider {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 3.25rem 0;
          padding: 0.25rem 0;
          user-select: none;
        }
        .anointing-divider.is-compact {
          margin: 1.75rem 0;
        }
        .anointing-divider.is-flipped {
          transform: scaleX(-1);
        }
        .anointing-divider.is-flipped .anointing-divider__label {
          transform: scaleX(-1);
        }
        .anointing-divider__svg {
          display: block;
          overflow: visible;
        }
        .anointing-divider__stroke {
          stroke-dasharray: 640;
          stroke-dashoffset: 640;
          animation: anoint-draw 2.2s cubic-bezier(0.22, 0.8, 0.28, 1) forwards;
        }
        .anointing-divider__drop-wrap {
          opacity: 0;
          animation: anoint-drop-appear 0.5s ease-out 1.6s forwards;
        }
        .anointing-divider__drop {
          transform-box: fill-box;
          transform-origin: center;
          animation: anoint-drop-fall 2.6s ease-in 1.7s infinite;
        }
        .anointing-divider__label {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          background: var(--divider-label-bg, #FAF7F0);
          padding: 0 1rem;
          font-family: "Fraunces", serif;
          font-style: italic;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          font-size: 0.72rem;
          color: #7A2436;
          white-space: nowrap;
          z-index: 1;
        }

        @keyframes anoint-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes anoint-drop-appear {
          to { opacity: 1; }
        }
        @keyframes anoint-drop-fall {
          0% { transform: translateY(0) scaleY(1); opacity: 0.95; }
          8% { transform: translateY(2px) scaleY(1.08); }
          22% { transform: translateY(15px) scaleY(0.85); opacity: 0.5; }
          26% { transform: translateY(16px) scaleY(0.4); opacity: 0; }
          27%, 100% { transform: translateY(0) scaleY(1); opacity: 0; }
          92% { opacity: 0; }
          96% { opacity: 0.95; transform: translateY(0) scaleY(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .anointing-divider__stroke {
            stroke-dashoffset: 0;
            animation: none;
          }
          .anointing-divider__drop-wrap {
            opacity: 1;
            animation: none;
          }
          .anointing-divider__drop {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}