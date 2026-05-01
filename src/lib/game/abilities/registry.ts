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

export function getAbilities(defId: string): CardAbilities | undefined {
  return REGISTRY[defId];
}

export function hasActivatedAbility(defId: string): boolean {
  return !!REGISTRY[defId]?.activated?.length;
}
