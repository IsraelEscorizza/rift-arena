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
  addEnergy,
  addPower,
  channelRunes,
  dealDamageToUnit,
  drawCardsFor,
  findOpponent,
  findPlayer,
  getMight,
  isMighty,
  killFirstGear,
  killUnitByUid,
  logEvent,
  readyUnit,
  recallUnit,
  returnUnitToHand,
  spawnToken,
  tempBuffUnit,
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

// ============================================================================
// PROVING GROUNDS (OGS) — 24 exclusive cards
// ============================================================================

const OGS = {
  AnnieFiery: "69bc5bd8d308c64675ca8816",
  Firestorm: "69bc5bd8d308c64675ca8817",
  Incinerate: "69bc5bd8d308c64675ca8818",
  MasterYiMeditative: "69bc5bd8d308c64675ca8819",
  ZephyrSage: "69bc5bd8d308c64675ca881a",
  LuxIlluminated: "69bc5bd8d308c64675ca881b",
  GarenRugged: "69bc5bd9d308c64675ca881c",
  GentlemensDuel: "69bc5bd9d308c64675ca881d",
  MasterYiHoned: "69bc5bd9d308c64675ca881e",
  AnnieStubborn: "69bc5bd9d308c64675ca881f",
  Flash: "69bc5bd9d308c64675ca8820",
  BlastOfPower: "69bc5bd9d308c64675ca8821",
  GarenCommander: "69bc5bd9d308c64675ca8822",
  LuxCrownguard: "69bc5bd9d308c64675ca8823",
  RecruitTheVanguard: "69bc5bd9d308c64675ca8824",
  VanguardAttendant: "69bc5bd9d308c64675ca8825",
  AnnieDarkChildStarter: "69bc5bd9d308c64675ca8826",
  Tibbers: "69bc5bd9d308c64675ca8827",
  MasterYiWujuStarter: "69bc5bd9d308c64675ca8828",
  Highlander: "69bc5bd9d308c64675ca8829",
  LuxLadyStarter: "69bc5bd9d308c64675ca882a",
  FinalSpark: "69bc5bd9d308c64675ca882b",
  GarenMightStarter: "69bc5bd9d308c64675ca882c",
  DecisiveStrike: "69bc5bd9d308c64675ca882d",
};

const RECRUIT_TOKEN_ID = "69bc5bd8d308c64675ca8810"; // 1-Might Recruit token (looked up; see note below)

// Helper: deal damage to a unit
function dealDamageTo(state: GameState, unitUid: string, n: number) {
  for (const p of state.players) {
    const u = p.base.units.find((x) => x.uid === unitUid);
    if (u) {
      u.damage += n;
      logEvent(state, `${CARDS_BY_ID[u.defId].name} takes ${n} damage.`);
      return;
    }
  }
}
function killUnit(state: GameState, unitUid: string) {
  for (const p of state.players) {
    const u = p.base.units.find((x) => x.uid === unitUid);
    if (u) {
      const def = CARDS_BY_ID[u.defId];
      u.damage = (def.might ?? 0) + u.buffCount + 99; // ensure lethal
      logEvent(state, `${def.name} is killed.`);
      return;
    }
  }
}

// ---------- Legends ----------

// Annie - Dark Child (Starter): At end of your turn, ready up to 2 runes.
REGISTRY[OGS.AnnieDarkChildStarter] = {
  triggers: [
    {
      kind: "atEndOfTurn",
      predicate: (ctx) => ctx.data?.playerId === ctx.controllerId,
      describe: () => "Annie — Dark Child: ready up to 2 runes.",
      resolve: (ctx) => {
        const p = findPlayer(ctx.state, ctx.controllerId);
        let readied = 0;
        for (const r of p.base.runes) {
          if (readied >= 2) break;
          if (r.exhausted) {
            r.exhausted = false;
            readied += 1;
          }
        }
      },
    },
  ],
};

// Garen - Might of Demacia (Starter): same as base Garen
REGISTRY[OGS.GarenMightStarter] = {
  triggers: [
    {
      kind: "onConquerAny",
      predicate: (ctx) => {
        if ((ctx.data?.playerId as string) !== ctx.controllerId) return false;
        const bfUid = ctx.data?.bfUid as string | undefined;
        if (!bfUid) return false;
        const p = findPlayer(ctx.state, ctx.controllerId);
        return p.base.units.filter((u) => u.battlefieldId === bfUid).length >= 4;
      },
      describe: () => "Garen — 4+ units conquered, draw 2.",
      resolve: (ctx) => drawCardsFor(ctx.state, ctx.controllerId, 2),
    },
  ],
};

// Lux - Lady of Luminosity (Starter): When you play a spell of cost 5+, draw 1.
const luxStarterTrigger = {
  kind: "onPlaySpell" as const,
  predicate: (ctx: any) => {
    if (ctx.data?.casterId !== ctx.controllerId) return false;
    return ((ctx.data?.energyCost as number) ?? 0) >= 5;
  },
  describe: () => "Lux — Lady of Luminosity: big spell, draw 1.",
  resolve: (ctx: any) => drawCardsFor(ctx.state, ctx.controllerId, 1),
};
REGISTRY[OGS.LuxLadyStarter] = { triggers: [luxStarterTrigger] };

// Master Yi - Wuju Bladesman (Starter): friendly unit defends alone → +2 might.
// Combat is auto-resolved without per-unit hooks; we approximate by checking
// "alone" in effMight via a flag — left as a stub for now.
REGISTRY[OGS.MasterYiWujuStarter] = {};

// ---------- Champions / Units ----------

// Annie - Fiery: passive aura "+1 bonus damage" — currently bonus damage isn't modeled.
REGISTRY[OGS.AnnieFiery] = {};

// Master Yi - Meditative: While 8+ runes, +4 Might.
// Implement via tempMightThisTurn refresh? Better: add an aura check whenever might computed.
// Simplest: at end of each phase change, recompute and stash a temp value. We'll handle
// dynamically in effMight extension via def lookup — for now, log only.
REGISTRY[OGS.MasterYiMeditative] = {};

// Lux - Illuminated: When you play a spell costing 5+, +3 Might this turn.
REGISTRY[OGS.LuxIlluminated] = {
  triggers: [
    {
      kind: "onPlaySpell",
      predicate: (ctx) => {
        if (ctx.data?.casterId !== ctx.controllerId) return false;
        const u = findUnitOnBoard(ctx.state, ctx.sourceUid!);
        if (!u) return false;
        return ((ctx.data?.energyCost as number) ?? 0) >= 5;
      },
      describe: () => "Lux — Illuminated: +3 Might this turn.",
      resolve: (ctx) => {
        const u = findUnitOnBoard(ctx.state, ctx.sourceUid!);
        if (u) u.tempMightThisTurn = (u.tempMightThisTurn ?? 0) + 3;
      },
    },
  ],
};

// Master Yi - Honed: I enter ready (Ganking handled at standardMove validation).
REGISTRY[OGS.MasterYiHoned] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () => "Master Yi — Honed enters ready.",
      resolve: (ctx) => {
        const u = findUnitOnBoard(ctx.state, ctx.sourceUid!);
        if (u) u.exhausted = false;
      },
    },
  ],
};

// Annie - Stubborn: When played, return a spell from trash to hand.
REGISTRY[OGS.AnnieStubborn] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () => "Annie — Stubborn: return a spell from trash to hand.",
      resolve: (ctx) => {
        const p = findPlayer(ctx.state, ctx.controllerId);
        const idx = p.trash.findIndex(
          (c) => CARDS_BY_ID[c.defId]?.type === "Spell",
        );
        if (idx >= 0) {
          const c = p.trash.splice(idx, 1)[0];
          c.zone = "hand";
          p.hand.push(c);
          logEvent(ctx.state, `${p.name} returns ${CARDS_BY_ID[c.defId].name} to hand.`);
        }
      },
    },
  ],
};

// Garen - Commander: Other friendly units +1 Might here.
// Handled via effMight extension above.
REGISTRY[OGS.GarenCommander] = {};

// Lux - Crownguard: Exhaust → add 2 energy (spells only).
// We don't enforce "spells only"; we just expose it as activated.
REGISTRY[OGS.LuxCrownguard] = {
  // We'd model as activated on a unit (not a legend) — engine currently only
  // wires legend.activated. For MVP we leave this passive.
};

// Vanguard Attendant: I enter ready.
REGISTRY[OGS.VanguardAttendant] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () => "Vanguard Attendant enters ready.",
      resolve: (ctx) => {
        const u = findUnitOnBoard(ctx.state, ctx.sourceUid!);
        if (u) u.exhausted = false;
      },
    },
  ],
};

// Tibbers: When played, deal 3 to all units at battlefields.
REGISTRY[OGS.Tibbers] = {
  triggers: [
    {
      kind: "onPlayUnit",
      predicate: (ctx) => ctx.data?.unitUid === ctx.sourceUid,
      describe: () => "Tibbers: 3 damage to all units at battlefields.",
      resolve: (ctx) => {
        for (const p of ctx.state.players) {
          for (const u of p.base.units) {
            if (u.battlefieldId) u.damage += 3;
          }
        }
      },
    },
  ],
};

// Zephyr Sage: Shield 1 — handled by keyword detection in convert script.
REGISTRY[OGS.ZephyrSage] = {};

// Garen - Rugged: Assault 2, Shield 2 — handled by keywords.
REGISTRY[OGS.GarenRugged] = {};

// ---------- Spells ----------

// Firestorm: Deal 3 to all enemy units at a battlefield (target battlefield).
REGISTRY[OGS.Firestorm] = {
  spell: {
    describe: "Deal 3 to all enemy units at target battlefield",
    target: { kind: "battlefield" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      for (const p of state.players) {
        if (p.id === casterId) continue;
        for (const u of p.base.units) {
          if (u.battlefieldId === targetUid) u.damage += 3;
        }
      }
      logEvent(state, "Firestorm hits enemy units.");
    },
  },
};

// Incinerate: Deal 2 to a unit at a battlefield.
REGISTRY[OGS.Incinerate] = {
  spell: {
    describe: "Deal 2 to a unit",
    target: { kind: "any_unit" },
    resolve: (state, _casterId, targetUid) => {
      if (!targetUid) return;
      dealDamageTo(state, targetUid, 2);
    },
  },
};

// Blast of Power: Kill a unit at a battlefield.
REGISTRY[OGS.BlastOfPower] = {
  spell: {
    describe: "Kill a unit at a battlefield",
    target: { kind: "any_unit" },
    resolve: (state, _casterId, targetUid) => {
      if (!targetUid) return;
      killUnit(state, targetUid);
    },
  },
};

// Final Spark: Deal 8 to a unit.
REGISTRY[OGS.FinalSpark] = {
  spell: {
    describe: "Deal 8 to a unit",
    target: { kind: "any_unit" },
    resolve: (state, _casterId, targetUid) => {
      if (!targetUid) return;
      dealDamageTo(state, targetUid, 8);
    },
  },
};

// Decisive Strike: Give friendly units +2 Might this turn.
REGISTRY[OGS.DecisiveStrike] = {
  spell: {
    describe: "All your units gain +2 Might this turn",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      const p = findPlayer(state, casterId);
      for (const u of p.base.units) {
        u.tempMightThisTurn = (u.tempMightThisTurn ?? 0) + 2;
      }
      logEvent(state, `${p.name}'s units gain +2 Might.`);
    },
  },
};

// Recruit the Vanguard: Play four 1-Might Recruit unit tokens.
// Tokens go to base by default (Riftbound rule: "playable to your base or to
// battlefields you control"); MVP: drop to base.
REGISTRY[OGS.RecruitTheVanguard] = {
  spell: {
    describe: "Spawn four 1-Might Recruit tokens at your base",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      // Look up the Recruit token def by name (since we may not have a stable id)
      const recruitDef = Object.values(CARDS_BY_ID).find(
        (c) =>
          c.type === "Unit" &&
          c.supertype === "Token" &&
          c.tags?.includes("Recruit"),
      );
      if (!recruitDef) {
        logEvent(state, "Recruit token def not found.");
        return;
      }
      for (let i = 0; i < 4; i++) {
        spawnToken(state, casterId, recruitDef.id, { ready: false });
      }
    },
  },
};

// Flash: Reaction — move up to 2 friendly units to base. Skip target prompt for MVP.
REGISTRY[OGS.Flash] = {
  spell: {
    describe: "Recall up to 2 of your units from battlefields to base",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      const p = findPlayer(state, casterId);
      let moved = 0;
      for (const u of p.base.units) {
        if (moved >= 2) break;
        if (u.battlefieldId) {
          u.battlefieldId = undefined;
          moved += 1;
        }
      }
      logEvent(state, `${p.name} flashes ${moved} unit${moved !== 1 ? "s" : ""} home.`);
    },
  },
};

// Highlander, Gentlemen's Duel — too complex for MVP; left unimplemented.
REGISTRY[OGS.Highlander] = {};
REGISTRY[OGS.GentlemensDuel] = {};

// ============================================================================
// GEAR — activated abilities
// ============================================================================

// Factory: Seal of <Domain> — Exhaust: [Reaction] Add 1 <domain> power.
// Used by all 6 domain Seals across OGN, SFD, and Overnumbered variants.
function makeSealAbility(cardId: string, domain: import("../types").Domain): CardAbilities {
  function hasReady(state: GameState, controllerId: string) {
    const p = findPlayer(state, controllerId);
    return p.base.gear.some((g) => g.defId === cardId && !g.exhausted);
  }

  return {
    activated: [
      {
        describe: () => `Exhaust → +1 ${domain} power`,
        computeCost: () => ({ exhaustSelf: true }),
        canActivate: (state, controllerId) => {
          const inShowdown = state.combat?.step === "showdown";
          if (inShowdown) {
            if (state.combat?.showdownFocusId !== controllerId) return false;
          } else {
            if (state.phase !== "main") return false;
            if (state.turnPlayerId !== controllerId) return false;
          }
          return hasReady(state, controllerId);
        },
        resolve: (state, controllerId) => {
          const p = findPlayer(state, controllerId);
          const gear = p.base.gear.find((g) => g.defId === cardId && !g.exhausted);
          if (!gear) return;
          gear.exhausted = true;
          addPower(state, controllerId, domain, 1);
          logEvent(state, `${p.name} activates ${CARDS_BY_ID[cardId]?.name ?? "Seal"}: +1 ${domain} power.`);
        },
      },
    ],
  };
}

// Factory: Energy Conduit variant — Exhaust: [Reaction] Add 1 Energy.
function makeEnergyAbility(cardId: string): CardAbilities {
  function hasReady(state: GameState, controllerId: string) {
    const p = findPlayer(state, controllerId);
    return p.base.gear.some((g) => g.defId === cardId && !g.exhausted);
  }

  return {
    activated: [
      {
        describe: () => "Exhaust → +1 Energy",
        computeCost: () => ({ exhaustSelf: true }),
        canActivate: (state, controllerId) => {
          const inShowdown = state.combat?.step === "showdown";
          if (inShowdown) {
            if (state.combat?.showdownFocusId !== controllerId) return false;
          } else {
            if (state.phase !== "main") return false;
            if (state.turnPlayerId !== controllerId) return false;
          }
          return hasReady(state, controllerId);
        },
        resolve: (state, controllerId) => {
          const p = findPlayer(state, controllerId);
          const gear = p.base.gear.find((g) => g.defId === cardId && !g.exhausted);
          if (!gear) return;
          gear.exhausted = true;
          addEnergy(state, controllerId);
          logEvent(state, `${p.name} activates ${CARDS_BY_ID[cardId]?.name ?? "Energy Conduit"}: +1 Energy.`);
        },
      },
    ],
  };
}

// Seal of Unity (OGN + SFD overnumbered)
REGISTRY["69bc5bd4d308c64675ca87c5"] = makeSealAbility("69bc5bd4d308c64675ca87c5", "Order");
REGISTRY["69bc5be3d308c64675ca88e9"] = makeSealAbility("69bc5be3d308c64675ca88e9", "Order");
// Seal of Rage (OGN + SFD overnumbered)
REGISTRY["69bc5bc8d308c64675ca86e1"] = makeSealAbility("69bc5bc8d308c64675ca86e1", "Fury");
REGISTRY["69bc5be4d308c64675ca88ed"] = makeSealAbility("69bc5be4d308c64675ca88ed", "Fury");
// Seal of Focus / Calm (OGN + SFD overnumbered)
REGISTRY["69bc5bcbd308c64675ca8710"] = makeSealAbility("69bc5bcbd308c64675ca8710", "Calm");
REGISTRY["69bc5bdcd308c64675ca8861"] = makeSealAbility("69bc5bdcd308c64675ca8861", "Calm");
// Seal of Insight / Mind (OGN + SFD overnumbered)
REGISTRY["69bc5bcdd308c64675ca8739"] = makeSealAbility("69bc5bcdd308c64675ca8739", "Mind");
REGISTRY["69bc5be4d308c64675ca88ea"] = makeSealAbility("69bc5be4d308c64675ca88ea", "Mind");
// Seal of Strength / Body (OGN + SFD overnumbered)
REGISTRY["69bc5bcfd308c64675ca8769"] = makeSealAbility("69bc5bcfd308c64675ca8769", "Body");
REGISTRY["69bc5bdcd308c64675ca8862"] = makeSealAbility("69bc5bdcd308c64675ca8862", "Body");
// Seal of Discord / Chaos (OGN + SFD overnumbered)
REGISTRY["69bc5bd2d308c64675ca8797"] = makeSealAbility("69bc5bd2d308c64675ca8797", "Chaos");
REGISTRY["69bc5bdcd308c64675ca8859"] = makeSealAbility("69bc5bdcd308c64675ca8859", "Chaos");
// Energy Conduit (OGN)
REGISTRY["69bc5bccd308c64675ca8722"] = makeEnergyAbility("69bc5bccd308c64675ca8722");

// Orb of Regret — Exhaust: Give a unit -1 Might this turn (min 1).
// MVP: auto-targets the highest-Might unit at any battlefield.
REGISTRY["69bc5bcbd308c64675ca871a"] = {
  activated: [
    {
      describe: () => "Exhaust → Give a unit -1 Might this turn (min 1)",
      computeCost: () => ({ exhaustSelf: true }),
      canActivate: (state, controllerId) => {
        const inShowdown = state.combat?.step === "showdown";
        if (inShowdown) {
          if (state.combat?.showdownFocusId !== controllerId) return false;
        } else {
          if (state.phase !== "main") return false;
          if (state.turnPlayerId !== controllerId) return false;
        }
        const p = findPlayer(state, controllerId);
        if (!p.base.gear.some((g) => g.defId === "69bc5bcbd308c64675ca871a" && !g.exhausted)) return false;
        // Need at least one unit on the board
        return state.players.some((pl) => pl.base.units.some((u) => u.battlefieldId));
      },
      resolve: (state, controllerId) => {
        const p = findPlayer(state, controllerId);
        const gear = p.base.gear.find(
          (g) => g.defId === "69bc5bcbd308c64675ca871a" && !g.exhausted,
        );
        if (!gear) return;
        gear.exhausted = true;
        // Pick highest-might unit at a battlefield (prefer enemy)
        let best: CardInstance | null = null;
        for (const pl of state.players) {
          for (const u of pl.base.units) {
            if (!u.battlefieldId) continue;
            if (!best || getMight(u) > getMight(best)) best = u;
          }
        }
        if (best) tempBuffUnit(state, best.uid, -1);
      },
    },
  ],
};

// ============================================================================
// SPELLS — OGN / SFD / General
// Each entry is keyed by the card's riftcodex id.
// ============================================================================

// ---- No-target spells -------------------------------------------------------

// Flurry of Blades — Deal 1 to all units at battlefields.
REGISTRY["69bc5bced308c64675ca8748"] = {
  spell: {
    describe: "Deal 1 to all units at battlefields",
    target: { kind: "none" },
    resolve: (state) => {
      const targets: CardInstance[] = [];
      for (const pl of state.players)
        for (const u of pl.base.units)
          if (u.battlefieldId) targets.push(u);
      for (const u of targets) dealDamageToUnit(state, u.uid, 1);
      logEvent(state, `Flurry of Blades hits ${targets.length} unit(s).`);
    },
  },
};

// Acceptable Losses — Each player destroys one of their gear.
REGISTRY["69bc5bd0d308c64675ca877b"] = {
  spell: {
    describe: "Each player destroys one of their gear",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      for (const pl of state.players) killFirstGear(state, pl.id);
      logEvent(state, `Acceptable Losses: each player sacrifices a gear.`);
      void casterId;
    },
  },
};

// Salvage — You may kill up to one gear. Draw 1.
// MVP: auto-kills your first gear (the "may" is simplified).
REGISTRY["69bc5bd3d308c64675ca87ad"] = {
  spell: {
    describe: "Kill one of your gear (optional), draw 1",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      killFirstGear(state, casterId);
      drawCardsFor(state, casterId, 1);
    },
  },
};

// Stacked Deck — Look at top 3 cards; put 1 in hand, recycle the rest.
// MVP: auto-takes the highest-energy card from the top 3.
REGISTRY["69bc5bd0d308c64675ca877f"] = {
  spell: {
    describe: "Look at top 3; keep 1, recycle rest",
    target: { kind: "none" },
    resolve: (state, casterId) => {
      const p = findPlayer(state, casterId);
      const top = p.mainDeck.splice(0, 3);
      if (top.length === 0) return;
      top.sort((a, b) => {
        const ea = CARDS_BY_ID[a.defId]?.energy ?? 0;
        const eb = CARDS_BY_ID[b.defId]?.energy ?? 0;
        return eb - ea;
      });
      const kept = top.splice(0, 1)[0];
      kept.zone = "hand";
      p.hand.push(kept);
      for (const c of top) {
        c.zone = "trash";
        p.trash.push(c);
      }
      logEvent(
        state,
        `${p.name} uses Stacked Deck: keeps ${CARDS_BY_ID[kept.defId]?.name ?? "a card"}.`,
      );
    },
  },
};

// ---- any_unit target spells ------------------------------------------------

// Stupefy — Give a unit -1 Might this turn (min 1). Draw 1.
REGISTRY["69bc5bccd308c64675ca871f"] = {
  spell: {
    describe: "Give a unit -1 Might this turn; draw 1",
    target: { kind: "any_unit" },
    resolve: (state, casterId, targetUid) => {
      if (targetUid) tempBuffUnit(state, targetUid, -1);
      drawCardsFor(state, casterId, 1);
    },
  },
};

// Cleave — Give a unit +3 Might this turn (represents [Assault 3]).
REGISTRY["69bc5bc6d308c64675ca86b9"] = {
  spell: {
    describe: "Give a unit +3 Might this turn (Assault 3)",
    target: { kind: "any_unit" },
    resolve: (state, _casterId, targetUid) => {
      if (targetUid) tempBuffUnit(state, targetUid, 3);
    },
  },
};

// Challenge — Two units deal Might damage to each other.
// MVP: pick enemy unit; your highest-Might unit at same BF fights it.
REGISTRY["69bc5bcdd308c64675ca8743"] = {
  spell: {
    describe: "Pick enemy unit; your strongest at same BF fights it",
    target: { kind: "enemy_unit_at_battlefield" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      const opp = findOpponent(state, casterId);
      const enemyUnit = opp.base.units.find((u) => u.uid === targetUid);
      if (!enemyUnit?.battlefieldId) return;
      const me = findPlayer(state, casterId);
      // Find allied unit with highest Might at same BF
      const allied = me.base.units
        .filter((u) => u.battlefieldId === enemyUnit.battlefieldId)
        .sort((a, b) => getMight(b) - getMight(a))[0];
      if (!allied) {
        logEvent(state, `Challenge: no friendly unit at that battlefield.`);
        return;
      }
      const enemyMight = getMight(enemyUnit);
      const alliedMight = getMight(allied);
      dealDamageToUnit(state, enemyUnit.uid, alliedMight);
      dealDamageToUnit(state, allied.uid, enemyMight);
      logEvent(
        state,
        `Challenge: ${CARDS_BY_ID[allied.defId]?.name} vs ${CARDS_BY_ID[enemyUnit.defId]?.name}.`,
      );
    },
  },
};

// ---- friendly_unit target spells -------------------------------------------

// En Garde — Give a friendly unit +1 Might this turn.
// If it's the only unit you control at that BF, +1 more.
REGISTRY["69bc5bc9d308c64675ca86e9"] = {
  spell: {
    describe: "Friendly unit: +1 Might (+1 more if alone at its BF)",
    target: { kind: "friendly_unit" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      const me = findPlayer(state, casterId);
      const u = me.base.units.find((x) => x.uid === targetUid);
      if (!u) return;
      let bonus = 1;
      if (u.battlefieldId) {
        const allies = me.base.units.filter(
          (x) => x.battlefieldId === u.battlefieldId,
        );
        if (allies.length === 1) bonus = 2;
      }
      tempBuffUnit(state, targetUid, bonus);
    },
  },
};

// Retreat — Return a friendly unit to hand. Channel 1 rune exhausted.
REGISTRY["69bc5bccd308c64675ca8728"] = {
  spell: {
    describe: "Return friendly unit to hand; channel 1 rune exhausted",
    target: { kind: "friendly_unit" },
    resolve: (state, casterId, targetUid) => {
      if (targetUid) returnUnitToHand(state, targetUid);
      channelRunes(state, casterId, 1, true);
    },
  },
};

// Ride the Wind — Move a friendly unit to base and ready it.
REGISTRY["69bc5bd0d308c64675ca8775"] = {
  spell: {
    describe: "Recall a friendly unit to base and ready it",
    target: { kind: "friendly_unit" },
    resolve: (state, _casterId, targetUid) => {
      if (!targetUid) return;
      recallUnit(state, targetUid);
      readyUnit(state, targetUid);
    },
  },
};

// Showstopper — Buff a friendly unit in your base; move it to a battlefield.
// MVP: auto-targets first available uncontrolled or contested BF.
REGISTRY["69bc5bd5d308c64675ca87df"] = {
  spell: {
    describe: "Buff a base unit (+1 Might) and move it to a battlefield",
    target: { kind: "friendly_unit_at_base" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      const me = findPlayer(state, casterId);
      const u = me.base.units.find((x) => x.uid === targetUid);
      if (!u) return;
      tempBuffUnit(state, targetUid, 1);
      // Move to best available BF
      const targetBf =
        state.battlefields.find((b) => b.controllerId !== casterId) ??
        state.battlefields[0];
      if (targetBf) {
        u.battlefieldId = targetBf.uid;
        u.exhausted = true;
        logEvent(
          state,
          `Showstopper: ${CARDS_BY_ID[u.defId]?.name} buffed and deployed to ${CARDS_BY_ID[targetBf.defId]?.name ?? "battlefield"}.`,
        );
      }
    },
  },
};

// ---- enemy_unit target spells ----------------------------------------------

// Gust — Return a unit at a battlefield with 3 or less Might to its owner's hand.
REGISTRY["69bc5bd0d308c64675ca8771"] = {
  spell: {
    describe: "Return an enemy unit (≤3 Might at BF) to its owner's hand",
    target: { kind: "enemy_unit_at_battlefield" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      const opp = findOpponent(state, casterId);
      const u = opp.base.units.find((x) => x.uid === targetUid);
      if (!u || !u.battlefieldId) return;
      if (getMight(u) > 3) {
        logEvent(state, `Gust: target has more than 3 Might — no effect.`);
        return;
      }
      returnUnitToHand(state, targetUid);
    },
  },
};

// Charm — Move an enemy unit back to its owner's base.
REGISTRY["69bc5bc9d308c64675ca86e6"] = {
  spell: {
    describe: "Move an enemy unit back to its owner's base",
    target: { kind: "enemy_unit" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      const opp = findOpponent(state, casterId);
      const u = opp.base.units.find((x) => x.uid === targetUid);
      if (!u) return;
      recallUnit(state, targetUid);
    },
  },
};

// ---- unit_at_battlefield target spells --------------------------------------

// Hextech Ray — Deal 3 to a unit at a battlefield.
REGISTRY["69bc5bc7d308c64675ca86bf"] = {
  spell: {
    describe: "Deal 3 to a unit at a battlefield",
    target: { kind: "unit_at_battlefield" },
    resolve: (state, _casterId, targetUid) => {
      if (targetUid) dealDamageToUnit(state, targetUid, 3);
    },
  },
};

// ---- battlefield target spells ---------------------------------------------

// Siphon Power — Choose a battlefield.
// Friendly units there +1 Might / enemy units there -1 Might this turn.
REGISTRY["69bc5bd5d308c64675ca87db"] = {
  spell: {
    describe: "Choose BF: friendly units +1 Might, enemy units -1 Might this turn",
    target: { kind: "battlefield" },
    resolve: (state, casterId, targetUid) => {
      if (!targetUid) return;
      for (const pl of state.players) {
        for (const u of pl.base.units) {
          if (u.battlefieldId !== targetUid) continue;
          tempBuffUnit(state, u.uid, pl.id === casterId ? 1 : -1);
        }
      }
      logEvent(state, `Siphon Power on ${CARDS_BY_ID[targetUid]?.name ?? "battlefield"}.`);
    },
  },
};

// ============================================================================
// BATTLEFIELDS — triggered and static abilities
// ============================================================================

// The Grand Plaza — "When you hold here, if you have 7+ units here, you win."
REGISTRY["69bc5befd308c64675ca89bf"] = {
  triggers: [
    {
      kind: "onHoldHere",
      predicate: (ctx) => {
        const data = ctx.data ?? {};
        const bfUid = data.bfUid as string;
        if (!bfUid) return false;
        // Find the Grand Plaza battlefield
        const bf = ctx.state.battlefields.find(
          (b) => b.defId === "69bc5befd308c64675ca89bf",
        );
        if (!bf || bf.uid !== bfUid) return false;
        // Count holder's units at this BF
        const holderId = data.playerId as string;
        const p = findPlayer(ctx.state, holderId);
        const count = p.base.units.filter(
          (u) => u.battlefieldId === bfUid,
        ).length;
        return count >= 7;
      },
      describe: () => "The Grand Plaza: 7+ units while holding → win!",
      resolve: (ctx) => {
        const data = ctx.data ?? {};
        const holderId = data.playerId as string;
        ctx.state.winnerId = holderId;
        logEvent(
          ctx.state,
          `The Grand Plaza — ${findPlayer(ctx.state, holderId).name} wins with 7+ units!`,
        );
      },
    },
  ],
};

// Aspirant's Climb — "Increase the points needed to win the game by 1."
// Static modifier applied at game creation (see engine.ts createGame).
// No runtime trigger needed; entry kept for reference.
REGISTRY["69bc5befd308c64675ca89c0"] = {};

export function getAbilities(defId: string): CardAbilities | undefined {
  return REGISTRY[defId];
}

export function hasActivatedAbility(defId: string): boolean {
  return !!REGISTRY[defId]?.activated?.length;
}
