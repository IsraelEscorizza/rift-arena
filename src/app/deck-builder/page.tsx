"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ALL_CARDS, getCard } from "@/lib/cards/database";
import { Deck, CardType, Faction } from "@/lib/game/types";
import {
  COPY_LIMIT,
  DECK_MAX,
  DECK_MIN,
  RESOURCE_LIMIT,
  deckSize,
  deleteDeck,
  loadCustomDecks,
  saveDeck,
} from "@/lib/decks/storage";
import { GameCard } from "@/components/game/Card";
import { createCardInstance } from "@/lib/game/engine";
import { Save, Trash2, Plus, Minus, ArrowLeft } from "lucide-react";

const TYPES: (CardType | "all")[] = [
  "all",
  "unit",
  "spell",
  "resource",
  "champion",
];
const FACTIONS: (Faction | "all")[] = [
  "all",
  "ember",
  "void",
  "verdant",
  "tide",
  "neutral",
];

export default function DeckBuilderPage() {
  const [deck, setDeck] = useState<Deck>({
    id: `custom-${Date.now()}`,
    name: "New Deck",
    cards: [],
  });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<CardType | "all">("all");
  const [filterFaction, setFilterFaction] = useState<Faction | "all">("all");
  const [savedDecks, setSavedDecks] = useState<Deck[]>([]);

  useEffect(() => {
    setSavedDecks(loadCustomDecks());
  }, []);

  const filtered = useMemo(() => {
    return ALL_CARDS.filter((c) => {
      if (filterType !== "all" && c.type !== filterType) return false;
      if (filterFaction !== "all" && c.faction !== filterFaction) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [filterType, filterFaction, search]);

  function addCard(defId: string) {
    const def = getCard(defId);
    setDeck((d) => {
      const existing = d.cards.find((c) => c.defId === defId);
      const totalSize = deckSize(d);
      if (totalSize >= DECK_MAX) return d;
      const limit = def.type === "resource" ? RESOURCE_LIMIT : COPY_LIMIT;
      if (existing) {
        if (existing.quantity >= limit) return d;
        return {
          ...d,
          cards: d.cards.map((c) =>
            c.defId === defId ? { ...c, quantity: c.quantity + 1 } : c,
          ),
        };
      }
      return { ...d, cards: [...d.cards, { defId, quantity: 1 }] };
    });
  }

  function removeCard(defId: string) {
    setDeck((d) => {
      const existing = d.cards.find((c) => c.defId === defId);
      if (!existing) return d;
      if (existing.quantity <= 1) {
        return { ...d, cards: d.cards.filter((c) => c.defId !== defId) };
      }
      return {
        ...d,
        cards: d.cards.map((c) =>
          c.defId === defId ? { ...c, quantity: c.quantity - 1 } : c,
        ),
      };
    });
  }

  function handleSave() {
    if (deckSize(deck) < DECK_MIN) {
      alert(`Deck must have at least ${DECK_MIN} cards.`);
      return;
    }
    saveDeck(deck);
    setSavedDecks(loadCustomDecks());
    alert("Saved!");
  }

  function loadDeck(d: Deck) {
    setDeck(d);
  }

  function newDeck() {
    setDeck({
      id: `custom-${Date.now()}`,
      name: "New Deck",
      cards: [],
    });
  }

  const size = deckSize(deck);

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1a0b2e_0%,_#0a0418_70%)] text-white">
      <header className="flex items-center justify-between border-b border-fuchsia-900/40 bg-black/60 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm opacity-70 hover:opacity-100"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <h1 className="text-2xl font-black">Deck Builder</h1>
        <div className="w-20" />
      </header>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
        {/* Card pool */}
        <section>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards..."
              className="flex-1 rounded bg-black/60 px-3 py-2 text-sm"
            />
            <select
              value={filterType}
              onChange={(e) =>
                setFilterType(e.target.value as CardType | "all")
              }
              className="rounded bg-black/60 px-2 py-2 text-sm capitalize"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={filterFaction}
              onChange={(e) =>
                setFilterFaction(e.target.value as Faction | "all")
              }
              className="rounded bg-black/60 px-2 py-2 text-sm capitalize"
            >
              {FACTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((def) => {
              const inDeck =
                deck.cards.find((c) => c.defId === def.id)?.quantity ?? 0;
              return (
                <div key={def.id} className="flex flex-col items-center gap-1">
                  <GameCard
                    card={createCardInstance(def.id, "preview")}
                    onClick={() => addCard(def.id)}
                  />
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => removeCard(def.id)}
                      className="rounded bg-red-700 p-1 hover:bg-red-600 disabled:opacity-30"
                      disabled={inDeck === 0}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center font-bold">{inDeck}</span>
                    <button
                      onClick={() => addCard(def.id)}
                      className="rounded bg-emerald-700 p-1 hover:bg-emerald-600"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Deck panel */}
        <aside className="sticky top-4 self-start rounded border border-fuchsia-900/40 bg-black/60 p-4">
          <input
            value={deck.name}
            onChange={(e) => setDeck({ ...deck, name: e.target.value })}
            className="mb-2 w-full rounded bg-black/40 px-2 py-1 text-lg font-bold"
          />
          <div
            className={`mb-3 text-sm ${
              size === DECK_MIN ? "text-emerald-400" : "text-yellow-400"
            }`}
          >
            {size} / {DECK_MIN} cards
          </div>

          <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
            {deck.cards.length === 0 && (
              <p className="text-xs opacity-50">Click cards to add them.</p>
            )}
            {deck.cards
              .map((c) => ({ ...c, def: getCard(c.defId) }))
              .sort((a, b) => a.def.cost - b.def.cost)
              .map(({ defId, quantity, def }) => (
                <div
                  key={defId}
                  className="flex items-center justify-between rounded bg-fuchsia-950/40 px-2 py-1 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 font-bold">
                      {def.cost}
                    </span>
                    <span>{def.name}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => removeCard(defId)}
                      className="rounded bg-red-700 p-0.5 hover:bg-red-600"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-4 text-center font-bold">
                      {quantity}
                    </span>
                    <button
                      onClick={() => addCard(defId)}
                      className="rounded bg-emerald-700 p-0.5 hover:bg-emerald-600"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-fuchsia-700 px-3 py-2 text-sm font-bold hover:bg-fuchsia-600"
            >
              <Save className="h-4 w-4" /> Save
            </button>
            <button
              onClick={newDeck}
              className="rounded bg-zinc-700 px-3 py-2 text-sm hover:bg-zinc-600"
            >
              New
            </button>
          </div>

          {savedDecks.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <h3 className="mb-2 text-xs uppercase opacity-60">Saved decks</h3>
              <div className="space-y-1">
                {savedDecks.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded bg-black/40 px-2 py-1 text-xs"
                  >
                    <button
                      onClick={() => loadDeck(d)}
                      className="flex-1 text-left hover:underline"
                    >
                      {d.name} ({deckSize(d)})
                    </button>
                    <button
                      onClick={() => {
                        deleteDeck(d.id);
                        setSavedDecks(loadCustomDecks());
                      }}
                      className="rounded bg-red-700 p-1 hover:bg-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
