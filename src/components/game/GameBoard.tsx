"use client";

import { useGameStore } from "@/store/gameStore";
import { GameCard } from "./Card";
import { getCard } from "@/lib/cards/database";
import { CardInstance, PlayerState } from "@/lib/game/types";
import { canPlayCard } from "@/lib/game/engine";
import { cn } from "@/lib/utils";
import { Heart, Droplet, ArrowRight, Skull, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PHASE_LABEL: Record<string, string> = {
  untap: "Untap",
  draw: "Draw",
  main1: "Main 1",
  combat_declare_attackers: "Declare Attackers",
  combat_declare_blockers: "Declare Blockers",
  combat_damage: "Combat Damage",
  main2: "Main 2",
  end: "End Step",
};

export function GameBoard() {
  const state = useGameStore((s) => s.state);
  const selectedCardUid = useGameStore((s) => s.selectedCardUid);
  const pendingTargetForUid = useGameStore((s) => s.pendingTargetForUid);
  const selectCard = useGameStore((s) => s.selectCard);
  const setPendingTarget = useGameStore((s) => s.setPendingTarget);
  const playCard = useGameStore((s) => s.playCard);
  const nextPhase = useGameStore((s) => s.nextPhase);
  const declareAttacker = useGameStore((s) => s.declareAttacker);
  const assignBlocker = useGameStore((s) => s.assignBlocker);

  if (!state) return null;

  const [p1, p2] = state.players;
  const human = p1;
  const ai = p2;
  const activeIsHuman = state.activePlayerId === human.id;

  function tryPlayCard(uid: string) {
    if (!state) return;
    if (!canPlayCard(state, uid)) return;
    const found = state.players
      .flatMap((p) => p.hand)
      .find((c) => c.uid === uid);
    if (!found) return;
    const def = getCard(found.defId);
    const needsTarget =
      def.effects?.some(
        (e) =>
          e.target === "any" || e.target === "unit" || e.kind === "destroy",
      ) ?? false;
    if (needsTarget) {
      setPendingTarget(uid);
    } else {
      playCard(uid);
    }
  }

  function handleTargetClick(targetUid: string) {
    if (pendingTargetForUid) {
      playCard(pendingTargetForUid, targetUid);
    }
  }

  function handleUnitClick(card: CardInstance, owner: PlayerState) {
    if (!state) return;
    if (pendingTargetForUid) {
      handleTargetClick(card.uid);
      return;
    }
    if (
      state.phase === "combat_declare_attackers" &&
      activeIsHuman &&
      owner.id === human.id
    ) {
      declareAttacker(card.uid);
      return;
    }
    if (
      state.phase === "combat_declare_blockers" &&
      !activeIsHuman &&
      owner.id === human.id &&
      selectedCardUid &&
      state.combat?.attackers.find((a) => a.attackerUid === selectedCardUid)
    ) {
      assignBlocker(selectedCardUid, card.uid);
      selectCard(null);
      return;
    }
    if (
      state.phase === "combat_declare_blockers" &&
      !activeIsHuman &&
      owner.id !== human.id
    ) {
      selectCard(card.uid);
      return;
    }
  }

  function isAttacking(uid: string) {
    return !!state?.combat?.attackers.find((a) => a.attackerUid === uid);
  }

  function getBlockerOf(uid: string) {
    return state?.combat?.attackers.find((a) => a.attackerUid === uid)
      ?.blockerUid;
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#0a0418_70%)] text-white">
      {/* Opponent zone */}
      <PlayerHeader player={ai} active={state.activePlayerId === ai.id} />

      <div className="flex flex-1 flex-col">
        {/* Opponent hand (face down) */}
        <div className="flex justify-center gap-1 py-2">
          {ai.hand.map((c) => (
            <GameCard key={c.uid} card={c} faceDown small />
          ))}
        </div>

        {/* Opponent battlefield */}
        <BattlefieldRow
          owner={ai}
          isOpponent
          isAttacking={isAttacking}
          getBlockerOf={getBlockerOf}
          onCardClick={(c) => handleUnitClick(c, ai)}
          pendingTargetForUid={pendingTargetForUid}
          selectedCardUid={selectedCardUid}
        />

        {/* Phase bar */}
        <div className="flex items-center justify-center gap-3 border-y border-fuchsia-900/40 bg-black/40 px-4 py-2">
          <span className="text-xs uppercase tracking-wider text-fuchsia-300">
            Turn {state.turn}
          </span>
          <span className="rounded bg-fuchsia-900/60 px-3 py-1 text-sm font-bold">
            {PHASE_LABEL[state.phase]}
          </span>
          <button
            onClick={() => nextPhase()}
            disabled={!activeIsHuman || !!state.winnerId}
            className="flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-sm font-bold hover:bg-emerald-600 disabled:opacity-40"
          >
            Next Phase <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Human battlefield */}
        <BattlefieldRow
          owner={human}
          isOpponent={false}
          isAttacking={isAttacking}
          getBlockerOf={getBlockerOf}
          onCardClick={(c) => handleUnitClick(c, human)}
          pendingTargetForUid={pendingTargetForUid}
          selectedCardUid={selectedCardUid}
        />

        {/* Human hand */}
        <div className="flex min-h-[12rem] items-end justify-center gap-2 p-3">
          {human.hand.map((c) => {
            const playable = canPlayCard(state, c.uid);
            return (
              <motion.div
                key={c.uid}
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className={cn(!playable && "opacity-60")}
              >
                <GameCard
                  card={c}
                  selected={pendingTargetForUid === c.uid}
                  onClick={() => playable && tryPlayCard(c.uid)}
                />
              </motion.div>
            );
          })}
        </div>
      </div>

      <PlayerHeader
        player={human}
        active={state.activePlayerId === human.id}
        clickable={!!pendingTargetForUid}
        onClick={() =>
          pendingTargetForUid && handleTargetClick(human.id)
        }
      />

      {/* Game log */}
      <div className="absolute right-2 top-20 max-h-96 w-72 overflow-y-auto rounded border border-fuchsia-900/40 bg-black/70 p-2 text-xs">
        <div className="mb-1 flex items-center gap-1 font-bold text-fuchsia-300">
          <BookOpen className="h-3 w-3" /> Log
        </div>
        {state.log.slice(-30).reverse().map((entry, i) => (
          <div key={i} className="border-b border-white/5 py-0.5 opacity-80">
            {entry}
          </div>
        ))}
      </div>

      {/* Targeting hint */}
      {pendingTargetForUid && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-yellow-600 px-4 py-1 text-sm font-bold shadow-lg">
          Select a target — click a unit or player. {" "}
          <button
            className="underline"
            onClick={() => setPendingTarget(null)}
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
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/80"
          >
            <h1 className="text-6xl font-black text-yellow-300">
              {state.winnerId === human.id ? "VICTORY" : "DEFEAT"}
            </h1>
            <p className="mt-4 text-xl">
              {state.players.find((p) => p.id === state.winnerId)?.name} wins.
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

function PlayerHeader({
  player,
  active,
  clickable,
  onClick,
}: {
  player: PlayerState;
  active: boolean;
  clickable?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-fuchsia-900/40 bg-black/60 px-4 py-2",
        active && "border-yellow-400/60 bg-yellow-900/20",
        clickable && "cursor-crosshair ring-2 ring-yellow-400",
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-900 font-bold">
          {player.name[0]}
        </div>
        <div>
          <div className="font-bold">{player.name}</div>
          <div className="flex gap-3 text-xs opacity-80">
            <span className="flex items-center gap-1 text-red-400">
              <Heart className="h-3 w-3" /> {player.life}
            </span>
            <span className="flex items-center gap-1 text-cyan-300">
              <Droplet className="h-3 w-3" /> {player.resource}/
              {player.maxResource}
            </span>
            <span className="flex items-center gap-1 opacity-60">
              <Skull className="h-3 w-3" /> {player.graveyard.length}
            </span>
            <span className="opacity-60">Deck: {player.deck.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BattlefieldRow({
  owner,
  isOpponent,
  isAttacking,
  getBlockerOf,
  onCardClick,
  pendingTargetForUid,
  selectedCardUid,
}: {
  owner: PlayerState;
  isOpponent: boolean;
  isAttacking: (uid: string) => boolean;
  getBlockerOf: (uid: string) => string | undefined;
  onCardClick: (c: CardInstance) => void;
  pendingTargetForUid: string | null;
  selectedCardUid: string | null;
}) {
  const units = owner.battlefield.filter((c) => {
    const def = getCard(c.defId);
    return def.type === "unit" || def.type === "champion";
  });
  const resources = owner.battlefield.filter((c) => {
    const def = getCard(c.defId);
    return def.type === "resource";
  });

  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center gap-2 px-4",
        isOpponent ? "border-b border-fuchsia-900/30" : "",
      )}
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {units.map((c) => (
          <GameCard
            key={c.uid}
            card={c}
            attacking={isAttacking(c.uid)}
            blocking={!!getBlockerOf(c.uid)}
            selected={
              selectedCardUid === c.uid || pendingTargetForUid === c.uid
            }
            onClick={() => onCardClick(c)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1 opacity-80">
        {resources.map((c) => (
          <GameCard key={c.uid} card={c} small onClick={() => onCardClick(c)} />
        ))}
      </div>
    </div>
  );
}
