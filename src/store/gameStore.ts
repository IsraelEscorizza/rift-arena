"use client";

import { create } from "zustand";
import {
  createGame,
  enterPhase,
  nextPhase,
  playCard,
  recycleRuneForPower,
  standardMove,
  standardMoveMultiple,
  tapRuneForEnergy,
  untapRune,
} from "@/lib/game/engine";
import { DeckList, GameState } from "@/lib/game/types";

interface GameStore {
  state: GameState | null;
  startGame: (
    p1Name: string,
    p1Deck: DeckList,
    p2Name: string,
    p2Deck: DeckList,
  ) => void;
  nextPhase: () => void;
  playCard: (uid: string) => void;
  tapRune: (uid: string) => void;
  untapRune: (uid: string) => void;
  recycleRune: (uid: string) => void;
  standardMove: (unitUid: string, destBfUid: string | null) => void;
  standardMoveMultiple: (unitUids: string[], destBfUid: string | null) => void;
  reset: () => void;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  startGame: (p1Name, p1Deck, p2Name, p2Deck) => {
    set({ state: createGame(p1Name, p1Deck, p2Name, p2Deck) });
  },
  nextPhase: () => {
    const cur = get().state;
    if (!cur) return;
    set({ state: nextPhase(clone(cur)) });
  },
  playCard: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: playCard(clone(cur), uid) });
  },
  tapRune: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: tapRuneForEnergy(clone(cur), uid) });
  },
  untapRune: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: untapRune(clone(cur), uid) });
  },
  recycleRune: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: recycleRuneForPower(clone(cur), uid) });
  },
  standardMove: (unitUid, destBfUid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: standardMove(clone(cur), unitUid, destBfUid) });
  },
  standardMoveMultiple: (unitUids, destBfUid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: standardMoveMultiple(clone(cur), unitUids, destBfUid) });
  },
  reset: () => set({ state: null }),
}));
