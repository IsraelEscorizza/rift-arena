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
  // Round 1
  VolibearRS: "69bc5bd4d308c64675ca87ca",
  VolibearRS_overnumbered: "69bc5bf0d308c64675ca89d5",
  VolibearImposing: "69bc5bcfd308c64675ca8762",
  LilliaBB: "69bc5be9d308c64675ca894e",
  BlueSentinel: "69bc5bedd308c64675ca899b",
  // Round 2
  VexGloomist: "69bc5bead308c64675ca8963",
  JinxLooseCannon: "69bc5bf0d308c64675ca89d2",
  GarenMightOfDemacia: "69bc5bf2d308c64675ca8a08",
  KaiSaSurvivor: "69bc5bc8d308c64675ca86df",
  QiyanaVictorious: "69bc5bcfd308c64675ca875f",
  KogMawCaustic: "69bc5bd1d308c64675ca8786",
  WarwickHunter: "69bc5bcfd308c64675ca8764",
  YuumiMagicalCat: "69bc5becd308c64675ca8991",
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
// Vex - Gloomist (Legend, Chaos)
// "When you or an ally hold, you may exhaust me to draw 1."
// Auto-fires while ready (1v1 has no ally).
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.VexGloomist] = {
  triggers: [
    {
      kind: "onHoldAny",
      predicate: (ctx) => {
        const p = findPlayer(ctx.state, ctx.controllerId);
        if (p.legendExhausted) return false;
        const data = ctx.data ?? {};
        return data.playerId === ctx.controllerId;
      },
      describe: () => "Vex — Gloomist: exhaust me, draw 1.",
      resolve: (ctx) => {
        const p = findPlayer(ctx.state, ctx.controllerId);
        p.legendExhausted = true;
        drawCardsFor(ctx.state, ctx.controllerId, 1);
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// Jinx - Loose Cannon (Legend, Fury)
// "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand."
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.JinxLooseCannon] = {
  triggers: [
    {
      kind: "atBeginningStart",
      predicate: (ctx) => {
        if ((ctx.data?.playerId as string) !== ctx.controllerId) return false;
        const p = findPlayer(ctx.state, ctx.controllerId);
        return p.hand.length <= 1;
      },
      describe: () =>
        "Jinx — Loose Cannon: hand low, draw 1.",
      resolve: (ctx) => drawCardsFor(ctx.state, ctx.controllerId, 1),
    },
  ],
};

// ----------------------------------------------------------------------------
// Garen - Might of Demacia (Legend, Body/Order)
// "When you conquer, if you have 4+ units at that battlefield, draw 2."
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.GarenMightOfDemacia] = {
  triggers: [
    {
      kind: "onConquerAny",
      predicate: (ctx) => {
        if ((ctx.data?.playerId as string) !== ctx.controllerId) return false;
        const bfUid = ctx.data?.bfUid as string | undefined;
        if (!bfUid) return false;
        const p = findPlayer(ctx.state, ctx.controllerId);
        const count = p.base.units.filter((u) => u.battlefieldId === bfUid).length;
        return count >= 4;
      },
      describe: () => "Garen — 4+ units there, draw 2.",
      resolve: (ctx) => drawCardsFor(ctx.state, ctx.controllerId, 2),
    },
  ],
};

// ----------------------------------------------------------------------------
// Kai'Sa - Survivor (Champion)
// "[Accelerate] When I conquer, draw 1."
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.KaiSaSurvivor] = {
  triggers: [
    {
      kind: "onConquerHere",
      predicate: (ctx) => {
        const sourceUid = ctx.sourceUid;
        if (!sourceUid) return false;
        const u = findUnitOnBoard(ctx.state, sourceUid);
        if (!u) return false;
        const bfUid = ctx.data?.bfUid as string | undefined;
        return u.battlefieldId === bfUid;
      },
      describe: () => "Kai'Sa — Survivor: conquer, draw 1.",
      resolve: (ctx) => drawCardsFor(ctx.state, ctx.controllerId, 1),
    },
  ],
};

// ----------------------------------------------------------------------------
// Qiyana - Victorious (Champion)
// "[Deflect] When I conquer, draw 1 OR channel 1 rune exhausted."
// MVP: always draw 1.
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.QiyanaVictorious] = {
  triggers: [
    {
      kind: "onConquerHere",
      predicate: (ctx) => {
        const sourceUid = ctx.sourceUid;
        if (!sourceUid) return false;
        const u = findUnitOnBoard(ctx.state, sourceUid);
        if (!u) return false;
        const bfUid = ctx.data?.bfUid as string | undefined;
        return u.battlefieldId === bfUid;
      },
      describe: () => "Qiyana — Victorious: conquer, draw 1.",
      resolve: (ctx) => drawCardsFor(ctx.state, ctx.controllerId, 1),
    },
  ],
};

// ----------------------------------------------------------------------------
// Kog'Maw - Caustic (Champion)
// "[Deathknell] Deal 4 to all units at my battlefield."
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.KogMawCaustic] = {
  triggers: [
    {
      kind: "onDie",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () =>
        "Kog'Maw — Deathknell: deal 4 to all units at this battlefield.",
      resolve: (ctx) => {
        const bfUid = ctx.data?.battlefieldId as string | undefined;
        if (!bfUid) return;
        for (const p of ctx.state.players) {
          for (const u of p.base.units) {
            if (u.battlefieldId === bfUid) {
              u.damage += 4;
            }
          }
        }
        logEvent(ctx.state, "Kog'Maw deals 4 damage to all units at his battlefield.");
      },
    },
  ],
};

// ----------------------------------------------------------------------------
// Warwick - Hunter (Champion)
// "I enter ready. When I attack, kill all damaged enemy units here."
// MVP: only the "kill damaged enemies on combat" piece (engine simplified).
// onPlayUnit handler sets enteredReady (we approximate as Accelerate-like).
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.WarwickHunter] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () => "Warwick — Hunter enters ready.",
      resolve: (ctx) => {
        const u = findUnitOnBoard(ctx.state, ctx.sourceUid!);
        if (u) u.exhausted = false;
      },
    },
    // "When I attack, kill all damaged enemy units here." would require an
    // onAttack trigger fired during combat — skipped in this MVP since combat
    // is auto-resolved.
  ],
};

// ----------------------------------------------------------------------------
// Yuumi - Magical Cat (Champion)
// "When I attack or defend, give one of your other units here +3 Might and Tank this turn."
// MVP: at start of combat where Yuumi is, the largest other friendly unit gets a buffCount (max 1 in Riftbound rules).
// We use onPlayUnit + onConquerHere as approximations? Actually the proper way is during combat.
// For now we leave Yuumi out of the dynamic combat hook — log-only stub.
// ----------------------------------------------------------------------------
REGISTRY[CARD_IDS.YuumiMagicalCat] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () =>
        "Yuumi — Magical Cat enters play. (Combat buff effect is partially implemented.)",
      resolve: () => {},
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
