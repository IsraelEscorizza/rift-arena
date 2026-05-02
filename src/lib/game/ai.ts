// AI for Riftbound — plays units, moves toward battlefields, handles showdowns.

import { CARDS_BY_ID } from "@/lib/cards/database";
import {
  attemptPlayCard,
  canPassShowdown,
  canPlayCard,
  canStandardMove,
  finalizeMulligan,
  nextPhase,
  passShowdown,
  recycleForPending,
  recycleRuneForPower,
  standardMove,
  tapRuneForEnergy,
} from "./engine";
import { GameState } from "./types";

/**
 * Handle AI mulligan — auto-pass (keep all 4 cards).
 * Call this when mulliganState has AI (p2) not yet done.
 */
export function runAIMulligan(state: GameState): GameState {
  const ms = state.mulliganState?.players.find((p) => p.id === "p2");
  if (!ms || ms.done) return state;
  return finalizeMulligan(state, "p2", []); // keep all cards
}

/**
 * Handle AI's focus turn during a Combat Showdown.
 * Currently AI has no Action spells implemented, so it always passes.
 * The structure is here for future Action card support.
 */
export function runAIShowdown(state: GameState): GameState {
  if (!canPassShowdown(state, "p2")) return state;

  const ai = state.players.find((p) => p.id === "p2")!;

  // Try to play an Action/Reaction card if affordable
  const actionCandidates = ai.hand.filter((c) => {
    const def = CARDS_BY_ID[c.defId];
    return (
      (def.keywords.includes("Action") || def.keywords.includes("Reaction")) &&
      canPlayCard(state, c.uid)
    );
  });

  if (actionCandidates.length > 0) {
    // Play the cheapest Action to generate board presence
    const sorted = actionCandidates.sort(
      (a, b) => (CARDS_BY_ID[a.defId].energy ?? 0) - (CARDS_BY_ID[b.defId].energy ?? 0),
    );
    state = attemptPlayCard(state, sorted[0].uid);
    return state;
  }

  // No Action cards — pass
  return passShowdown(state, "p2");
}

/**
 * Main AI turn driver.
 * Plays units, moves to battlefields, and ends turn.
 * When a combat showdown is triggered by an AI move, handles its focus window
 * then returns (human gets focus next).
 */
export function runAITurn(state: GameState): GameState {
  if (state.winnerId) return state;
  let s = state;
  let safety = 0;

  while (s.turnPlayerId === "p2" && !s.winnerId && safety++ < 100) {
    // If we triggered a showdown and AI has focus, handle it inline
    if (s.combat?.step === "showdown" && s.combat.showdownFocusId === "p2") {
      s = runAIShowdown(s);
      // After AI passes/plays, focus is now on human — stop the AI loop
      break;
    }

    if (s.phase !== "main") {
      s = nextPhase(s);
      continue;
    }

    const ai = s.players.find((p) => p.id === "p2")!;

    // 1. Tap all ready runes for energy
    for (const r of ai.base.runes) {
      if (!r.exhausted) {
        s = tapRuneForEnergy(s, r.uid);
      }
    }

    // 2. Recycle runes if we need power for a playable unit
    for (const c of ai.hand) {
      const def = CARDS_BY_ID[c.defId];
      if (def.type !== "Unit") continue;
      const needPower = def.power ?? 0;
      const havePower = Object.values(ai.pool.power).reduce((a, b) => a + b, 0);
      if (havePower < needPower && ai.base.runes.some((r) => !r.exhausted)) {
        const matching =
          ai.base.runes.find((r) => def.domains.includes(r.domain)) ??
          ai.base.runes[0];
        if (matching) s = recycleRuneForPower(s, matching.uid);
      }
    }

    // 3. Play a unit (highest cost first)
    const candidates = ai.hand
      .map((c) => ({ c, def: CARDS_BY_ID[c.defId] }))
      .filter(({ def }) => def.type === "Unit")
      .sort((a, b) => (b.def.energy ?? 0) - (a.def.energy ?? 0));

    let played = false;
    for (const cand of candidates) {
      const before = s;
      s = attemptPlayCard(s, cand.c.uid);
      if (s === before) continue;
      // Auto-recycle for pending power cost
      let safety2 = 0;
      while (s.pendingPlay && safety2++ < 12) {
        const aiNow = s.players.find((p) => p.id === "p2")!;
        const valid = aiNow.base.runes.find(
          (r) =>
            !r.exhausted &&
            (s.pendingPlay!.neededDomains.includes(r.domain) ||
              r.domain === "Colorless"),
        );
        if (!valid) break;
        s = recycleForPending(s, valid.uid);
      }
      played = true;
      break;
    }
    if (played) continue;

    // 4. Move ready units to a battlefield
    const readyUnits = ai.base.units.filter(
      (u) => !u.exhausted && !u.battlefieldId,
    );
    if (readyUnits.length > 0) {
      const targetBf =
        s.battlefields.find((b) => b.controllerId === null) ??
        s.battlefields.find((b) => b.controllerId !== "p2") ??
        s.battlefields[0];
      if (targetBf && canStandardMove(s, readyUnits[0].uid, targetBf.uid)) {
        s = standardMove(s, readyUnits[0].uid, targetBf.uid);
        // After the move, a showdown might have been triggered — the loop
        // will catch it at the top of the next iteration.
        continue;
      }
    }

    // 5. Nothing more to do — end turn
    s = nextPhase(s);
  }

  return s;
}
