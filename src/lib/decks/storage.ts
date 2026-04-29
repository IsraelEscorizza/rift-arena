"use client";

import { DeckList } from "@/lib/game/types";
import { STARTER_DECKS } from "./starters";

const KEY = "riftarena.decks.v2";

export { STARTER_DECKS };

export function loadDecks(): DeckList[] {
  if (typeof window === "undefined") return STARTER_DECKS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return STARTER_DECKS;
    const custom = JSON.parse(raw) as DeckList[];
    return [...STARTER_DECKS, ...custom];
  } catch {
    return STARTER_DECKS;
  }
}

export function loadCustomDecks(): DeckList[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveDeck(deck: DeckList) {
  if (typeof window === "undefined") return;
  const existing = loadCustomDecks().filter((d) => d.id !== deck.id);
  existing.push(deck);
  localStorage.setItem(KEY, JSON.stringify(existing));
}

export function deleteDeck(id: string) {
  if (typeof window === "undefined") return;
  const existing = loadCustomDecks().filter((d) => d.id !== id);
  localStorage.setItem(KEY, JSON.stringify(existing));
}

export const MAIN_DECK_MIN = 40;
export const RUNE_DECK_SIZE = 12;
export const COPY_LIMIT = 3;
export const BATTLEFIELDS_REQUIRED = 3;

export function deckMainSize(d: DeckList) {
  return d.mainDeck.reduce((s, e) => s + e.quantity, 0);
}
export function deckRuneSize(d: DeckList) {
  return d.runeDeck.reduce((s, e) => s + e.quantity, 0);
}
