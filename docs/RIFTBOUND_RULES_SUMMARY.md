# Riftbound TCG — Rules Summary for Engine Implementation

Source: Official Core Rules PDF (2026-03-30) — `D:\Projetos IA\RiftArena\docs\core-rules.pdf`

This is the canonical reference for the digital engine. Refer to the PDF for tie-breakers.

---

## Setup & Win Condition

- **Players**: 2-4 (modes: 1v1 Duel/Match, FFA3, FFA4, 2v2)
- **Victory Score**: 8 (1v1, FFA), 11 (2v2)
- **Win**: during a Cleanup, points ≥ Victory Score AND more than any opponent
- **Starting hand**: 4 cards
- **Mulligan**: set aside up to 2 → draw replacements → recycle set-aside to bottom of Main Deck (randomized)

## Deck Construction

- **Champion Legend** (1) — placed in Legend Zone, never leaves, defines Domain Identity
- **Chosen Champion** (1, +up to 2 more in main deck) — Champion unit matching Legend's tag, starts in Champion Zone
- **Main Deck** ≥ 40 cards — units, gear, spells, including Chosen Champion. Max 3 copies same name. Up to 3 Signatures total (must share Legend tag)
- **Rune Deck** = exactly 12 runes
- **Battlefields** — count varies by mode (2 in 1v1, 3 in 3-4 player); no duplicate names

## Domains (Colors)

| Domain | Color | Symbol |
|--------|-------|--------|
| Fury | Red | [R] |
| Calm | Green | [G] |
| Mind | Blue | [B] |
| Body | Orange | [O] |
| Chaos | Purple | [P] |
| Order | Yellow | [Y] |

- `[A]` = "any" power (rainbow); `[C]` = "of this card's domain"
- Card with single domain → only in matching Domain Identity
- Multi-domain card → Identity must contain ALL domains

## Zones

**Board (public):** Bases (1/player), Battlefield Zone (multiple Battlefields), Facedown Zones (1 per Battlefield), Legend Zone (1/player)
**Non-Board:** Chain, Trash, Champion Zone, Main Deck, Rune Deck, Banishment, Hand

Zone change to/from Non-Board → temporary modifications cleared, treated as new object.

## Card Types

- **Unit** (permanent): Might, Tags, Location, Ready/Exhausted, abilities. Enter exhausted unless Accelerate
- **Gear** (permanent): enters Ready at Base, can attach to units
- **Spell**: resolves top-to-bottom → Trash. Default speed = own turn Open State
- **Rune**: from Rune Deck. Channeled (placed) — not played. Basic Runes: `[E]: Add [1].` and `Recycle this: Add [C].`
- **Battlefield**: location game object, can be controlled, has triggered/passive abilities
- **Legend**: in Legend Zone, never leaves, has abilities
- **Token**: temporary, no costs/domains, ceases if leaves Board

## Resources

Two axes per player:
- **Energy** (numeric) — pay generic costs
- **Power** (per domain) — pay domain-specific costs; [A] pays any
- Pool **empties at end of Draw Phase AND end of turn**
- Basic Rune `[E]` (exhaust) → +1 Energy
- Basic Rune Recycle → +1 Power of own domain

## Turn Structure

1. **Awaken Phase** — ready all your Game Objects
2. **Beginning Phase**
   - Beginning Step (start-of-phase triggers)
   - **Scoring Step** — Hold all controlled Battlefields → +1 point each (subject to "winning point" rule)
3. **Channel Phase** — channel top 2 runes from Rune Deck (less if empty); going-second player +1 on first turn
4. **Draw Phase** — draw 1 (going-first skips on first turn in 3+ player); Burn Out if empty
5. **Main Phase** (Neutral Open) — discretionary actions: play, Standard Move, activate abilities. Showdown/Combat sub-phases happen reactively when Battlefields become Contested
6. **Ending Phase** — end-of-turn triggers, then heal all units, expire "this turn" effects, empty Rune Pools

## Movement & Standard Move

- **Standard Move** = Discretionary Action: Exhaust unit, move Base ↔ controlled Battlefield (or Battlefield ↔ Battlefield with **Ganking**)
- Only during own Main Phase, Open State, NOT during Showdown
- Cannot move into Battlefield with units of 2 other players or active combat between them
- Movement is instant — cannot be reacted to

## Contested → Showdown → Combat

- A Battlefield becomes **Contested** when a unit moves there controlled by non-controller
- Next Cleanup stages a **Showdown** (or **Combat** if 2 opposing players have units)
- Combat is always exactly 2 players

### Combat Steps
1. **Combat Showdown Step**
   - Establish Attacker (player who applied Contested) and Defender; units gain designation
   - Attacker gets Focus
   - Add triggered abilities to chain
   - Players alternate Action/Reaction plays until both pass
2. **Combat Damage Step**
   - Sum Might of all Attackers; sum Might of all Defenders
   - Each player assigns total damage among the OTHER's units (lethal first, Tank first, Backline last)
   - Damage dealt simultaneously
3. **Resolution Step**
   - Cleanup: heal all units, recall Attackers if Defenders still present
   - If only one player has units → that player Establishes Control = **Conquer** (gain 1 point if not yet scored this turn)

## Scoring

Two ways to gain a point per Battlefield per turn:
- **Conquer** — gain control of a Battlefield not yet scored this turn
- **Hold** — maintain control during your Beginning Phase Scoring Step

**Winning Point rule**: at points = VictoryScore-1, the final Conquer only counts if you scored ALL Battlefields this turn (else draw 1 instead). Hold always counts.

## The Chain (Stack)

States: **Neutral Open**, **Neutral Closed**, **Showdown Open**, **Showdown Closed**

### FEPR Resolution
1. **Finalize** — process pending items through play steps 2-5
2. **Execute** — priority player plays/activates or passes
3. **Pass** — priority cycles in turn order
4. **Resolve** — newest chain item resolves; if empty, Open State

### Spell Speeds
- **Default** — own turn Neutral Open only
- **[Action]** — also during Showdown Open
- **[Reaction]** — anywhere including Closed States, on any turn

## Cleanup (State-Based Actions)

Triggered between actions. Steps in order:
1. Win check
2. Update Attacker/Defender designations
3. Death: trigger Deathknells → kill units with damage ≥ Might → trash
4. Empty Battlefields become Uncontrolled (Open State only)
5. Recall stranded Gear/permanents/runes; remove invalid Hidden cards
6-7. Mark Showdowns/Combats Staged
8-9. Open them in Neutral Open

## Keywords

| Keyword | Effect |
|---------|--------|
| **Accelerate** | Optional +[1]+1Power → enter Ready |
| **Action** | Playable in Showdown Open |
| **Reaction** | Playable any state including Closed |
| **Ambush** | May be played to Battlefield where you have units; gains Reaction there |
| **Assault X** | While attacker, +X Might (default 1) |
| **Backline** | Lethal damage assigned last |
| **Tank** | Lethal damage assigned first |
| **Shield X** | While defender, +X Might |
| **Deathknell** | When I die, [effect] |
| **Deflect X** | Spells/abilities choosing me cost +X power |
| **Equip X** | Cost X to attach gear to unit |
| **Ganking** | May Standard Move Battlefield→Battlefield |
| **Hidden** | Pay [A] to hide facedown at Battlefield; gains Reaction, plays for [0] |
| **Hunt X** | When Conquer/Hold, gain X XP |
| **Legion** | Bonus text if you played another card this turn |
| **Level N** | Bonus text while you have ≥N XP |
| **Quick-Draw** | Reaction + when played, attach to a unit |
| **Repeat X** | Pay X to execute spell again |
| **Temporary** | Killed at start of controller's Beginning Phase |
| **Unique** | Max 1 copy in deck |
| **Vision** | When played, look at top of Main Deck, may recycle |
| **Weaponmaster** | When played, may attach a controlled Equipment paying its Equip cost reduced by [A] |

Other concepts: **Mighty** (Might ≥ 5), **Buff** (counter, +1 Might, max 1 per unit), **Bonus Damage**, **XP**.

## Key Differences from MTG/Hearthstone

- ❌ No life total — points & battlefield control = win condition
- ❌ No "main field" — Battlefields are discrete locations units move to
- ❌ No mana per turn — runes channeled and exhausted; pool clears each turn
- ✅ Two-resource system (Energy + Power per domain)
- ✅ Movement is core mechanic (Standard Move = exhaust)
- ✅ Combat only at Contested Battlefields between 2 players
- ✅ Sum-Might damage assignment (not unit-vs-unit)
- ✅ Burn Out replaces deck-out — recycle trash + opponent gets 1 point
- ✅ FEPR chain instead of LIFO stack
