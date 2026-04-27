"use client";

import { Deck } from "@/lib/game/types";
import { STARTER_DECK_EMBER, STARTER_DECK_VOID } from "@/lib/cards/database";

const KEY = "riftarena.decks.v1";

export const STARTER_DECKS: Deck[] = [
  { id: "starter-ember", name: "Ember Rush (Starter)", cards: STARTER_DECK_EMBER },
  { id: "starter-void", name: "Void Control (Starter)", cards: STARTER_DECK_VOID },
];

export function loadDecks(): Deck[] {
  if (typeof window === "undefined") return STARTER_DECKS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return STARTER_DECKS;
    const parsed = JSON.parse(raw) as Deck[];
    return [...STARTER_DECKS, ...parsed];
  } catch {
    return STARTER_DECKS;
  }
}

export function saveDeck(deck: Deck) {
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

export function loadCustomDecks(): Deck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Deck[];
  } catch {
    return [];
  }
}

export function deckSize(deck: Deck) {
  return deck.cards.reduce((sum, c) => sum + c.quantity, 0);
}

export const DECK_MIN = 30;
export const DECK_MAX = 30;
export const COPY_LIMIT = 3;
export const RESOURCE_LIMIT = 12;
