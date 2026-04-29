"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useGameStore } from "@/store/gameStore";
import { GameBoard } from "@/components/game/GameBoard";
import { loadDecks, STARTER_DECKS } from "@/lib/decks/storage";
import { DeckList } from "@/lib/game/types";
import { runAITurn } from "@/lib/game/ai";
import { CARDS_BY_ID } from "@/lib/cards/database";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function PlayPage() {
  const state = useGameStore((s) => s.state);
  const match = useGameStore((s) => s.match);
  const startMatch = useGameStore((s) => s.startMatch);
  const pickBfsAndStart = useGameStore((s) => s.pickBattlefieldsAndStart);
  const finalizeGame = useGameStore((s) => s.finalizeGame);
  const beginNext = useGameStore((s) => s.beginNextGame);
  const reset = useGameStore((s) => s.reset);
  const [decks, setDecks] = useState<DeckList[]>(STARTER_DECKS);
  const [chosen, setChosen] = useState<string>(STARTER_DECKS[0].id);

  useEffect(() => {
    setDecks(loadDecks());
  }, []);

  // AI turn driver
  useEffect(() => {
    if (!state) return;
    if (state.winnerId) return;
    if (state.turnPlayerId !== "p2") return;
    if (state.phase !== "main") return;
    const t = setTimeout(() => {
      const next = runAITurn(JSON.parse(JSON.stringify(state)));
      useGameStore.setState({ state: next });
    }, 800);
    return () => clearTimeout(t);
  }, [state?.turnPlayerId, state?.phase, state?.turnNumber, state]);

  // When game ends, finalize match
  useEffect(() => {
    if (state?.winnerId && match?.matchPhase === "playing") {
      const t = setTimeout(() => finalizeGame(), 1500);
      return () => clearTimeout(t);
    }
  }, [state?.winnerId, match?.matchPhase, finalizeGame]);

  // ----------------------- screens -----------------------

  // 1. No match: deck picker
  if (!match) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] px-4 text-white">
        <h1 className="text-3xl font-bold">Choose your deck</h1>
        <select
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded bg-black/60 px-4 py-2"
        >
          {decks.map((d) => {
            const legend = CARDS_BY_ID[d.legendId];
            return (
              <option key={d.id} value={d.id}>
                {d.name} — {legend?.name ?? "?"}
              </option>
            );
          })}
        </select>
        <button
          onClick={() => {
            const playerDeck = decks.find((d) => d.id === chosen)!;
            const aiDeck =
              decks.find((d) => d.id !== chosen) ?? STARTER_DECKS[1];
            startMatch("You", playerDeck, "AI", aiDeck);
          }}
          className="rounded bg-fuchsia-700 px-6 py-3 font-bold hover:bg-fuchsia-600"
        >
          Start Match (best of 3)
        </button>
        <a href="/" className="text-sm opacity-60 hover:underline">
          ← Back
        </a>
        <p className="max-w-md text-center text-xs opacity-50">
          Riftbound MVP — 1064 real cards, real rules. Card-specific abilities are
          partially implemented (vanilla stats + Tank/Backline/Shield/Assault).
        </p>
      </main>
    );
  }

  // 2. Picking battlefield
  if (match.matchPhase === "picking_bf") {
    return (
      <BattlefieldPicker
        match={match}
        onPicked={(p1Bf, p2Bf) => pickBfsAndStart(p1Bf, p2Bf)}
      />
    );
  }

  // 3. Game ended (mid-match)
  if (match.matchPhase === "game_over") {
    const won = state?.winnerId === "p1";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] text-white">
        <Trophy className="h-16 w-16 text-yellow-300" />
        <h1 className="text-4xl font-black">
          Game {match.gameNumber}: {won ? "WIN" : "LOSS"}
        </h1>
        <div className="text-2xl font-bold">
          Match score: {match.winsP1} — {match.winsP2}
        </div>
        <button
          onClick={beginNext}
          className="mt-3 rounded bg-fuchsia-700 px-6 py-3 font-bold hover:bg-fuchsia-600"
        >
          Continue to Game {match.gameNumber + 1}
        </button>
        <button
          onClick={reset}
          className="text-xs opacity-60 underline hover:opacity-100"
        >
          Quit match
        </button>
      </main>
    );
  }

  // 4. Match over
  if (match.matchPhase === "match_over") {
    const won = match.winsP1 > match.winsP2;
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] text-white">
        <Trophy className="h-24 w-24 text-yellow-300" />
        <h1 className="text-6xl font-black text-yellow-300">
          {won ? "MATCH WON" : "MATCH LOST"}
        </h1>
        <div className="text-2xl">
          Final score: {match.winsP1} — {match.winsP2}
        </div>
        <button
          onClick={reset}
          className="mt-6 rounded bg-fuchsia-700 px-6 py-2 font-bold hover:bg-fuchsia-600"
        >
          Back to menu
        </button>
      </main>
    );
  }

  // 5. Playing
  return (
    <>
      <button
        onClick={reset}
        className="absolute left-2 top-2 z-50 rounded bg-black/60 px-3 py-1 text-xs hover:bg-black"
      >
        ← Quit
      </button>
      <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-xs">
        Game {match.gameNumber} · Match {match.winsP1}-{match.winsP2}
      </div>
      <GameBoard />
    </>
  );
}

// ----------------------- BF picker -----------------------

function BattlefieldPicker({
  match,
  onPicked,
}: {
  match: NonNullable<ReturnType<typeof useGameStore.getState>["match"]>;
  onPicked: (p1Bf: string, p2Bf: string) => void;
}) {
  const availableP1 = useMemo(
    () =>
      match.p1Deck.battlefieldIds.filter(
        (id) => !match.usedBfP1.includes(id),
      ),
    [match.p1Deck.battlefieldIds, match.usedBfP1],
  );
  const availableP2 = useMemo(
    () =>
      match.p2Deck.battlefieldIds.filter(
        (id) => !match.usedBfP2.includes(id),
      ),
    [match.p2Deck.battlefieldIds, match.usedBfP2],
  );

  const [pick, setPick] = useState<string | null>(null);

  // Auto-pick if only one option (last game of BO3)
  useEffect(() => {
    if (availableP1.length === 1 && pick === null) setPick(availableP1[0]);
  }, [availableP1, pick]);

  function confirm() {
    if (!pick) return;
    // AI picks randomly
    const aiPick = availableP2[Math.floor(Math.random() * availableP2.length)];
    onPicked(pick, aiPick);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#050210_70%)] px-4 py-8 text-white">
      <div className="text-center">
        <div className="text-sm uppercase tracking-widest opacity-60">
          Game {match.gameNumber} of best of 3 — Match {match.winsP1}-{match.winsP2}
        </div>
        <h1 className="text-3xl font-black">Choose a Battlefield</h1>
        <p className="mt-2 max-w-xl text-sm opacity-70">
          Each player picks one of their unused battlefields. The two picks become
          the battlefields in play. Used battlefields are removed from the pool for
          subsequent games.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        {availableP1.map((bfId) => {
          const def = CARDS_BY_ID[bfId];
          if (!def) return null;
          const selected = pick === bfId;
          return (
            <motion.button
              key={bfId}
              onClick={() => setPick(bfId)}
              whileHover={{ y: -6, scale: 1.03 }}
              animate={{
                boxShadow: selected
                  ? "0 0 32px 6px rgba(250, 204, 21, 0.6)"
                  : "0 0 0 0 transparent",
              }}
              className={cn(
                "relative h-72 w-52 overflow-hidden rounded-xl border-2",
                selected ? "border-yellow-300" : "border-fuchsia-900/60",
              )}
            >
              {def.imageUrl && (
                <Image
                  src={def.imageUrl}
                  alt={def.name}
                  fill
                  unoptimized
                  className="object-cover"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 text-left">
                <div className="font-bold">{def.name}</div>
                <div className="text-[10px] opacity-70">{def.setLabel}</div>
              </div>
              {selected && (
                <div className="absolute right-2 top-2 rounded bg-yellow-400 px-2 py-0.5 text-[10px] font-bold text-black">
                  PICKED
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      <button
        onClick={confirm}
        disabled={!pick}
        className="rounded bg-fuchsia-700 px-8 py-3 font-bold hover:bg-fuchsia-600 disabled:opacity-40"
      >
        Confirm pick
      </button>

      <div className="mt-4 text-xs opacity-50">
        AI will pick randomly from its remaining {availableP2.length} battlefield
        {availableP2.length === 1 ? "" : "s"}.
      </div>
    </main>
  );
}
