"use client";

import { motion } from "framer-motion";
import { CardInstance } from "@/lib/game/types";
import { getCard } from "@/lib/cards/database";
import { cn, FACTION_COLORS, FACTION_GLOW } from "@/lib/utils";
import { Sparkles, Sword, Heart, Droplet, Zap } from "lucide-react";

interface Props {
  card: CardInstance;
  faceDown?: boolean;
  selected?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  small?: boolean;
  onClick?: () => void;
}

export function GameCard({
  card,
  faceDown,
  selected,
  attacking,
  blocking,
  small,
  onClick,
}: Props) {
  if (faceDown) {
    return (
      <div
        className={cn(
          "relative rounded-lg border-2 border-fuchsia-500/40 bg-gradient-to-br from-indigo-950 to-fuchsia-950 shadow-lg",
          small ? "h-20 w-14" : "h-44 w-32",
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-fuchsia-400/60" />
        </div>
      </div>
    );
  }

  const def = getCard(card.defId);
  const faction = FACTION_COLORS[def.faction] ?? FACTION_COLORS.neutral;
  const glow = FACTION_GLOW[def.faction] ?? FACTION_GLOW.neutral;
  const totalAttack = (def.attack ?? 0) + card.buffs.attack;
  const totalHealth = (def.health ?? 0) + card.buffs.health - card.damage;

  return (
    <motion.button
      whileHover={{ y: small ? -4 : -8, scale: small ? 1.02 : 1.04 }}
      animate={{
        rotate: card.tapped ? 90 : 0,
        opacity: card.summoningSick ? 0.75 : 1,
      }}
      onClick={onClick}
      className={cn(
        "group relative rounded-lg border-2 bg-gradient-to-br p-1.5 text-left text-white shadow-lg transition",
        faction,
        glow,
        selected && "ring-4 ring-yellow-400",
        attacking && "ring-4 ring-red-500",
        blocking && "ring-4 ring-cyan-400",
        small ? "h-20 w-14" : "h-44 w-32",
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-bold">
        <span className="truncate">{small ? "" : def.name}</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60">
          {def.cost}
        </span>
      </div>

      {!small && (
        <div className="mt-1 flex h-16 items-center justify-center rounded bg-black/30 text-2xl">
          {def.type === "unit" || def.type === "champion" ? (
            <Sword className="h-8 w-8 opacity-70" />
          ) : def.type === "spell" ? (
            <Zap className="h-8 w-8 opacity-70" />
          ) : (
            <Droplet className="h-8 w-8 opacity-70" />
          )}
        </div>
      )}

      {!small && (
        <div className="mt-1 line-clamp-3 text-[9px] leading-tight opacity-90">
          {def.text}
        </div>
      )}

      {(def.type === "unit" || def.type === "champion") && (
        <div className="absolute bottom-1 right-1 flex gap-1 text-[10px] font-extrabold">
          <span className="flex items-center gap-0.5 rounded bg-orange-700 px-1">
            <Sword className="h-3 w-3" />
            {totalAttack}
          </span>
          <span className="flex items-center gap-0.5 rounded bg-red-700 px-1">
            <Heart className="h-3 w-3" />
            {totalHealth}
          </span>
        </div>
      )}
    </motion.button>
  );
}
