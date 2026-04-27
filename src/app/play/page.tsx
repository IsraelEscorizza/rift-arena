"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "@/store/gameStore";
import { GameBoard } from "@/components/game/GameBoard";
import { loadDecks, STARTER_DECKS } from "@/lib/decks/storage";
import { Deck } from "@/lib/game/types";
import { runAITurn } from "@/lib/game/ai";

export default function PlayPage() {
  const state = useGameStore((s) => s.state);
  const startGame = useGameStore((s) => s.startGame);
  const reset = useGameStore((s) => s.reset);
  const [decks, setDecks] = useState<Deck[]>(STARTER_DECKS);
  const [chosen, setChosen] = useState<string>(STARTER_DECKS[0].id);

  useEffect(() => {
    setDecks(loadDecks());
  }, []);

  // Trigger AI turn when it becomes the AI's turn
  useEffect(() => {
    if (!state) return;
    if (state.winnerId) return;
    if (state.activePlayerId !== "p2") return;
    const t = setTimeout(() => {
      const next = runAITurn(JSON.parse(JSON.stringify(state)));
      useGameStore.setState({ state: next });
    }, 600);
    return () => clearTimeout(t);
  }, [state?.activePlayerId, state?.phase, state?.turn, state]);

  if (!state) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#0a0418_70%)] text-white">
        <h1 className="text-3xl font-bold">Choose your deck</h1>
        <select
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="rounded bg-black/60 px-4 py-2"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const playerDeck = decks.find((d) => d.id === chosen)!;
            const aiDeck =
              decks.find((d) => d.id !== chosen) ?? STARTER_DECKS[1];
            startGame("You", playerDeck, "AI", aiDeck);
          }}
          className="rounded bg-fuchsia-700 px-6 py-3 font-bold hover:bg-fuchsia-600"
        >
          Start Match
        </button>
        <a href="/" className="text-sm opacity-60 hover:underline">
          ← Back
        </a>
      </main>
    );
  }

  return (
    <>
      <button
        onClick={reset}
        className="absolute left-2 top-2 z-50 rounded bg-black/60 px-3 py-1 text-xs hover:bg-black"
      >
        ← Quit
      </button>
      <GameBoard />
    </>
  );
}
