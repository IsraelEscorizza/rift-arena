"use client";

import { create } from "zustand";
import {
  assignBlocker,
  createGame,
  declareAttacker,
  nextPhase,
  playCard,
} from "@/lib/game/engine";
import { Deck, GameState } from "@/lib/game/types";

interface GameStore {
  state: GameState | null;
  selectedCardUid: string | null;
  pendingTargetForUid: string | null;
  startGame: (
    p1Name: string,
    p1Deck: Deck,
    p2Name: string,
    p2Deck: Deck,
  ) => void;
  selectCard: (uid: string | null) => void;
  setPendingTarget: (uid: string | null) => void;
  playCard: (uid: string, targetUid?: string) => void;
  nextPhase: () => void;
  declareAttacker: (uid: string) => void;
  assignBlocker: (attackerUid: string, blockerUid?: string) => void;
  reset: () => void;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  selectedCardUid: null,
  pendingTargetForUid: null,
  startGame: (p1Name, p1Deck, p2Name, p2Deck) => {
    set({ state: createGame(p1Name, p1Deck, p2Name, p2Deck) });
  },
  selectCard: (uid) => set({ selectedCardUid: uid }),
  setPendingTarget: (uid) => set({ pendingTargetForUid: uid }),
  playCard: (uid, targetUid) => {
    const cur = get().state;
    if (!cur) return;
    const next = playCard(clone(cur), uid, targetUid);
    set({ state: next, selectedCardUid: null, pendingTargetForUid: null });
  },
  nextPhase: () => {
    const cur = get().state;
    if (!cur) return;
    set({ state: nextPhase(clone(cur)) });
  },
  declareAttacker: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: declareAttacker(clone(cur), uid) });
  },
  assignBlocker: (attackerUid, blockerUid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: assignBlocker(clone(cur), attackerUid, blockerUid) });
  },
  reset: () =>
    set({
      state: null,
      selectedCardUid: null,
      pendingTargetForUid: null,
    }),
}));
