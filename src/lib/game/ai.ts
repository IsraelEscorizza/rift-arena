// Simple AI for Riftbound MVP — plays vanilla units, moves toward battlefields, ends turn.

import { CARDS_BY_ID } from "@/lib/cards/database";
import {
  canPlayCard,
  canStandardMove,
  nextPhase,
  playCard,
  recycleRuneForPower,
  standardMove,
  tapRuneForEnergy,
} from "./engine";
import { GameState } from "./types";

export function runAITurn(state: GameState): GameState {
  if (state.winnerId) return state;
  let s = state;
  let safety = 0;

  while (s.turnPlayerId === "p2" && !s.winnerId && safety++ < 100) {
    if (s.phase !== "main") {
      // The engine auto-advances to main at game start; if we're stuck, end turn
      s = nextPhase(s);
      continue;
    }

    const ai = s.players.find((p) => p.id === "p2")!;

    // 1. Tap all runes to maximize energy
    for (const r of ai.base.runes) {
      if (!r.exhausted) {
        s = tapRuneForEnergy(s, r.uid);
      }
    }
    // 2. Recycle runes if we need power for a card we want to play
    for (const c of ai.hand) {
      const def = CARDS_BY_ID[c.defId];
      if (def.type !== "Unit") continue;
      const needPower = def.power ?? 0;
      const havePower =
        Object.values(ai.pool.power).reduce((a, b) => a + b, 0);
      if (havePower < needPower && ai.base.runes.some((r) => !r.exhausted)) {
        // Recycle one rune that matches a needed domain (or any)
        const matching =
          ai.base.runes.find((r) => def.domains.includes(r.domain)) ??
          ai.base.runes[0];
        if (matching) s = recycleRuneForPower(s, matching.uid);
      }
    }

    // 3. Try to play any unit we can afford
    const playable = ai.hand
      .filter((c) => canPlayCard(s, c.uid))
      .map((c) => ({ c, def: CARDS_BY_ID[c.defId] }))
      .filter(({ def }) => def.type === "Unit")
      .sort((a, b) => (b.def.energy ?? 0) - (a.def.energy ?? 0));

    if (playable.length > 0) {
      s = playCard(s, playable[0].c.uid);
      continue;
    }

    // 4. Move ready units to a battlefield (prefer uncontrolled, else opponent's)
    const readyUnits = ai.base.units.filter((u) => !u.exhausted && !u.battlefieldId);
    if (readyUnits.length > 0) {
      const targetBf =
        s.battlefields.find((b) => b.controllerId === null) ??
        s.battlefields.find((b) => b.controllerId !== "p2") ??
        s.battlefields[0];
      if (targetBf) {
        s = standardMove(s, readyUnits[0].uid, targetBf.uid);
        continue;
      }
    }

    // 5. Nothing to do — end turn
    s = nextPhase(s);
  }

  return s;
}
