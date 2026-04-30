// Ability implementations for specific cards.
// Keyed by Riftcodex card.id (not riftbound_id).
//
// Currently implemented:
//   Volibear - Relentless Storm  (legend, triggered)
//   Lillia - Bashful Bloom       (legend, activated)
//   Volibear - Imposing          (champion, triggered)
//   Blue Sentinel                (champion, triggered + delayed)
//
// Add more by following the same pattern.

import { nanoid } from "nanoid";
import { CARDS_BY_ID } from "@/lib/cards/database";
import { CardInstance, GameState } from "../types";
import { ActivatedCost, CardAbilities, TriggerHandler } from "./types";
import {
  addPower,
  channelRunes,
  drawCardsFor,
  findPlayer,
  isMighty,
  logEvent,
  spawnToken,
} from "./effects";

// ---- Token IDs (looked up from the card pool) ----
const SPRITE_TOKEN_ID = "69bc5bd8d308c64675ca8815"; // 3-Might Sprite, Temporary

// ---- Card IDs ----
export const CARD_IDS = {
  VolibearRS: "69bc5bd4d308c64675ca87ca", // Volibear - Relentless Storm (base)
  VolibearRS_overnumbered: "69bc5bf0d308c64675ca89d5",
  VolibearImposing: "69bc5bcfd308c64675ca8762",
  LilliaBB: "69bc5be9d308c64675ca894e",
  BlueSentinel: "69bc5bedd308c64675ca899b",
};

const REGISTRY: Record<string, CardAbilities> = {};

// ----------------------------------------------------------------------------
// Volibear - Relentless Storm
// "When you play a Mighty unit, you may exhaust me to channel 1 rune exhausted."
// Implementation: auto-fires (we skip the player choice for MVP). Only fires
// while the legend is ready.
// ----------------------------------------------------------------------------
const volibearRSTrigger: TriggerHandler = {
  kind: "onPlayMightyUnit",
  predicate: (ctx) => {
    const p = findPlayer(ctx.state, ctx.controllerId);
    return !p.legendExhausted;
  },
  describe: () =>
    "Volibear — Relentless Storm: exhaust me, channel 1 rune (exhausted).",
  resolve: (ctx) => {
    const p = findPlayer(ctx.state, ctx.controllerId);
    p.legendExhausted = true;
    channelRunes(ctx.state, ctx.controllerId, 1, true);
  },
};
REGISTRY[CARD_IDS.VolibearRS] = { triggers: [volibearRSTrigger] };
REGISTRY[CARD_IDS.VolibearRS_overnumbered] = { triggers: [volibearRSTrigger] };

// ----------------------------------------------------------------------------
// Lillia - Bashful Bloom
// "[4 Energy], exhaust: Play a ready 3-Might Sprite token with [Temporary].
//  Ability costs [1 Energy] less for each friendly unit with [Temporary]."
// ----------------------------------------------------------------------------
function countFriendlyTemporaryUnits(
  state: GameState,
  controllerId: string,
): number {
  const p = findPlayer(state, controllerId);
  let n = 0;
  for (const u of p.base.units) {
    const def = CARDS_BY_ID[u.defId];
    if (!def) continue;
    if (
      (def.rulesText ?? "").includes("[Temporary]") ||
      def.keywords?.includes("Temporary" as any)
    ) {
      n += 1;
    }
  }
  return n;
}

REGISTRY[CARD_IDS.LilliaBB] = {
  activated: [
    {
      describe: (state, controllerId) => {
        const cost = REGISTRY[CARD_IDS.LilliaBB]!.activated![0].computeCost(
          state,
          controllerId,
        );
        return `Play a ready 3-Might Sprite token. (${cost.energy ?? 0}E + exhaust)`;
      },
      computeCost: (state, controllerId): ActivatedCost => {
        const reduction = countFriendlyTemporaryUnits(state, controllerId);
        return {
          energy: Math.max(0, 4 - reduction),
          exhaustSelf: true,
        };
      },
      canActivate: (state, controllerId) => {
        const p = findPlayer(state, controllerId);
        if (p.legendExhausted) return false;
        if (state.phase !== "main") return false;
        if (state.turnPlayerId !== controllerId) return false;
        const cost = REGISTRY[CARD_IDS.LilliaBB]!.activated![0].computeCost(
          state,
          controllerId,
        );
        if (p.pool.energy < (cost.energy ?? 0)) return false;
        return true;
      },
      resolve: (state, controllerId) => {
        const p = findPlayer(state, controllerId);
        const cost = REGISTRY[CARD_IDS.LilliaBB]!.activated![0].computeCost(
          state,
          controllerId,
        );
        p.pool.energy -= cost.energy ?? 0;
        if (cost.exhaustSelf) p.legendExhausted = true;
        spawnToken(state, controllerId, SPRITE_TOKEN_ID, { ready: true });
        logEvent(state, `Lillia activates: spawns Sprite token.`);
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// Volibear - Imposing (Champion unit)
// "[Shield 3] [Tank] When an opponent moves to a battlefield other than mine,
//  draw 1."
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.VolibearImposing] = {
  triggers: [
    {
      kind: "onOpponentMove",
      predicate: (ctx) => {
        // ctx.data: { destBfUid, movedUnitUid, destinationOwnerOrControllerId }
        const data = ctx.data ?? {};
        const sourceUid = ctx.sourceUid;
        if (!sourceUid) return false;
        const myUnit = findUnitOnBoard(ctx.state, sourceUid);
        if (!myUnit) return false;
        // Trigger only if opponent moved to a battlefield (not back to base)
        const destBfUid = data.destBfUid as string | null;
        if (!destBfUid) return false;
        // And only if it's a different BF from where Volibear is
        if (myUnit.battlefieldId === destBfUid) return false;
        return true;
      },
      describe: () =>
        "Volibear — Imposing: opponent moved elsewhere, draw 1.",
      resolve: (ctx) => {
        drawCardsFor(ctx.state, ctx.controllerId, 1);
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// Blue Sentinel (Champion unit)
// "[Shield 2] Your hold effects for holding here trigger an additional time.
//  When I hold, [Add] rainbow at the start of your next Main Phase."
//
// MVP simplification:
// - The "additional time" hold trigger is not yet meaningful (we don't have
//   per-BF hold abilities to double).
// - "When I hold" → schedule a delayed effect that adds 1 power of player's
//   choice (we use Colorless = universal) at start of their next Main phase.
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.BlueSentinel] = {
  triggers: [
    {
      kind: "onHoldHere",
      predicate: (ctx) => {
        // Only when this unit is at a battlefield AND its owner held it
        const sourceUid = ctx.sourceUid;
        if (!sourceUid) return false;
        const u = findUnitOnBoard(ctx.state, sourceUid);
        if (!u) return false;
        if (!u.battlefieldId) return false;
        const data = ctx.data ?? {};
        return data.bfUid === u.battlefieldId;
      },
      describe: () =>
        "Blue Sentinel: queue +1 universal power at start of your next Main Phase.",
      resolve: (ctx) => {
        ctx.state.delayedEffects.push({
          uid: nanoid(8),
          ownerId: ctx.controllerId,
          fireOn: { phase: "main", turnPlayerId: ctx.controllerId },
          description: "Blue Sentinel: +1 universal power",
          kind: "add_rainbow_power",
          payload: {},
        });
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function findUnitOnBoard(
  state: GameState,
  uid: string,
): CardInstance | undefined {
  for (const p of state.players) {
    for (const u of p.base.units) if (u.uid === uid) return u;
  }
  return undefined;
}

export function getAbilities(defId: string): CardAbilities | undefined {
  return REGISTRY[defId];
}

export function hasActivatedAbility(defId: string): boolean {
  return !!REGISTRY[defId]?.activated?.length;
}
