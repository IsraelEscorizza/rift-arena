"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  CardInstance,
  GameState,
  PlayerState,
  RuneInstance,
} from "@/lib/game/types";
import { CARDS_BY_ID, getDomainHex } from "@/lib/cards/database";
import {
  canActivateLegend,
  canPlayCard,
  canStandardMove,
  canUntapRune,
  getLegendActivationLabel,
  isValidRecycleForPending,
} from "@/lib/game/engine";
import { hasActivatedAbility } from "@/lib/game/abilities/registry";
import { useGameStore } from "@/store/gameStore";
import { GameCard } from "./Card";
import { useCardZoom } from "./CardZoom";
import { DomainIcon, EnergyIcon } from "./DomainIcon";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BookOpen,
  Layers,
  Sparkle,
  Trash2,
  Trophy,
  X,
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
  const attemptPlay = useGameStore((s) => s.attemptPlayCard);
  const recycleForPending = useGameStore((s) => s.recycleForPending);
  const cancelPending = useGameStore((s) => s.cancelPendingPlay);
  const activateLegend = useGameStore((s) => s.activateLegend);
  const next = useGameStore((s) => s.nextPhase);
  const tapRune = useGameStore((s) => s.tapRune);
  const untapRune = useGameStore((s) => s.untapRune);
  const recycleRune = useGameStore((s) => s.recycleRune);
  const moveMany = useGameStore((s) => s.standardMoveMultiple);

  const [selected, setSelected] = useState<string[]>([]);

  if (!state) return null;

  const human = state.players[0];
  const ai = state.players[1];
  const activeIsHuman = state.turnPlayerId === human.id;
  const pending = state.pendingPlay;

  function toggleSelect(uid: string) {
    setSelected((cur) =>
      cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid],
    );
  }
  function clearSelection() {
    setSelected([]);
  }
  function handleUnitClick(unit: CardInstance) {
    if (unit.controllerId !== human.id) return;
    if (unit.exhausted) return;
    toggleSelect(unit.uid);
  }
  function moveSelectionTo(destBfUid: string | null) {
    if (selected.length === 0) return;
    const legal = selected.filter((uid) =>
      canStandardMove(state!, uid, destBfUid),
    );
    if (legal.length === 0) return;
    moveMany(legal, destBfUid);
    clearSelection();
  }
  function tryPlayHandCard(uid: string) {
    if (canPlayCard(state!, uid) || canPotentiallyAfford(state!, uid)) {
      attemptPlay(uid);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] text-white">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-fuchsia-900/40 bg-black/60 px-3 py-1.5">
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
        <div className="text-[10px] opacity-50">
          Right-click any card to zoom · drag dividers to resize
        </div>
        <button
          onClick={() => next()}
          disabled={!activeIsHuman || state.phase !== "main" || !!state.winnerId}
          className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-xs font-bold hover:bg-emerald-600 disabled:opacity-40"
        >
          End Turn <ArrowRight className="h-3 w-3" />
        </button>
      </header>

      {/* Resizable layout */}
      <PanelGroup
        direction="horizontal"
        autoSaveId="riftarena.layout.h.v2"
        className="flex-1"
      >
        {/* LEFT: legend+champion full vertical */}
        <Panel defaultSize={16} minSize={12} maxSize={28} order={1}>
          <PanelGroup
            direction="vertical"
            autoSaveId="riftarena.layout.left.v2"
            className="h-full"
          >
            <Panel defaultSize={50} minSize={20} order={1}>
              <CharacterPanel
                player={ai}
                active={!activeIsHuman}
                facing="opponent"
              />
            </Panel>
            <ResizeBarH />
            <Panel defaultSize={50} minSize={20} order={2}>
              <CharacterPanel
                player={human}
                active={activeIsHuman}
                facing="self"
                onPlayChampion={(uid) => tryPlayHandCard(uid)}
                championIsPlayable={
                  human.championZone
                    ? canPlayCard(state, human.championZone.uid) ||
                      canPotentiallyAfford(state, human.championZone.uid)
                    : false
                }
                onActivateLegend={() => activateLegend()}
                canActivateLegend={canActivateLegend(state, human.id)}
                legendActivationLabel={getLegendActivationLabel(
                  state,
                  human.id,
                )}
              />
            </Panel>
          </PanelGroup>
        </Panel>
        <ResizeBar />

        {/* CENTER: play area */}
        <Panel defaultSize={64} minSize={40} order={2}>
          <PanelGroup
            direction="vertical"
            autoSaveId="riftarena.layout.v.v2"
            className="h-full"
          >
            {/* AI top (hand + base) */}
            <Panel defaultSize={20} minSize={10} order={1}>
              <div className="flex h-full flex-col items-center gap-1 overflow-y-auto p-1">
                <div className="flex justify-center gap-0.5">
                  {ai.hand.map((c) => (
                    <GameCard key={c.uid} card={c} faceDown size="sm" />
                  ))}
                </div>
                <UnitsRow
                  units={ai.base.units.filter((u) => !u.battlefieldId)}
                  label="AI base"
                  size="sm"
                />
              </div>
            </Panel>
            <ResizeBarH />

            {/* Battlefields - centerpiece, larger */}
            <Panel defaultSize={42} minSize={25} order={2}>
              <div className="flex h-full items-center justify-center gap-3 overflow-x-auto p-2">
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
            </Panel>
            <ResizeBarH />

            {/* Your base */}
            <Panel defaultSize={18} minSize={10} order={3}>
              <div className="flex h-full flex-col items-center p-1">
                <UnitsRow
                  units={human.base.units.filter((u) => !u.battlefieldId)}
                  label="Your base"
                  size="md"
                  selectedUids={selected}
                  onUnitClick={handleUnitClick}
                  onZoneClick={() => moveSelectionTo(null)}
                  highlightOnSelection={
                    selected.length > 0 &&
                    selected.some((uid) => canStandardMove(state, uid, null))
                  }
                />
              </div>
            </Panel>
            <ResizeBarH />

            {/* Runes + Hand on the same row */}
            <Panel defaultSize={20} minSize={12} order={4}>
              <div className="flex h-full gap-2 p-1">
                {/* Runes container */}
                <div className="flex shrink-0 flex-col rounded border border-fuchsia-900/30 bg-black/40 p-1">
                  <RuneRow
                    runes={human.base.runes}
                    label="Your runes"
                    size="md"
                    disabled={!activeIsHuman}
                    onTap={tapRune}
                    onUntap={untapRune}
                    onRecycle={recycleRune}
                    canUntap={(uid) => canUntapRune(state, uid)}
                    pending={pending}
                    onPendingRecycle={recycleForPending}
                    isValidPending={(uid) =>
                      isValidRecycleForPending(state, uid)
                    }
                  />
                </div>
                {/* Hand container */}
                <div className="flex flex-1 flex-col rounded border border-fuchsia-900/30 bg-black/40 p-1">
                  <div className="text-[9px] uppercase opacity-50">
                    Your hand ({human.hand.length})
                  </div>
                  <div className="flex flex-1 items-end justify-center gap-1 overflow-x-auto">
                    {human.hand.map((c) => {
                      const playable =
                        canPlayCard(state, c.uid) ||
                        canPotentiallyAfford(state, c.uid);
                      return (
                        <motion.div
                          key={c.uid}
                          initial={{ y: 30, opacity: 0 }}
                          animate={{ y: 0, opacity: playable ? 1 : 0.55 }}
                          className={cn(
                            "relative",
                            !playable && "grayscale-[40%]",
                          )}
                        >
                          <GameCard
                            card={c}
                            size="md"
                            onClick={() => playable && tryPlayHandCard(c.uid)}
                          />
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <ResizeBar />

        {/* RIGHT: AI score / log / your score (vertical split) */}
        <Panel defaultSize={20} minSize={12} maxSize={32} order={3}>
          <PanelGroup
            direction="vertical"
            autoSaveId="riftarena.layout.right.v2"
            className="h-full"
          >
            <Panel defaultSize={20} minSize={12} order={1}>
              <ScoreCard
                player={ai}
                victoryScore={state.victoryScore}
                active={!activeIsHuman}
                facing="opponent"
              />
            </Panel>
            <ResizeBarH />
            <Panel defaultSize={60} minSize={30} order={2}>
              <div className="flex h-full flex-col overflow-hidden rounded border border-fuchsia-900/40 bg-black/70">
                <div className="flex shrink-0 items-center gap-1 border-b border-white/5 bg-black/60 px-2 py-1 text-[11px] font-bold text-fuchsia-300">
                  <BookOpen className="h-3 w-3" /> Game Log
                </div>
                <div className="flex-1 overflow-y-auto p-2 text-[11px]">
                  {state.log.slice(-100).reverse().map((entry, i) => (
                    <div
                      key={i}
                      className="border-b border-white/5 py-0.5 opacity-80"
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
            <ResizeBarH />
            <Panel defaultSize={20} minSize={12} order={3}>
              <ScoreCard
                player={human}
                victoryScore={state.victoryScore}
                active={activeIsHuman}
                facing="self"
              />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>

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

      {/* Pending play prompt */}
      {pending && (
        <div className="absolute left-1/2 top-12 z-40 -translate-x-1/2 rounded-lg bg-fuchsia-900/95 px-4 py-2 text-sm font-bold shadow-2xl ring-2 ring-fuchsia-400">
          <div className="flex items-center gap-2">
            <Sparkle className="h-4 w-4 text-yellow-300" />
            Pick {pending.powerLeft} rune{pending.powerLeft > 1 ? "s" : ""} to
            recycle for power (
            <span className="inline-flex gap-1">
              {pending.neededDomains.map((d) => (
                <DomainIcon key={d} domain={d} size={14} />
              ))}
            </span>
            )
            <button
              onClick={() => cancelPending()}
              className="ml-2 rounded bg-black/40 p-1 hover:bg-black/60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================

function canPotentiallyAfford(state: GameState, uid: string): boolean {
  if (state.phase !== "main") return false;
  const card = [
    ...state.players.flatMap((p) => p.hand),
    state.players[0].championZone,
    state.players[1].championZone,
  ]
    .filter(Boolean)
    .find((c) => (c as CardInstance).uid === uid) as CardInstance | undefined;
  if (!card) return false;
  if (card.ownerId !== state.turnPlayerId) return false;
  const def = CARDS_BY_ID[card.defId];
  const player = state.players.find((p) => p.id === card.ownerId)!;
  const energyNeed = (def.energy ?? 0) - player.pool.energy;
  const totalPower = Object.values(player.pool.power).reduce((a, b) => a + b, 0);
  const powerNeed = (def.power ?? 0) - totalPower;
  if (energyNeed <= 0 && powerNeed <= 0) return true;
  const ready = player.base.runes.filter((r) => !r.exhausted);
  const allMatching = player.base.runes.filter(
    (r) => def.domains.includes(r.domain) || r.domain === "Colorless",
  );
  if (allMatching.length < Math.max(0, powerNeed)) return false;
  return ready.length >= Math.max(Math.max(0, energyNeed), Math.max(0, powerNeed));
}

function ResizeBar() {
  return (
    <PanelResizeHandle className="w-1 bg-fuchsia-900/30 transition hover:bg-fuchsia-500/60 active:bg-fuchsia-400" />
  );
}
function ResizeBarH() {
  return (
    <PanelResizeHandle className="h-1 bg-fuchsia-900/30 transition hover:bg-fuchsia-500/60 active:bg-fuchsia-400" />
  );
}

// ============================================================================
// CharacterPanel — displays Legend + Champion vertically with large artwork.
// Used both for opponent (top) and player (bottom).
// ============================================================================

function CharacterPanel({
  player,
  active,
  facing,
  onPlayChampion,
  championIsPlayable,
  onActivateLegend,
  canActivateLegend,
  legendActivationLabel,
}: {
  player: PlayerState;
  active: boolean;
  facing: "self" | "opponent";
  onPlayChampion?: (uid: string) => void;
  championIsPlayable?: boolean;
  onActivateLegend?: () => void;
  canActivateLegend?: boolean;
  legendActivationLabel?: string | null;
}) {
  const zoom = useCardZoom();
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-1 overflow-hidden p-1",
        active && "ring-1 ring-yellow-400/50",
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-bold">
        <span className="truncate">{player.name}</span>
        {facing === "self" && active && (
          <span className="rounded bg-yellow-600 px-1 text-[9px]">YOUR TURN</span>
        )}
      </div>

      <PanelGroup
        direction="vertical"
        autoSaveId={`riftarena.left.${facing}.v2`}
        className="flex-1"
      >
        {/* Legend */}
        <Panel defaultSize={50} minSize={25} order={1}>
          <div className="flex h-full flex-col gap-0.5">
            <div className="text-[9px] uppercase tracking-wide opacity-60">
              Legend
            </div>
            <motion.button
              onContextMenu={(e) => {
                e.preventDefault();
                zoom.open(player.legendZone);
              }}
              animate={{
                rotate: player.legendExhausted ? 6 : 0,
                opacity: player.legendExhausted ? 0.55 : 1,
              }}
              transition={{ type: "spring", stiffness: 200, damping: 18 }}
              className="relative flex-1 overflow-hidden rounded border-2"
              style={{
                borderColor: getDomainHex(
                  (player.legendZone.domains[0] as any) ?? "Colorless",
                ),
              }}
              title="Right-click to zoom"
            >
              {player.legendZone.imageUrl && (
                <Image
                  src={player.legendZone.imageUrl}
                  alt={player.legendZone.name}
                  fill
                  unoptimized
                  className="object-cover object-top"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1 text-[10px] font-bold leading-tight">
                {player.legendZone.name}
              </div>
              {player.legendExhausted && (
                <div className="absolute right-0 top-0 rounded-bl bg-zinc-700 px-1 text-[9px] font-bold">
                  EXHAUSTED
                </div>
              )}
            </motion.button>
            {facing === "self" && hasActivatedAbility(player.legendZone.id) && (
              <button
                onClick={onActivateLegend}
                disabled={!canActivateLegend}
                title={legendActivationLabel ?? ""}
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold",
                  canActivateLegend
                    ? "bg-yellow-600 hover:bg-yellow-500"
                    : "bg-zinc-800 opacity-50",
                )}
              >
                {legendActivationLabel
                  ? `Activate — ${legendActivationLabel}`
                  : "Activate"}
              </button>
            )}
          </div>
        </Panel>
        <ResizeBarH />
        {/* Champion */}
        <Panel defaultSize={50} minSize={25} order={2}>
          <div className="flex h-full flex-col gap-0.5">
            <div className="text-[9px] uppercase tracking-wide opacity-60">
              Champion
            </div>
            {player.championZone ? (
              <motion.button
                onClick={() =>
                  facing === "self" &&
                  onPlayChampion &&
                  onPlayChampion(player.championZone!.uid)
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  const def = CARDS_BY_ID[player.championZone!.defId];
                  if (def) zoom.open(def);
                }}
                whileHover={{ scale: 1.02 }}
                className={cn(
                  "relative flex-1 overflow-hidden rounded border-2",
                  championIsPlayable && facing === "self"
                    ? "border-emerald-400"
                    : "border-fuchsia-900",
                )}
                title="Right-click to zoom · click to play"
              >
                {(() => {
                  const def = CARDS_BY_ID[player.championZone!.defId];
                  return def?.imageUrl ? (
                    <Image
                      src={def.imageUrl}
                      alt={def.name}
                      fill
                      unoptimized
                      className="object-cover object-top"
                    />
                  ) : null;
                })()}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-1 text-[10px] font-bold leading-tight">
                  {CARDS_BY_ID[player.championZone.defId]?.name}
                </div>
                {championIsPlayable && facing === "self" && (
                  <div className="absolute right-0 top-0 rounded-bl bg-emerald-500 px-1 text-[9px] font-bold">
                    PLAY
                  </div>
                )}
              </motion.button>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded border border-dashed border-fuchsia-900/40 text-[10px] opacity-40">
                — already played —
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

// ============================================================================
// ScoreCard — prominent points + resources for one player
// ============================================================================

function ScoreCard({
  player,
  victoryScore,
  active,
  facing,
}: {
  player: PlayerState;
  victoryScore: number;
  active: boolean;
  facing: "self" | "opponent";
}) {
  const accent = facing === "self" ? "emerald" : "rose";
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded border-2 p-2",
        facing === "self"
          ? "border-emerald-700/50 bg-emerald-950/20"
          : "border-rose-700/50 bg-rose-950/20",
        active && "ring-2 ring-yellow-400/60",
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide opacity-80">
        <span>{player.name}</span>
        {active && (
          <span className="rounded bg-yellow-600 px-1.5 text-[9px]">
            ACTIVE
          </span>
        )}
      </div>

      {/* Big point counter */}
      <div className="mt-1 flex items-baseline gap-1">
        <Trophy
          className={cn(
            "h-6 w-6",
            facing === "self" ? "text-emerald-300" : "text-rose-300",
          )}
        />
        <span
          className={cn(
            "font-black leading-none",
            facing === "self" ? "text-emerald-200" : "text-rose-200",
          )}
          style={{ fontSize: "2.5rem" }}
        >
          {player.points}
        </span>
        <span className="text-sm opacity-60">/{victoryScore}</span>
      </div>

      {/* Progress bar to victory */}
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-black/50">
        <div
          className={cn(
            "h-full transition-all",
            facing === "self" ? "bg-emerald-500" : "bg-rose-500",
          )}
          style={{
            width: `${Math.min(100, (player.points / victoryScore) * 100)}%`,
          }}
        />
      </div>

      {/* Resources */}
      {facing === "self" && (
        <>
          <div className="mt-2 flex items-center gap-1 text-xs">
            <EnergyIcon size={14} />
            <span className="font-bold text-cyan-200">
              {player.pool.energy}
            </span>
            <span className="opacity-50">energy</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-0.5">
            {Object.entries(player.pool.power).map(
              ([d, n]) =>
                n > 0 && (
                  <span
                    key={d}
                    className="flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10px]"
                  >
                    <DomainIcon domain={d as any} size={11} />
                    <span className="font-bold">{n}</span>
                  </span>
                ),
            )}
          </div>
        </>
      )}

      {/* Counters */}
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] opacity-70">
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
  );
}

// ============================================================================
// Units row
// ============================================================================

function UnitsRow({
  units,
  label,
  size,
  selectedUids,
  onUnitClick,
  onZoneClick,
  highlightOnSelection,
}: {
  units: CardInstance[];
  label: string;
  size: "sm" | "md";
  selectedUids?: string[];
  onUnitClick?: (u: CardInstance) => void;
  onZoneClick?: () => void;
  highlightOnSelection?: boolean;
}) {
  return (
    <div
      onClick={onZoneClick}
      className={cn(
        "flex h-full w-full flex-col rounded border border-fuchsia-900/30 bg-black/30 px-2 py-1",
        highlightOnSelection && "ring-2 ring-yellow-400 cursor-pointer",
      )}
    >
      <div className="text-[9px] uppercase opacity-50">{label}</div>
      <div className="mt-0.5 flex flex-1 flex-wrap items-start gap-1 overflow-y-auto">
        {units.length === 0 && (
          <span className="text-[10px] opacity-30">empty</span>
        )}
        {units.map((u) => (
          <div
            key={u.uid}
            onClick={(e) => {
              e.stopPropagation();
              onUnitClick?.(u);
            }}
          >
            <GameCard
              card={u}
              size={size}
              selected={selectedUids?.includes(u.uid)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Rune row
// ============================================================================

function RuneRow({
  runes,
  label,
  size,
  disabled,
  onTap,
  onUntap,
  onRecycle,
  canUntap,
  pending,
  onPendingRecycle,
  isValidPending,
}: {
  runes: RuneInstance[];
  label: string;
  size: "md" | "lg";
  disabled?: boolean;
  onTap?: (uid: string) => void;
  onUntap?: (uid: string) => void;
  onRecycle?: (uid: string) => void;
  canUntap?: (uid: string) => boolean;
  pending?: { powerLeft: number } | null;
  onPendingRecycle?: (uid: string) => void;
  isValidPending?: (uid: string) => boolean;
}) {
  const isFaceDown = !onTap;
  return (
    <div className="flex h-full flex-col">
      <div className="text-[9px] uppercase opacity-50">{label}</div>
      <div className="mt-0.5 flex flex-1 flex-wrap content-start items-start justify-start gap-2 overflow-y-auto">
        {runes.length === 0 && (
          <span className="text-[10px] opacity-30">no runes</span>
        )}
        <AnimatePresence>
          {runes.map((r) =>
            isFaceDown ? (
              <motion.div
                key={r.uid}
                layout
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
              >
                <DomainIcon domain={r.domain} size={size === "lg" ? 28 : 22} />
              </motion.div>
            ) : (
              <RuneChip
                key={r.uid}
                rune={r}
                onTap={() => onTap?.(r.uid)}
                onUntap={() => onUntap?.(r.uid)}
                onRecycle={() => onRecycle?.(r.uid)}
                disabled={!!disabled}
                refundable={canUntap?.(r.uid) ?? false}
                size={size}
                pendingRecycle={
                  pending && isValidPending?.(r.uid) ? true : false
                }
                onPendingRecycle={
                  onPendingRecycle ? () => onPendingRecycle(r.uid) : undefined
                }
              />
            ),
          )}
        </AnimatePresence>
      </div>
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
  size,
  pendingRecycle,
  onPendingRecycle,
}: {
  rune: RuneInstance;
  onTap: () => void;
  onUntap: () => void;
  onRecycle: () => void;
  disabled: boolean;
  refundable: boolean;
  size: "md" | "lg";
  pendingRecycle: boolean;
  onPendingRecycle?: () => void;
}) {
  const def = CARDS_BY_ID[rune.defId];
  const px = size === "lg" ? 64 : 48;
  const handleMainClick = () => {
    if (pendingRecycle && onPendingRecycle) {
      onPendingRecycle();
      return;
    }
    if (rune.exhausted) {
      if (refundable) onUntap();
    } else {
      onTap();
    }
  };
  const mainDisabled =
    !pendingRecycle && (disabled || (rune.exhausted && !refundable));
  const tooltip = pendingRecycle
    ? "Click to recycle for required power"
    : rune.exhausted
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
    >
      {pendingRecycle && (
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="absolute -inset-1 rounded-md border-2 border-yellow-300 pointer-events-none"
        />
      )}
      <motion.button
        onClick={handleMainClick}
        disabled={mainDisabled}
        title={tooltip}
        animate={{
          rotate: rune.exhausted ? 90 : 0,
          opacity: mainDisabled ? 0.4 : rune.exhausted ? 0.7 : 1,
          boxShadow: rune.exhausted
            ? "0 0 0 0px rgba(0,0,0,0)"
            : `0 0 14px 3px ${getDomainHex(rune.domain)}aa`,
        }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        style={{
          width: px,
          height: px,
          background: getDomainHex(rune.domain),
        }}
        className={cn(
          "relative overflow-hidden rounded-md border-2 border-black/40",
          refundable && rune.exhausted && "ring-2 ring-yellow-300",
          mainDisabled && "cursor-not-allowed",
        )}
      >
        {def?.imageUrl ? (
          <Image
            src={def.imageUrl}
            alt={def.name}
            width={px}
            height={px}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <DomainIcon domain={rune.domain} size={px * 0.6} />
        )}
        <span className="absolute right-0 top-0">
          <DomainIcon domain={rune.domain} size={size === "lg" ? 18 : 14} />
        </span>
      </motion.button>
      <motion.button
        onClick={onRecycle}
        disabled={disabled}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85, rotate: 360 }}
        transition={{ duration: 0.4 }}
        title="Recycle for 1 power of this domain (works on tapped runes too)"
        className={cn(
          "absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-fuchsia-700 font-bold ring-1 ring-black hover:bg-fuchsia-500 disabled:opacity-30",
          size === "lg" ? "h-6 w-6 text-[11px]" : "h-5 w-5 text-[9px]",
        )}
      >
        ↻
      </motion.button>
    </motion.div>
  );
}

// ============================================================================
// Battlefield view
// ============================================================================

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
  const zoom = useCardZoom();
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
    <div
      onClick={onBattlefieldClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (def) zoom.open(def);
      }}
      className={cn(
        "group flex h-full max-h-full w-96 cursor-pointer flex-col rounded-xl border-4 bg-black/60 text-left overflow-hidden transition",
        bf.contested
          ? "border-red-500"
          : bf.controllerId === "p1"
            ? "border-emerald-500"
            : bf.controllerId === "p2"
              ? "border-rose-600"
              : "border-fuchsia-900",
        canMoveHere && "ring-4 ring-yellow-400 scale-[1.02]",
      )}
    >
      <div className="flex shrink-0 items-center justify-between bg-black/80 px-2 py-1 text-xs">
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
      <div className="flex-1 overflow-y-auto bg-rose-950/50 p-1.5">
        <div className="text-[9px] uppercase opacity-70">AI here</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {aiUnits.map((u) => (
            <GameCard key={u.uid} card={u} size="sm" />
          ))}
          {aiUnits.length === 0 && (
            <span className="text-[10px] opacity-40">—</span>
          )}
        </div>
      </div>
      <div className="relative h-20 w-full shrink-0 overflow-hidden">
        {def?.imageUrl && (
          <Image
            src={def.imageUrl}
            alt={def.name}
            fill
            unoptimized
            className="object-cover"
            style={{ objectPosition: "center 40%" }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-transparent to-black/30" />
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-0.5 text-center text-[10px] font-bold tracking-widest">
          {def?.name?.toUpperCase()}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-emerald-950/50 p-1.5">
        <div className="text-[9px] uppercase opacity-70">You here</div>
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
    </div>
  );
}
