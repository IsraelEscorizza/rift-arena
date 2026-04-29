"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { CardInstance } from "@/lib/game/types";
import { CARDS_BY_ID, getDomainHex } from "@/lib/cards/database";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface Props {
  card: CardInstance;
  faceDown?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const SIZES = {
  sm: { w: 70, h: 100 },
  md: { w: 110, h: 154 },
  lg: { w: 180, h: 252 },
};

export function GameCard({
  card,
  faceDown,
  selected,
  highlighted,
  size = "md",
  onClick,
  onContextMenu,
}: Props) {
  const { w, h } = SIZES[size];

  if (faceDown) {
    return (
      <div
        style={{ width: w, height: h }}
        className="relative shrink-0 rounded-lg border-2 border-fuchsia-500/40 bg-gradient-to-br from-indigo-950 to-fuchsia-950 shadow-lg"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-fuchsia-400/60" />
        </div>
      </div>
    );
  }

  const def = CARDS_BY_ID[card.defId];
  const domainColor = def
    ? getDomainHex(def.domains[0] ?? "Colorless")
    : "#888";
  const totalMight = (def?.might ?? 0) + (card.buffCount ?? 0) - (card.damage ?? 0);

  return (
    <motion.button
      whileHover={{ y: -4, scale: 1.04 }}
      animate={{
        rotate: card.exhausted ? 6 : 0,
        opacity: card.exhausted ? 0.7 : 1,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        width: w,
        height: h,
        borderColor: domainColor,
      }}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg border-2 bg-black shadow-lg transition",
        selected && "ring-4 ring-yellow-400",
        highlighted && "ring-4 ring-cyan-300",
      )}
    >
      {def?.imageUrl && (
        <Image
          src={def.imageUrl}
          alt={def.name}
          width={w}
          height={h}
          className="object-cover"
          unoptimized
        />
      )}
      {/* Damage overlay */}
      {card.damage > 0 && (
        <div className="absolute inset-x-1 bottom-1 rounded bg-red-700/90 px-1 text-center text-[10px] font-bold text-white">
          DMG {card.damage}
        </div>
      )}
      {/* Live might (units only) */}
      {def?.type === "Unit" && (
        <div className="absolute right-1 top-1 rounded bg-black/80 px-1 text-[10px] font-bold text-white">
          {totalMight}
        </div>
      )}
    </motion.button>
  );
}

export function CardTooltip({ defId }: { defId: string }) {
  const def = CARDS_BY_ID[defId];
  if (!def) return null;
  return (
    <div className="max-w-xs rounded border border-fuchsia-700 bg-black/95 p-2 text-xs text-white shadow-2xl">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold">{def.name}</span>
        <span className="text-[10px] opacity-60">
          {def.energy ?? "—"}E / {def.power ?? 0}P
        </span>
      </div>
      <div className="mb-1 text-[10px] opacity-70">
        {def.type} • {def.domains.join("/")} {def.might != null && `• ${def.might} Might`}
      </div>
      {def.rulesText && (
        <div className="whitespace-pre-line text-[11px] leading-tight opacity-90">
          {def.rulesText}
        </div>
      )}
    </div>
  );
}
