# RiftArena

A digital arena to play Riftbound — build decks, command champions, clash across the rift.

Inspired by MTG Arena. Built with Next.js 15, TypeScript, Tailwind, Zustand, and Framer Motion.

## Status: MVP

This is an early MVP with **placeholder cards** and a generic TCG engine. The real Riftbound rules and card database have not been wired in yet — once you provide them, the engine adapts to those rules.

### What works

- Game engine: turns, phases (untap/draw/main/combat/end), resources, casting, combat
- Card types: units, spells, resources, champions
- Keywords: haste, taunt, lifesteal (partial), flying (data only)
- Effects: damage, heal, draw, destroy
- Targeting: pick units or players for spells
- Deck builder: search, filter, save to localStorage
- Local play vs AI
- 2 starter decks

### Not yet

- Stack/priority system (instants on opponent turn)
- Triggered/activated abilities
- Real Riftbound rules and cards
- Multiplayer (WebSocket)
- Account system / cloud deck storage

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Project structure

```
src/
├── app/
│   ├── page.tsx              # Home menu
│   ├── play/page.tsx         # Game vs AI
│   └── deck-builder/page.tsx # Deck builder
├── components/game/          # Card, GameBoard
├── lib/
│   ├── game/                 # types, engine, ai, phases
│   ├── cards/database.ts     # placeholder cards
│   └── decks/storage.ts      # localStorage decks
└── store/gameStore.ts        # Zustand state
```

## Replacing placeholders with Riftbound

1. Update `src/lib/game/types.ts` if Riftbound has different card types/keywords/phases.
2. Replace `src/lib/cards/database.ts` with the real card list.
3. Adjust `src/lib/game/engine.ts` to match Riftbound's turn structure and rules.
