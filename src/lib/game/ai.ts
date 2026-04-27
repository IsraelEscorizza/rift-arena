import { getCard } from "@/lib/cards/database";
import { canPlayCard, declareAttacker, nextPhase, playCard } from "./engine";
import { GameState } from "./types";

export function runAITurn(state: GameState): GameState {
  if (state.winnerId) return state;
  let s = state;
  let safety = 0;

  while (s.activePlayerId === "p2" && !s.winnerId && safety++ < 100) {
    const phase = s.phase;
    const ai = s.players.find((p) => p.id === "p2")!;
    const human = s.players.find((p) => p.id === "p1")!;

    if (phase === "main1" || phase === "main2") {
      const playable = ai.hand
        .map((c) => ({ c, def: getCard(c.defId) }))
        .filter(({ c }) => canPlayCard(s, c.uid))
        .sort((a, b) => b.def.cost - a.def.cost);

      if (playable.length > 0) {
        const choice = playable[0];
        let target: string | undefined;
        if (choice.def.effects) {
          const needsTarget = choice.def.effects.some(
            (e) =>
              e.target === "any" ||
              e.target === "unit" ||
              e.kind === "destroy",
          );
          if (needsTarget) {
            const enemyUnits = human.battlefield.filter((c) => {
              const d = getCard(c.defId);
              return d.type === "unit" || d.type === "champion";
            });
            if (choice.def.effects[0].kind === "destroy") {
              target = enemyUnits.sort((a, b) => {
                const da = getCard(a.defId);
                const db = getCard(b.defId);
                return (db.attack ?? 0) - (da.attack ?? 0);
              })[0]?.uid;
              if (!target) {
                s = nextPhase(s);
                continue;
              }
            } else {
              target = enemyUnits[0]?.uid ?? "p1";
            }
          }
        }
        s = playCard(s, choice.c.uid, target);
        continue;
      }
      s = nextPhase(s);
      continue;
    }

    if (phase === "combat_declare_attackers") {
      const attackers = ai.battlefield.filter((c) => {
        const d = getCard(c.defId);
        return (
          (d.type === "unit" || d.type === "champion") &&
          !c.tapped &&
          !c.summoningSick
        );
      });
      for (const a of attackers) {
        s = declareAttacker(s, a.uid);
      }
      s = nextPhase(s);
      continue;
    }

    s = nextPhase(s);
  }

  return s;
}
