"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CardInstance,
  GameState,
  PlayerState,
  RuneInstance,
} from "@/lib/game/types";
import { CARDS_BY_ID, getDomainHex } from "@/lib/cards/database";
import { canPlayCard, canStandardMove } from "@/lib/game/engine";
import { useGameStore } from "@/store/gameStore";
import { GameCard, CardTooltip } from "./Card";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  Crown,
  Droplet,
  Layers,
  Shield as ShieldIcon,
  Trash2,
  Trophy,
  Zap,
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
  const recycleRune = useGameStore((s) => s.recycleRune);
  const move = useGameStore((s) => s.standardMove);

  const [selectedUnitUid, setSelectedUnitUid] = useState<string | null>(null);

  if (!state) return null;

  const human = state.players[0];
  const ai = state.players[1];
  const activeIsHuman = state.turnPlayerId === human.id;

  function handlePlayFromHand(uid: string) {
    if (canPlayCard(state!, uid)) playCard(uid);
  }

  function handleUnitClick(unit: CardInstance) {
    if (unit.controllerId !== human.id) return;
    if (selectedUnitUid === unit.uid) {
      setSelectedUnitUid(null);
    } else {
      setSelectedUnitUid(unit.uid);
    }
  }

  function handleBattlefieldClick(bfUid: string) {
    if (selectedUnitUid) {
      if (canStandardMove(state!, selectedUnitUid, bfUid)) {
        move(selectedUnitUid, bfUid);
        setSelectedUnitUid(null);
      }
    }
  }

  function handleBaseClick() {
    if (selectedUnitUid) {
      if (canStandardMove(state!, selectedUnitUid, null)) {
        move(selectedUnitUid, null);
        setSelectedUnitUid(null);
      }
    }
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
      <PlayerStrip player={ai} active={!activeIsHuman} faceDown />

      {/* Battlefields */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-3">
        <div className="flex w-full justify-center gap-6">
          {state.battlefields.map((bf) => (
            <BattlefieldView
              key={bf.uid}
              state={state}
              bfUid={bf.uid}
              selectedUnitUid={selectedUnitUid}
              onBattlefieldClick={() => handleBattlefieldClick(bf.uid)}
              onUnitClick={handleUnitClick}
            />
          ))}
        </div>
      </main>

      {/* Human panel */}
      <PlayerStrip
        player={human}
        active={activeIsHuman}
        selectedUnitUid={selectedUnitUid}
        onUnitClick={handleUnitClick}
        onBaseClick={handleBaseClick}
        canMoveToBase={
          selectedUnitUid
            ? canStandardMove(state, selectedUnitUid, null)
            : false
        }
        onTapRune={tapRune}
        onRecycleRune={recycleRune}
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

      {/* Move hint */}
      {selectedUnitUid && (
        <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded bg-yellow-600 px-3 py-1 text-xs font-bold shadow-lg">
          Click a battlefield to move there, or your base to return.
          <button
            onClick={() => setSelectedUnitUid(null)}
            className="ml-2 underline"
          >
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
  selectedUnitUid,
  onUnitClick,
  onBaseClick,
  canMoveToBase,
  onTapRune,
  onRecycleRune,
}: {
  player: PlayerState;
  active: boolean;
  faceDown?: boolean;
  selectedUnitUid?: string | null;
  onUnitClick?: (u: CardInstance) => void;
  onBaseClick?: () => void;
  canMoveToBase?: boolean;
  onTapRune?: (uid: string) => void;
  onRecycleRune?: (uid: string) => void;
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
            <div className="mt-0.5 flex items-center gap-1 text-cyan-300">
              <Zap className="h-3 w-3" /> {player.pool.energy} energy
            </div>
            <div className="flex flex-wrap gap-0.5 text-[10px]">
              {Object.entries(player.pool.power).map(
                ([d, n]) =>
                  n > 0 && (
                    <span
                      key={d}
                      style={{ background: getDomainHex(d as any) }}
                      className="rounded px-1 font-bold"
                    >
                      {d[0]}:{n}
                    </span>
                  ),
              )}
            </div>
          </>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] opacity-70">
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

      {/* Base units (units at home) */}
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
                selected={selectedUnitUid === u.uid}
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
          <div className="mt-1 flex flex-wrap gap-1">
            {player.base.runes.map((r) => (
              <RuneChip
                key={r.uid}
                rune={r}
                onTap={() => onTapRune?.(r.uid)}
                onRecycle={() => onRecycleRune?.(r.uid)}
                disabled={!active}
              />
            ))}
          </div>
        </div>
      )}
      {faceDown && (
        <div className="w-72 shrink-0 border-l border-fuchsia-900/30 pl-3 text-[10px] opacity-50">
          {player.base.runes.length} runes channeled
        </div>
      )}
    </div>
  );
}

function RuneChip({
  rune,
  onTap,
  onRecycle,
  disabled,
}: {
  rune: RuneInstance;
  onTap: () => void;
  onRecycle: () => void;
  disabled: boolean;
}) {
  const color = getDomainHex(rune.domain);
  return (
    <div
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={onTap}
        disabled={disabled || rune.exhausted}
        title="Tap for [1] energy"
        style={{ background: color }}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-black shadow",
          rune.exhausted && "opacity-40",
          disabled && "cursor-not-allowed",
        )}
      >
        {rune.domain[0]}
      </button>
      <button
        onClick={onRecycle}
        disabled={disabled}
        title="Recycle for power"
        className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-fuchsia-700 text-[8px] font-bold hover:bg-fuchsia-500 disabled:opacity-30"
      >
        ↻
      </button>
    </div>
  );
}

function BattlefieldView({
  state,
  bfUid,
  selectedUnitUid,
  onBattlefieldClick,
  onUnitClick,
}: {
  state: GameState;
  bfUid: string;
  selectedUnitUid: string | null;
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
    selectedUnitUid !== null &&
    canStandardMove(state, selectedUnitUid, bfUid);

  return (
    <button
      onClick={onBattlefieldClick}
      className={cn(
        "group flex w-72 flex-col rounded-xl border-2 bg-black/50 p-2 text-left",
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
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-bold">{def?.name}</span>
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
      <div className="min-h-[5rem] rounded bg-rose-950/30 p-1.5">
        <div className="text-[9px] uppercase opacity-50">AI units here</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {aiUnits.map((u) => (
            <div key={u.uid}>
              <GameCard card={u} size="sm" />
            </div>
          ))}
          {aiUnits.length === 0 && (
            <span className="text-[10px] opacity-30">—</span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="my-1 flex items-center justify-center">
        <ShieldIcon className="h-3 w-3 opacity-40" />
      </div>

      {/* Human side */}
      <div className="min-h-[5rem] rounded bg-emerald-950/30 p-1.5">
        <div className="text-[9px] uppercase opacity-50">Your units here</div>
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
                selected={selectedUnitUid === u.uid}
              />
            </div>
          ))}
          {humanUnits.length === 0 && (
            <span className="text-[10px] opacity-30">—</span>
          )}
        </div>
      </div>
    </button>
  );
}
