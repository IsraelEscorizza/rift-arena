"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  CardInstance,
  GameState,
  PlayerState,
  RuneInstance,
} from "@/lib/game/types";
import { CARDS_BY_ID, getDomainHex } from "@/lib/cards/database";
import {
  canPlayCard,
  canStandardMove,
  canUntapRune,
} from "@/lib/game/engine";
import { useGameStore } from "@/store/gameStore";
import { GameCard } from "./Card";
import { DomainIcon, EnergyIcon } from "./DomainIcon";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  Crown,
  Layers,
  Shield as ShieldIcon,
  Trash2,
  Trophy,
} from "lucide-react";

const PHASE_LABEL: Record<string, string> = {
  awaken: "Awaken",
  beginning: "Beginning",
  channel: "Channel",
  draw: "Draw",
  main: "Main Phase",
  ending: "Ending",
};

export function GameBoard() {
  const state = useGameStore((s) => s.state);
  const playCard = useGameStore((s) => s.playCard);
  const next = useGameStore((s) => s.nextPhase);
  const tapRune = useGameStore((s) => s.tapRune);
  const untapRune = useGameStore((s) => s.untapRune);
  const recycleRune = useGameStore((s) => s.recycleRune);
  const moveMany = useGameStore((s) => s.standardMoveMultiple);

  // Set of unit UIDs the player has selected for batch movement
  const [selected, setSelected] = useState<string[]>([]);

  if (!state) return null;

  const human = state.players[0];
  const ai = state.players[1];
  const activeIsHuman = state.turnPlayerId === human.id;

  function toggleSelect(uid: string) {
    setSelected((cur) =>
      cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid],
    );
  }
  function clearSelection() {
    setSelected([]);
  }

  function handlePlayFromHand(uid: string) {
    if (canPlayCard(state!, uid)) playCard(uid);
  }

  function handleUnitClick(unit: CardInstance) {
    if (unit.controllerId !== human.id) return;
    if (unit.exhausted) return;
    toggleSelect(unit.uid);
  }

  function moveSelectionTo(destBfUid: string | null) {
    if (selected.length === 0) return;
    // Filter to legal movers only
    const legal = selected.filter((uid) =>
      canStandardMove(state!, uid, destBfUid),
    );
    if (legal.length === 0) return;
    moveMany(legal, destBfUid);
    clearSelection();
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] text-white">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-fuchsia-900/40 bg-black/60 px-3 py-1.5">
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded bg-fuchsia-900/60 px-2 py-0.5 font-bold uppercase tracking-wider">
            Turn {state.turnNumber}
          </span>
          <span className="rounded bg-fuchsia-700 px-2 py-0.5 font-bold">
            {PHASE_LABEL[state.phase]}
          </span>
          <span className="opacity-60">
            Active: {state.players.find((p) => p.id === state.turnPlayerId)?.name}
          </span>
        </div>
        <button
          onClick={() => next()}
          disabled={!activeIsHuman || state.phase !== "main" || !!state.winnerId}
          className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs font-bold hover:bg-emerald-600 disabled:opacity-40"
        >
          End Turn <ArrowRight className="h-3 w-3" />
        </button>
      </header>

      {/* Opponent panel */}
      <PlayerStrip
        player={ai}
        active={!activeIsHuman}
        faceDown
        selectedUnitUids={[]}
      />

      {/* Battlefields */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-3">
        <div className="flex w-full justify-center gap-6">
          {state.battlefields.map((bf) => (
            <BattlefieldView
              key={bf.uid}
              state={state}
              bfUid={bf.uid}
              selectedUnitUids={selected}
              onBattlefieldClick={() => moveSelectionTo(bf.uid)}
              onUnitClick={handleUnitClick}
            />
          ))}
        </div>
      </main>

      {/* Human panel */}
      <PlayerStrip
        player={human}
        active={activeIsHuman}
        selectedUnitUids={selected}
        onUnitClick={handleUnitClick}
        onBaseClick={() => moveSelectionTo(null)}
        canMoveToBase={
          selected.length > 0 &&
          selected.some((uid) => canStandardMove(state, uid, null))
        }
        onTapRune={tapRune}
        onUntapRune={untapRune}
        onRecycleRune={recycleRune}
        canUntap={(uid) => canUntapRune(state, uid)}
      />

      {/* Hand */}
      <div className="flex min-h-[12rem] items-end justify-center gap-1.5 overflow-x-auto bg-black/40 p-2">
        {human.hand.map((c) => {
          const playable = canPlayCard(state, c.uid);
          return (
            <motion.div
              key={c.uid}
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: playable ? 1 : 0.55 }}
              className={cn("relative", !playable && "grayscale-[40%]")}
            >
              <GameCard
                card={c}
                size="md"
                onClick={() => handlePlayFromHand(c.uid)}
              />
            </motion.div>
          );
        })}
        {human.championZone && (
          <motion.div className="ml-3 border-l border-fuchsia-700/40 pl-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-fuchsia-300">
              Champion
            </div>
            <GameCard
              card={human.championZone}
              size="md"
              onClick={() =>
                handlePlayFromHand(human.championZone!.uid)
              }
            />
          </motion.div>
        )}
      </div>

      {/* Log overlay */}
      <div className="absolute right-2 top-14 max-h-[60vh] w-72 overflow-y-auto rounded border border-fuchsia-900/40 bg-black/80 p-2 text-[11px]">
        <div className="mb-1 flex items-center gap-1 font-bold text-fuchsia-300">
          <BookOpen className="h-3 w-3" /> Game Log
        </div>
        {state.log.slice(-40).reverse().map((entry, i) => (
          <div key={i} className="border-b border-white/5 py-0.5 opacity-80">
            {entry}
          </div>
        ))}
      </div>

      {/* Selection hint */}
      {selected.length > 0 && (
        <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded bg-yellow-600 px-3 py-1 text-xs font-bold shadow-lg">
          {selected.length} unit{selected.length > 1 ? "s" : ""} selected — click a
          battlefield or your base to move them all.
          <button onClick={clearSelection} className="ml-2 underline">
            cancel
          </button>
        </div>
      )}

      {/* Winner overlay */}
      <AnimatePresence>
        {state.winnerId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/85"
          >
            <Trophy className="h-20 w-20 text-yellow-300" />
            <h1 className="mt-3 text-6xl font-black text-yellow-300">
              {state.winnerId === human.id ? "VICTORY" : "DEFEAT"}
            </h1>
            <p className="mt-2 text-lg opacity-80">
              {state.players.find((p) => p.id === state.winnerId)?.name} reaches{" "}
              {state.victoryScore} points.
            </p>
            <a
              href="/"
              className="mt-6 rounded bg-fuchsia-700 px-6 py-2 font-bold hover:bg-fuchsia-600"
            >
              Back to Menu
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayerStrip({
  player,
  active,
  faceDown,
  selectedUnitUids,
  onUnitClick,
  onBaseClick,
  canMoveToBase,
  onTapRune,
  onUntapRune,
  onRecycleRune,
  canUntap,
}: {
  player: PlayerState;
  active: boolean;
  faceDown?: boolean;
  selectedUnitUids: string[];
  onUnitClick?: (u: CardInstance) => void;
  onBaseClick?: () => void;
  canMoveToBase?: boolean;
  onTapRune?: (uid: string) => void;
  onUntapRune?: (uid: string) => void;
  onRecycleRune?: (uid: string) => void;
  canUntap?: (uid: string) => boolean;
}) {
  const baseUnits = player.base.units.filter((u) => !u.battlefieldId);
  return (
    <div
      className={cn(
        "flex items-stretch gap-3 border-y border-fuchsia-900/40 px-3 py-2",
        active && "bg-yellow-900/10",
        canMoveToBase && "ring-2 ring-yellow-400",
      )}
      onClick={onBaseClick}
    >
      {/* Stats column */}
      <div className="w-32 shrink-0 text-xs">
        <div className="flex items-center gap-2 font-bold">
          <Crown className="h-3 w-3 text-yellow-300" /> {player.name}
        </div>
        <div className="mt-1 flex items-center gap-1 text-yellow-300">
          <Trophy className="h-3 w-3" /> {player.points} pts
        </div>
        {!faceDown && (
          <>
            <div className="mt-1 flex items-center gap-1 text-cyan-200">
              <EnergyIcon size={14} />
              <span className="font-bold">{player.pool.energy}</span> energy
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(player.pool.power).map(
                ([d, n]) =>
                  n > 0 && (
                    <span
                      key={d}
                      className="flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px]"
                    >
                      <DomainIcon domain={d as any} size={12} />
                      <span className="font-bold">{n}</span>
                    </span>
                  ),
              )}
            </div>
          </>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] opacity-70">
          <span title="Hand">
            <Layers className="inline h-3 w-3" /> {player.hand.length}
          </span>
          <span title="Main Deck">M:{player.mainDeck.length}</span>
          <span title="Rune Deck">R:{player.runeDeck.length}</span>
          <span title="Trash">
            <Trash2 className="inline h-3 w-3" /> {player.trash.length}
          </span>
        </div>
      </div>

      {/* Base units */}
      <div className="flex-1 border-l border-fuchsia-900/30 pl-3">
        <div className="text-[10px] uppercase tracking-wide opacity-50">
          Base — units
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {baseUnits.length === 0 && (
            <span className="text-xs opacity-30">empty</span>
          )}
          {baseUnits.map((u) => (
            <div
              key={u.uid}
              onClick={(e) => {
                e.stopPropagation();
                onUnitClick?.(u);
              }}
            >
              <GameCard
                card={u}
                size="sm"
                selected={selectedUnitUids.includes(u.uid)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Runes */}
      {!faceDown && (
        <div className="w-72 shrink-0 border-l border-fuchsia-900/30 pl-3">
          <div className="text-[10px] uppercase tracking-wide opacity-50">
            Runes ({player.base.runes.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <AnimatePresence>
              {player.base.runes.map((r) => {
                const refundable = canUntap?.(r.uid) ?? false;
                return (
                  <RuneChip
                    key={r.uid}
                    rune={r}
                    onTap={() => onTapRune?.(r.uid)}
                    onUntap={() => onUntapRune?.(r.uid)}
                    onRecycle={() => onRecycleRune?.(r.uid)}
                    disabled={!active}
                    refundable={refundable}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
      {faceDown && (
        <div className="flex w-72 shrink-0 items-center gap-1 border-l border-fuchsia-900/30 pl-3">
          {player.base.runes.map((r) => (
            <DomainIcon key={r.uid} domain={r.domain} size={18} />
          ))}
          {player.base.runes.length === 0 && (
            <span className="text-[10px] opacity-50">no runes</span>
          )}
        </div>
      )}
    </div>
  );
}

function RuneChip({
  rune,
  onTap,
  onUntap,
  onRecycle,
  disabled,
  refundable,
}: {
  rune: RuneInstance;
  onTap: () => void;
  onUntap: () => void;
  onRecycle: () => void;
  disabled: boolean;
  refundable: boolean;
}) {
  const def = CARDS_BY_ID[rune.defId];
  // Click toggles tap state
  const handleMainClick = () => {
    if (rune.exhausted) {
      if (refundable) onUntap();
    } else {
      onTap();
    }
  };
  const mainDisabled = disabled || (rune.exhausted && !refundable);
  const tooltip = rune.exhausted
    ? refundable
      ? "Click to untap (refund 1 energy)"
      : "Tapped — energy already spent"
    : "Click to tap for 1 energy";

  return (
    <motion.div
      layout
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{
        x: -40,
        opacity: 0,
        rotate: -15,
        transition: { duration: 0.4 },
      }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <motion.button
        onClick={handleMainClick}
        disabled={mainDisabled}
        title={tooltip}
        animate={{
          rotate: rune.exhausted ? 90 : 0,
          opacity: mainDisabled ? 0.4 : rune.exhausted ? 0.7 : 1,
          boxShadow: rune.exhausted
            ? "0 0 0 0px rgba(0,0,0,0)"
            : `0 0 12px 2px ${getDomainHex(rune.domain)}aa`,
        }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className={cn(
          "relative h-12 w-12 overflow-hidden rounded-md border-2 border-black/40",
          refundable && rune.exhausted && "ring-2 ring-yellow-300",
          mainDisabled && "cursor-not-allowed",
        )}
        style={{ background: getDomainHex(rune.domain) }}
      >
        {def?.imageUrl ? (
          <Image
            src={def.imageUrl}
            alt={def.name}
            width={48}
            height={48}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <DomainIcon domain={rune.domain} size={28} />
        )}
        {/* Domain corner badge */}
        <span className="absolute right-0 top-0">
          <DomainIcon domain={rune.domain} size={14} />
        </span>
      </motion.button>

      {/* Recycle button */}
      <motion.button
        onClick={onRecycle}
        disabled={disabled}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85, rotate: 360 }}
        transition={{ duration: 0.4 }}
        title="Recycle for 1 power of this domain (sends rune to deck)"
        className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-700 text-[9px] font-bold ring-1 ring-black hover:bg-fuchsia-500 disabled:opacity-30"
      >
        ↻
      </motion.button>
    </motion.div>
  );
}

function BattlefieldView({
  state,
  bfUid,
  selectedUnitUids,
  onBattlefieldClick,
  onUnitClick,
}: {
  state: GameState;
  bfUid: string;
  selectedUnitUids: string[];
  onBattlefieldClick: () => void;
  onUnitClick: (u: CardInstance) => void;
}) {
  const bf = state.battlefields.find((b) => b.uid === bfUid)!;
  const def = state.battlefieldDefs[bf.defId];

  const aiUnits = state.players[1].base.units.filter(
    (u) => u.battlefieldId === bfUid,
  );
  const humanUnits = state.players[0].base.units.filter(
    (u) => u.battlefieldId === bfUid,
  );

  const controllerName =
    bf.controllerId === "p1"
      ? "You"
      : bf.controllerId === "p2"
        ? "AI"
        : "Uncontrolled";

  const canMoveHere =
    selectedUnitUids.length > 0 &&
    selectedUnitUids.some((uid) => canStandardMove(state, uid, bfUid));

  return (
    <button
      onClick={onBattlefieldClick}
      className={cn(
        "group relative flex w-72 flex-col rounded-xl border-2 bg-black/60 p-2 text-left overflow-hidden",
        bf.contested
          ? "border-red-500"
          : bf.controllerId === "p1"
            ? "border-emerald-500"
            : bf.controllerId === "p2"
              ? "border-rose-600"
              : "border-fuchsia-900",
        canMoveHere && "ring-4 ring-yellow-400",
      )}
    >
      {/* Background image of the battlefield */}
      {def?.imageUrl && (
        <div className="pointer-events-none absolute inset-0 opacity-30 brightness-90">
          <Image
            src={def.imageUrl}
            alt=""
            fill
            unoptimized
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/70" />
        </div>
      )}

      <div className="relative mb-1 flex items-center justify-between text-xs">
        <span className="font-bold drop-shadow">{def?.name}</span>
        <span
          className={cn(
            "rounded px-1.5 text-[10px] font-bold",
            bf.contested
              ? "bg-red-700"
              : bf.controllerId
                ? "bg-emerald-700"
                : "bg-zinc-700",
          )}
        >
          {bf.contested ? "CONTESTED" : controllerName}
        </span>
      </div>

      {/* AI side */}
      <div className="relative min-h-[5rem] rounded bg-rose-950/50 p-1.5 backdrop-blur-sm">
        <div className="text-[9px] uppercase opacity-70">AI units here</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {aiUnits.map((u) => (
            <div key={u.uid}>
              <GameCard card={u} size="sm" />
            </div>
          ))}
          {aiUnits.length === 0 && (
            <span className="text-[10px] opacity-40">—</span>
          )}
        </div>
      </div>

      <div className="relative my-1 flex items-center justify-center">
        <ShieldIcon className="h-3 w-3 opacity-40" />
      </div>

      {/* Human side */}
      <div className="relative min-h-[5rem] rounded bg-emerald-950/50 p-1.5 backdrop-blur-sm">
        <div className="text-[9px] uppercase opacity-70">Your units here</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {humanUnits.map((u) => (
            <div
              key={u.uid}
              onClick={(e) => {
                e.stopPropagation();
                onUnitClick(u);
              }}
            >
              <GameCard
                card={u}
                size="sm"
                selected={selectedUnitUids.includes(u.uid)}
              />
            </div>
          ))}
          {humanUnits.length === 0 && (
            <span className="text-[10px] opacity-40">—</span>
          )}
        </div>
      </div>
    </button>
  );
}
