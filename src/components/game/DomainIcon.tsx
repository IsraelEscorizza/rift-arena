"use client";

import { Domain } from "@/lib/game/types";
import { cn } from "@/lib/utils";

const COLORS: Record<Domain, { bg: string; fg: string }> = {
  Fury: { bg: "#dc2626", fg: "#fef2f2" },
  Calm: { bg: "#16a34a", fg: "#f0fdf4" },
  Mind: { bg: "#2563eb", fg: "#eff6ff" },
  Body: { bg: "#ea580c", fg: "#fff7ed" },
  Chaos: { bg: "#9333ea", fg: "#faf5ff" },
  Order: { bg: "#eab308", fg: "#1c1917" },
  Colorless: { bg: "#52525b", fg: "#fafafa" },
};

/**
 * Stylized inline-SVG approximations of Riftbound's official domain glyphs.
 * Not the official assets (those are Riot copyright) — these are clean
 * simplified versions in the same color/silhouette family.
 */
export function DomainIcon({
  domain,
  size = 16,
  className,
}: {
  domain: Domain;
  size?: number;
  className?: string;
}) {
  const { bg, fg } = COLORS[domain];
  return (
    <span
      style={{ width: size, height: size, background: bg }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-black/40",
        className,
      )}
      title={domain}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 24 24"
        fill={fg}
        stroke={fg}
        strokeWidth="1.5"
      >
        {domain === "Fury" && (
          // Stylized flame
          <path d="M12 2c1 4 5 5 5 10a5 5 0 1 1-10 0c0-2 1-3 2-4-.2 1 .3 2 1.5 2.5C10.5 8 11 5 12 2z" />
        )}
        {domain === "Calm" && (
          // Leaf
          <path d="M5 19c0-8 5-14 14-14 0 9-5 14-14 14zM7 17c2-1 5-3 7-7" stroke={fg} fill="none" />
        )}
        {domain === "Mind" && (
          // Drop / eye
          <path d="M12 3c-3 4-6 8-6 11a6 6 0 0 0 12 0c0-3-3-7-6-11z" />
        )}
        {domain === "Body" && (
          // Shield
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
        )}
        {domain === "Chaos" && (
          // Triangle (chaos sigil)
          <path d="M12 3l9 16H3z" />
        )}
        {domain === "Order" && (
          // Sun rays
          <g>
            <circle cx="12" cy="12" r="4" />
            <path
              d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"
              stroke={fg}
              strokeWidth="2"
              fill="none"
            />
          </g>
        )}
        {domain === "Colorless" && (
          // Diamond
          <path d="M12 3l8 9-8 9-8-9z" />
        )}
      </svg>
    </span>
  );
}

/** Energy chip — generic numeric resource */
export function EnergyIcon({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-cyan-400",
        className,
      )}
      title="Energy"
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 24 24"
        fill="#67e8f9"
      >
        <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
      </svg>
    </span>
  );
}
