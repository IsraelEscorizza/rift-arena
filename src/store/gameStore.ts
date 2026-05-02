"use client";

import { create } from "zustand";
import {
  activateLegend,
  attemptPlayCard,
  cancelPendingPlay,
  cancelSpellTarget,
  createGame,
  finalizeMulligan,
  nextPhase,
  passShowdown,
  playCard,
  recycleForPending,
  recycleRuneForPower,
  resolveSpellTarget,
  standardMove,
  standardMoveMultiple,
  tapRuneForEnergy,
  untapRune,
} from "@/lib/game/engine";
import { DeckList, GameState } from "@/lib/game/types";

export type MatchPhase =
  | "idle"
  | "picking_bf"
  | "playing"
  | "game_over"
  | "match_over";

interface MatchState {
  p1Deck: DeckList;
  p2Deck: DeckList;
  p1Name: string;
  p2Name: string;
  usedBfP1: string[];
  usedBfP2: string[];
  winsP1: number;
  winsP2: number;
  gameNumber: number;
  matchPhase: MatchPhase;
}

interface GameStore {
  state: GameState | null;
  match: MatchState | null;
  startMatch: (
    p1Name: string,
    p1Deck: DeckList,
    p2Name: string,
    p2Deck: DeckList,
  ) => void;
  pickBattlefieldsAndStart: (p1Bf: string, p2Bf: string) => void;
  beginNextGame: () => void;
  finalizeGame: () => void;
  nextPhase: () => void;
  /** Direct play (no auto-pay). Used by AI. */
  playCard: (uid: string) => void;
  /** Smart play with auto-tap energy + prompt recycle for power. */
  attemptPlayCard: (uid: string) => void;
  recycleForPending: (runeUid: string) => void;
  cancelPendingPlay: () => void;
  resolveSpellTarget: (targetUid: string) => void;
  cancelSpellTarget: () => void;
  activateLegend: () => void;
  tapRune: (uid: string) => void;
  untapRune: (uid: string) => void;
  recycleRune: (uid: string) => void;
  standardMove: (unitUid: string, destBfUid: string | null) => void;
  standardMoveMultiple: (unitUids: string[], destBfUid: string | null) => void;
  /** Pass focus during a Combat Showdown. When both players pass, damage resolves. */
  passShowdown: (playerId: string) => void;
  /** Complete this player's mulligan. setAside is up to 2 card uids to replace. */
  finalizeMulligan: (playerId: string, setAside: string[]) => void;
  reset: () => void;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  match: null,

  startMatch: (p1Name, p1Deck, p2Name, p2Deck) => {
    set({
      match: {
        p1Deck,
        p2Deck,
        p1Name,
        p2Name,
        usedBfP1: [],
        usedBfP2: [],
        winsP1: 0,
        winsP2: 0,
        gameNumber: 1,
        matchPhase: "picking_bf",
      },
      state: null,
    });
  },

  pickBattlefieldsAndStart: (p1Bf, p2Bf) => {
    const m = get().match;
    if (!m) return;
    const game = createGame(m.p1Name, m.p1Deck, m.p2Name, m.p2Deck, {
      p1: p1Bf,
      p2: p2Bf,
    });
    set({
      state: game,
      match: {
        ...m,
        usedBfP1: [...m.usedBfP1, p1Bf],
        usedBfP2: [...m.usedBfP2, p2Bf],
        matchPhase: "playing",
      },
    });
  },

  finalizeGame: () => {
    const s = get().state;
    const m = get().match;
    if (!s || !m || !s.winnerId) return;
    const newWinsP1 = m.winsP1 + (s.winnerId === "p1" ? 1 : 0);
    const newWinsP2 = m.winsP2 + (s.winnerId === "p2" ? 1 : 0);
    const matchOver = newWinsP1 >= 2 || newWinsP2 >= 2;
    set({
      match: {
        ...m,
        winsP1: newWinsP1,
        winsP2: newWinsP2,
        matchPhase: matchOver ? "match_over" : "game_over",
      },
    });
  },

  beginNextGame: () => {
    const m = get().match;
    if (!m) return;
    set({
      match: { ...m, gameNumber: m.gameNumber + 1, matchPhase: "picking_bf" },
      state: null,
    });
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
  attemptPlayCard: (uid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: attemptPlayCard(clone(cur), uid) });
  },
  recycleForPending: (runeUid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: recycleForPending(clone(cur), runeUid) });
  },
  cancelPendingPlay: () => {
    const cur = get().state;
    if (!cur) return;
    set({ state: cancelPendingPlay(clone(cur)) });
  },
  resolveSpellTarget: (targetUid) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: resolveSpellTarget(clone(cur), targetUid) });
  },
  cancelSpellTarget: () => {
    const cur = get().state;
    if (!cur) return;
    set({ state: cancelSpellTarget(clone(cur)) });
  },
  activateLegend: () => {
    const cur = get().state;
    if (!cur) return;
    set({ state: activateLegend(clone(cur), cur.turnPlayerId) });
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
  passShowdown: (playerId) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: passShowdown(clone(cur), playerId) });
  },
  finalizeMulligan: (playerId, setAside) => {
    const cur = get().state;
    if (!cur) return;
    set({ state: finalizeMulligan(clone(cur), playerId, setAside) });
  },
  reset: () => set({ state: null, match: null }),
}));
