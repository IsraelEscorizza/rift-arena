// Riftbound TCG engine — MVP implementation of official rules.
//
// Implemented:
// - Two players, 8 victory points, 2 battlefields
// - Champion Legend + Chosen Champion + Main Deck + Rune Deck zones
// - Phases: Awaken / Beginning(scoring=Hold) / Channel / Draw / Main / Ending
// - Energy + Power resource pool, basic runes (tap=Energy, recycle=Power)
// - Standard Move: exhaust unit to move base ↔ battlefield
// - Combat at contested battlefields: sum-Might damage assignment, Tank/Backline ordering, Shield/Assault
// - Scoring: Conquer (gain control) + Hold (maintain at Beginning)
// - Burn Out replacement when deck empty
//
// Not implemented (TODO):
// - FEPR chain with Action/Reaction speeds
// - Triggered abilities (only Vision sketched)
// - Card-specific rules text effects beyond keywords
// - Equip/attach mechanics for Gear

import { nanoid } from "nanoid";
import {
  BattlefieldInstance,
  CardDefinition,
  CardInstance,
  DeckList,
  Domain,
  GameState,
  PlayerState,
  ResourcePool,
  RuneInstance,
} from "./types";
import { CARDS_BY_ID, findBasicRuneOfDomain } from "@/lib/cards/database";
import { getAbilities } from "./abilities/registry";
import { TriggerContext, TriggerKind } from "./abilities/types";
import { isMighty } from "./abilities/effects";

const VICTORY_SCORE = 8;
const STARTING_HAND = 4;
const BATTLEFIELDS_PER_GAME = 2;

const DOMAINS_ALL: Domain[] = [
  "Fury",
  "Calm",
  "Mind",
  "Body",
  "Chaos",
  "Order",
  "Colorless",
];

function emptyPool(): ResourcePool {
  const power = {} as Record<Domain, number>;
  for (const d of DOMAINS_ALL) power[d] = 0;
  return { energy: 0, power };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newCardInstance(defId: string, ownerId: string): CardInstance {
  return {
    uid: nanoid(8),
    defId,
    ownerId,
    controllerId: ownerId,
    zone: "main_deck",
    exhausted: false,
    damage: 0,
    buffCount: 0,
    enteredThisTurn: false,
    attachments: [],
  };
}

function newRuneInstance(defId: string, ownerId: string): RuneInstance {
  const def = CARDS_BY_ID[defId];
  return {
    uid: nanoid(8),
    defId,
    ownerId,
    zone: "rune_deck",
    exhausted: false,
    domain: def.domains[0] ?? "Colorless",
  };
}

function buildPlayer(id: string, name: string, deck: DeckList): PlayerState {
  const legend = CARDS_BY_ID[deck.legendId];
  if (!legend) throw new Error(`Legend not found: ${deck.legendId}`);
  if (legend.type !== "Legend") throw new Error(`${legend.name} is not a Legend`);

  const main: CardInstance[] = [];
  for (const e of deck.mainDeck) {
    for (let i = 0; i < e.quantity; i++) {
      main.push(newCardInstance(e.defId, id));
    }
  }
  const runes: RuneInstance[] = [];
  for (const e of deck.runeDeck) {
    for (let i = 0; i < e.quantity; i++) {
      runes.push(newRuneInstance(e.defId, id));
    }
  }

  // Move chosen champion from main deck to championZone
  let chosen: CardInstance | null = null;
  const idx = main.findIndex((c) => c.defId === deck.chosenChampionId);
  if (idx >= 0) {
    chosen = main.splice(idx, 1)[0];
    chosen.zone = "champion_zone";
  } else {
    // Build a champion instance directly
    chosen = newCardInstance(deck.chosenChampionId, id);
    chosen.zone = "champion_zone";
  }

  const shuffledMain = shuffle(main);
  const hand = shuffledMain.splice(0, STARTING_HAND).map((c) => ({
    ...c,
    zone: "hand" as const,
  }));

  return {
    id,
    name,
    team: id === "p1" ? 0 : 1,
    points: 0,
    xp: 0,
    mainDeck: shuffledMain,
    runeDeck: shuffle(runes),
    hand,
    trash: [],
    banishment: [],
    base: { units: [], gear: [], runes: [] },
    championZone: chosen,
    legendZone: legend,
    legendExhausted: false,
    domainIdentity: legend.domains,
    pool: emptyPool(),
  };
}

function buildBattlefield(defId: string, ownerId: string): BattlefieldInstance {
  return {
    uid: nanoid(8),
    defId,
    ownerId,
    controllerId: null,
    contested: false,
    scoredByThisTurn: [],
  };
}

export function createGame(
  p1Name: string,
  p1Deck: DeckList,
  p2Name: string,
  p2Deck: DeckList,
  pickedBattlefieldIds?: { p1: string; p2: string },
): GameState {
  const p1 = buildPlayer("p1", p1Name, p1Deck);
  const p2 = buildPlayer("p2", p2Name, p2Deck);

  // Battlefield selection: per official rules each player picks 1 of their 3.
  // If picks not provided, fall back to random (Duel mode).
  const bfDefs: Record<string, CardDefinition> = {};
  const battlefields: BattlefieldInstance[] = [];
  let p1Pick = pickedBattlefieldIds?.p1;
  let p2Pick = pickedBattlefieldIds?.p2;
  if (!p1Pick) p1Pick = shuffle(p1Deck.battlefieldIds)[0];
  if (!p2Pick) p2Pick = shuffle(p2Deck.battlefieldIds)[0];
  const picks: { id: string; ownerId: string }[] = [];
  if (p1Pick) picks.push({ id: p1Pick, ownerId: "p1" });
  if (p2Pick) picks.push({ id: p2Pick, ownerId: "p2" });
  for (const { id, ownerId } of picks) {
    const def = CARDS_BY_ID[id];
    if (!def) continue;
    bfDefs[id] = def;
    battlefields.push(buildBattlefield(id, ownerId));
  }

  const state: GameState = {
    mode: "duel",
    victoryScore: VICTORY_SCORE,
    players: [p1, p2],
    battlefields,
    battlefieldDefs: bfDefs,
    turnPlayerId: "p1",
    priorityPlayerId: "p1",
    turnNumber: 1,
    phase: "awaken",
    combat: null,
    log: [`${p1Name} vs ${p2Name} — game start.`],
    winnerId: null,
    pendingMove: null,
    pendingPlay: null,
    delayedEffects: [],
  };

  // Run start-of-game phases automatically
  enterPhase(state, "awaken");
  return state;
}

// ---------------- helpers ----------------

export function getPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((p) => p.id === id);
  if (!p) throw new Error(`Player not found: ${id}`);
  return p;
}
export function getOpponent(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id !== id)!;
}

export function findCard(state: GameState, uid: string): CardInstance | null {
  for (const p of state.players) {
    for (const z of [p.hand, p.mainDeck, p.trash, p.banishment]) {
      const c = z.find((c) => c.uid === uid);
      if (c) return c;
    }
    for (const u of p.base.units) if (u.uid === uid) return u;
    for (const g of p.base.gear) if (g.uid === uid) return g;
    if (p.championZone?.uid === uid) return p.championZone;
  }
  // Battlefield zones
  for (const p of state.players) {
    // Units at battlefields are stored on the player who controls them, but we use base for base only.
    // For simplicity in MVP, we keep units that moved to a BF in p.base.units with battlefieldId.
  }
  return null;
}

export function findRune(state: GameState, uid: string): RuneInstance | null {
  for (const p of state.players) {
    const r = p.runeDeck.find((r) => r.uid === uid);
    if (r) return r;
    const r2 = p.base.runes.find((r) => r.uid === uid);
    if (r2) return r2;
  }
  return null;
}

function log(state: GameState, msg: string) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
}

function getMight(card: CardInstance): number {
  const def = CARDS_BY_ID[card.defId];
  let m = def.might ?? 0;
  m += card.buffCount;
  // Assault adds while attacker; we apply it during combat resolution, not here.
  return m;
}

function unitsAtBattlefield(
  state: GameState,
  bfUid: string,
): { unit: CardInstance; player: PlayerState }[] {
  const out: { unit: CardInstance; player: PlayerState }[] = [];
  for (const p of state.players) {
    for (const u of p.base.units) {
      if (u.battlefieldId === bfUid) out.push({ unit: u, player: p });
    }
  }
  return out;
}

// ---------------- phases ----------------

export function enterPhase(state: GameState, phase: GameState["phase"]) {
  state.phase = phase;
  const active = getPlayer(state, state.turnPlayerId);
  switch (phase) {
    case "awaken":
      // Ready everything (units, gear, runes, legend) at active player's locations
      for (const u of active.base.units) u.exhausted = false;
      for (const g of active.base.gear) g.exhausted = false;
      for (const r of active.base.runes) r.exhausted = false;
      active.legendExhausted = false;
      // Reset enteredThisTurn
      for (const u of active.base.units) u.enteredThisTurn = false;
      log(state, `${active.name}: Awaken Phase.`);
      enterPhase(state, "beginning");
      break;
    case "beginning":
      // Reset scored battlefields tracker each turn for active player
      for (const bf of state.battlefields) {
        bf.scoredByThisTurn = bf.scoredByThisTurn.filter(
          (id) => id !== active.id,
        );
      }
      // Beginning Step triggers (before scoring)
      emitTrigger(state, "atBeginningStart", { playerId: active.id });
      // Scoring step: Hold all controlled battlefields
      for (const bf of state.battlefields) {
        if (bf.controllerId === active.id) {
          score(state, active.id, bf.uid, "Hold");
        }
      }
      log(state, `${active.name}: Beginning Phase.`);
      if (state.winnerId) return;
      enterPhase(state, "channel");
      break;
    case "channel": {
      const channelN = 2;
      for (let i = 0; i < channelN; i++) {
        const r = active.runeDeck.shift();
        if (!r) break;
        r.zone = "base";
        active.base.runes.push(r);
      }
      log(state, `${active.name}: Channel Phase (drew ${channelN} runes).`);
      enterPhase(state, "draw");
      break;
    }
    case "draw":
      // First-turn first-player skips draw
      if (state.turnNumber === 1 && active.id === "p1") {
        log(state, `${active.name}: Draw Phase (skipped on first turn).`);
      } else {
        drawCards(state, active.id, 1);
        log(state, `${active.name}: Draw Phase.`);
      }
      // End of Draw Phase: empty rune pools (per rule 313)
      for (const p of state.players) p.pool = emptyPool();
      enterPhase(state, "main");
      break;
    case "main":
      log(state, `${active.name}: Main Phase.`);
      processDelayedEffects(state);
      break;
    case "ending":
      log(state, `${active.name}: Ending Phase.`);
      // Heal all units, expire 'this turn' effects, empty rune pools
      for (const p of state.players) {
        for (const u of p.base.units) {
          u.damage = 0;
        }
        p.pool = emptyPool();
      }
      // Pass turn
      const next = getOpponent(state, state.turnPlayerId);
      state.turnPlayerId = next.id;
      state.priorityPlayerId = next.id;
      state.turnNumber += 1;
      log(state, `Turn ${state.turnNumber} — ${next.name}.`);
      enterPhase(state, "awaken");
      break;
  }
}

export function nextPhase(state: GameState): GameState {
  if (state.winnerId) return state;
  if (state.phase === "main") {
    enterPhase(state, "ending");
  }
  return state;
}

// ---------------- draw / burn out ----------------

export function drawCards(state: GameState, playerId: string, n: number) {
  const p = getPlayer(state, playerId);
  for (let i = 0; i < n; i++) {
    if (p.mainDeck.length === 0) {
      burnOut(state, playerId);
      if (state.winnerId) return;
    }
    const c = p.mainDeck.shift();
    if (!c) continue;
    c.zone = "hand";
    p.hand.push(c);
  }
}

function burnOut(state: GameState, playerId: string) {
  const p = getPlayer(state, playerId);
  // Recycle trash → main deck
  for (const c of p.trash) c.zone = "main_deck";
  p.mainDeck = shuffle([...p.mainDeck, ...p.trash]);
  p.trash = [];
  // Opponent gains 1 point
  const opp = getOpponent(state, playerId);
  log(state, `${p.name} burns out — ${opp.name} gains 1 point.`);
  addPoints(state, opp.id, 1, true);
}

// ---------------- resources ----------------

export function tapRuneForEnergy(state: GameState, runeUid: string): GameState {
  const r = findRune(state, runeUid);
  if (!r) return state;
  if (r.exhausted) return state;
  if (r.zone !== "base") return state;
  if (r.ownerId !== state.turnPlayerId) return state;
  r.exhausted = true;
  const p = getPlayer(state, r.ownerId);
  p.pool.energy += 1;
  log(state, `${p.name} taps ${CARDS_BY_ID[r.defId]?.name ?? "rune"} for [1].`);
  return state;
}

export function canUntapRune(state: GameState, runeUid: string): boolean {
  const r = findRune(state, runeUid);
  if (!r) return false;
  if (!r.exhausted) return false;
  if (r.zone !== "base") return false;
  if (r.ownerId !== state.turnPlayerId) return false;
  if (state.phase !== "main") return false;
  // Only refundable if there's still at least 1 energy in the pool
  // (i.e. the [1] generated by the tap hasn't been spent yet).
  const p = getPlayer(state, r.ownerId);
  return p.pool.energy >= 1;
}

export function untapRune(state: GameState, runeUid: string): GameState {
  if (!canUntapRune(state, runeUid)) return state;
  const r = findRune(state, runeUid)!;
  const p = getPlayer(state, r.ownerId);
  r.exhausted = false;
  p.pool.energy -= 1;
  log(state, `${p.name} untaps ${CARDS_BY_ID[r.defId]?.name ?? "rune"} (refund [1]).`);
  return state;
}

export function recycleRuneForPower(state: GameState, runeUid: string): GameState {
  const r = findRune(state, runeUid);
  if (!r) return state;
  if (r.zone !== "base") return state;
  if (r.ownerId !== state.turnPlayerId) return state;
  const p = getPlayer(state, r.ownerId);
  // Remove rune from base, send to bottom of rune deck
  p.base.runes = p.base.runes.filter((x) => x.uid !== runeUid);
  r.zone = "rune_deck";
  r.exhausted = false;
  p.runeDeck.push(r);
  // Add 1 power of rune's domain (or any if Colorless)
  const domain = r.domain;
  if (domain === "Colorless") {
    // Add as universal — store in 'Colorless' bucket
    p.pool.power.Colorless += 1;
  } else {
    p.pool.power[domain] += 1;
  }
  log(state, `${p.name} recycles rune for [${domain[0]}].`);
  return state;
}

function canPayCost(
  pool: ResourcePool,
  energyCost: number,
  powerCost: number,
  domains: Domain[],
): boolean {
  // Power cost: powerCost is total power symbols. In Riftbound the symbols are typed by domain.
  // Riftcodex API gives `power` as a flat number; we treat it as: must spend `powerCost` Power chips,
  // each chip must be of a matching domain (any of the card's domains) OR Colorless (universal).
  const colorless = pool.power.Colorless ?? 0;
  let availableMatching = colorless;
  for (const d of domains) {
    if (d === "Colorless") continue;
    availableMatching += pool.power[d] ?? 0;
  }
  if (availableMatching < powerCost) return false;
  // Energy: pay with energy in pool (or convert remaining power as in real rules? We keep separate.)
  if (pool.energy < energyCost) return false;
  return true;
}

function payCost(
  pool: ResourcePool,
  energyCost: number,
  powerCost: number,
  domains: Domain[],
) {
  // Spend Energy
  pool.energy -= energyCost;
  // Spend Power: prefer matching-domain chips first, fall back to Colorless
  let remaining = powerCost;
  for (const d of domains) {
    if (d === "Colorless") continue;
    while (remaining > 0 && (pool.power[d] ?? 0) > 0) {
      pool.power[d] -= 1;
      remaining -= 1;
    }
  }
  while (remaining > 0 && (pool.power.Colorless ?? 0) > 0) {
    pool.power.Colorless -= 1;
    remaining -= 1;
  }
}

// ---------------- play card ----------------

export function canPlayCard(state: GameState, uid: string): boolean {
  if (state.winnerId) return false;
  if (state.phase !== "main") return false;
  const card = findCard(state, uid);
  if (!card) return false;
  if (card.zone !== "hand" && card.zone !== "champion_zone") return false;
  if (card.ownerId !== state.turnPlayerId) return false;
  const def = CARDS_BY_ID[card.defId];
  const energy = def.energy ?? 0;
  const power = def.power ?? 0;
  const player = getPlayer(state, card.ownerId);
  return canPayCost(player.pool, energy, power, def.domains);
}

export function playCard(state: GameState, uid: string): GameState {
  if (!canPlayCard(state, uid)) return state;
  const card = findCard(state, uid);
  if (!card) return state;
  const def = CARDS_BY_ID[card.defId];
  const player = getPlayer(state, card.ownerId);

  payCost(
    player.pool,
    def.energy ?? 0,
    def.power ?? 0,
    def.domains,
  );

  // Remove from origin zone
  if (card.zone === "hand") {
    player.hand = player.hand.filter((c) => c.uid !== uid);
  } else if (card.zone === "champion_zone") {
    player.championZone = null;
  }

  if (def.type === "Unit") {
    card.zone = "base";
    card.battlefieldId = undefined;
    card.exhausted = !def.keywords.includes("Accelerate");
    card.enteredThisTurn = true;
    player.base.units.push(card);
    log(state, `${player.name} plays unit ${def.name}.`);
    // Fire onPlayUnit triggers
    emitTrigger(state, "onPlayUnit", { unitUid: card.uid });
    if (isMighty(card)) {
      emitTrigger(state, "onPlayMightyUnit", { unitUid: card.uid });
    }
  } else if (def.type === "Gear") {
    card.zone = "base";
    card.exhausted = false;
    player.base.gear.push(card);
    log(state, `${player.name} plays gear ${def.name}.`);
  } else if (def.type === "Spell") {
    // Without effect implementations, spell just goes to trash
    card.zone = "trash";
    player.trash.push(card);
    log(state, `${player.name} casts spell ${def.name} (effects not yet implemented).`);
  } else {
    log(state, `Cannot play ${def.name} of type ${def.type}.`);
  }
  return state;
}

// ---------------- movement ----------------

export function canStandardMove(
  state: GameState,
  unitUid: string,
  destBfUid: string | null,
): boolean {
  if (state.phase !== "main") return false;
  if (state.combat) return false;
  const card = findCard(state, unitUid);
  if (!card) return false;
  if (card.controllerId !== state.turnPlayerId) return false;
  if (card.exhausted) return false;
  const def = CARDS_BY_ID[card.defId];
  if (def.type !== "Unit") return false;
  // Origin must be in player's base (we keep all units there)
  if (card.zone !== "base") return false;
  // Standard move: base ↔ controlled battlefield (or BF↔BF with Ganking)
  if (destBfUid !== null) {
    // Cannot move to a BF with units of 2 OTHER players (only relevant in 3+ players; skip in 1v1)
    return true;
  }
  return true;
}

export function standardMove(
  state: GameState,
  unitUid: string,
  destBfUid: string | null,
): GameState {
  return standardMoveMultiple(state, [unitUid], destBfUid);
}

/**
 * Move multiple units to the same destination in one atomic action.
 * Per Riftbound rules (rule 144): "Multiple units can declare Standard Move
 * simultaneously to same destination; origins can differ; costs paid simultaneously."
 *
 * All units are exhausted and placed at destination, THEN contested check runs
 * and combat resolves once at the end (instead of one-at-a-time).
 */
export function standardMoveMultiple(
  state: GameState,
  unitUids: string[],
  destBfUid: string | null,
): GameState {
  // Validate all of them first; if any invalid, abort the whole batch.
  const movers: { card: CardInstance; def: CardDefinition }[] = [];
  for (const uid of unitUids) {
    if (!canStandardMove(state, uid, destBfUid)) return state;
    const card = findCard(state, uid);
    if (!card) return state;
    movers.push({ card, def: CARDS_BY_ID[card.defId] });
  }
  if (movers.length === 0) return state;

  const playerName = getPlayer(state, movers[0].card.controllerId).name;

  // Apply all moves simultaneously
  for (const m of movers) {
    m.card.exhausted = true;
    m.card.battlefieldId = destBfUid ?? undefined;
  }

  if (destBfUid) {
    const bfDef =
      state.battlefieldDefs[
        state.battlefields.find((b) => b.uid === destBfUid)!.defId
      ];
    if (movers.length === 1) {
      log(state, `${playerName} moves ${movers[0].def.name} to ${bfDef.name}.`);
    } else {
      log(
        state,
        `${playerName} moves ${movers.length} units to ${bfDef.name} (${movers
          .map((m) => m.def.name)
          .join(", ")}).`,
      );
    }
  } else {
    if (movers.length === 1) {
      log(state, `${playerName} moves ${movers[0].def.name} back to base.`);
    } else {
      log(state, `${playerName} returns ${movers.length} units to base.`);
    }
  }

  // Fire onOpponentMove triggers (one per moving unit, for opposing players' units to react)
  for (const m of movers) {
    emitTrigger(state, "onOpponentMove", {
      destBfUid: destBfUid ?? null,
      movedUnitUid: m.card.uid,
      moverId: m.card.controllerId,
    });
  }

  // Check contested + combat ONCE for the whole batch
  checkContested(state);
  resolveAllPendingCombat(state);
  return state;
}

function checkContested(state: GameState) {
  for (const bf of state.battlefields) {
    const units = unitsAtBattlefield(state, bf.uid);
    if (units.length === 0) {
      bf.contested = false;
      // If no controller and no units, stays uncontrolled
      continue;
    }
    const players = new Set(units.map((u) => u.player.id));
    // If controller exists and only their units → not contested
    if (bf.controllerId && players.size === 1 && players.has(bf.controllerId)) {
      bf.contested = false;
      continue;
    }
    // Otherwise contested
    bf.contested = true;
  }
}

// ---------------- combat ----------------

function resolveAllPendingCombat(state: GameState) {
  // MVP: walk through contested battlefields. If 2 opposing players have units, run combat.
  // If only 1 player has units → they conquer.
  let safety = 0;
  while (safety++ < 20) {
    let didSomething = false;
    for (const bf of state.battlefields) {
      const units = unitsAtBattlefield(state, bf.uid);
      const playersHere = new Set(units.map((u) => u.player.id));
      if (playersHere.size === 0) {
        if (bf.controllerId !== null && bf.contested) {
          bf.controllerId = null;
          log(state, `${state.battlefieldDefs[bf.defId].name} becomes uncontrolled.`);
        }
        continue;
      }
      if (playersHere.size === 1) {
        const onlyPlayer = [...playersHere][0];
        if (bf.controllerId !== onlyPlayer) {
          // Establish control = Conquer
          establishControl(state, bf, onlyPlayer);
          didSomething = true;
        }
        bf.contested = false;
        continue;
      }
      // 2+ players present → combat
      if (playersHere.size === 2) {
        runCombatAt(state, bf);
        didSomething = true;
        if (state.winnerId) return;
      }
    }
    if (!didSomething) break;
  }
}

function establishControl(
  state: GameState,
  bf: BattlefieldInstance,
  newControllerId: string,
) {
  bf.controllerId = newControllerId;
  bf.contested = false;
  // Conquer = score (if not already this turn)
  score(state, newControllerId, bf.uid, "Conquer");
}

function runCombatAt(state: GameState, bf: BattlefieldInstance) {
  const units = unitsAtBattlefield(state, bf.uid);
  const playersHere = [...new Set(units.map((u) => u.player.id))];
  if (playersHere.length !== 2) return;

  // Attacker = player who applied contested = the one who is NOT the current controller (if any),
  // else the turn player.
  const attackerId =
    bf.controllerId && playersHere.includes(bf.controllerId)
      ? playersHere.find((p) => p !== bf.controllerId)!
      : state.turnPlayerId;
  const defenderId = playersHere.find((p) => p !== attackerId)!;

  const attackers = units.filter((u) => u.player.id === attackerId);
  const defenders = units.filter((u) => u.player.id === defenderId);

  // Compute Might (with Assault for attacker, Shield for defender)
  function effMight(card: CardInstance, role: "attacker" | "defender"): number {
    const def = CARDS_BY_ID[card.defId];
    let m = (def.might ?? 0) + card.buffCount;
    if (role === "attacker") m += def.assault ?? 0;
    if (role === "defender") m += def.shield ?? 0;
    return Math.max(0, m);
  }

  const totalAtk = attackers.reduce(
    (s, u) => s + effMight(u.unit, "attacker"),
    0,
  );
  const totalDef = defenders.reduce(
    (s, u) => s + effMight(u.unit, "defender"),
    0,
  );

  log(
    state,
    `Combat at ${state.battlefieldDefs[bf.defId].name}: attackers ${totalAtk} vs defenders ${totalDef}.`,
  );

  // Damage assignment: each side assigns its total to other's units, lethal first, Tank first, Backline last.
  function assignDamage(
    fromTotal: number,
    targets: { unit: CardInstance; player: PlayerState }[],
    forSide: "attacker" | "defender",
  ) {
    let remaining = fromTotal;
    const sortedTargets = [...targets].sort((a, b) => {
      const ka = CARDS_BY_ID[a.unit.defId].keywords;
      const kb = CARDS_BY_ID[b.unit.defId].keywords;
      const aTank = ka.includes("Tank") ? 0 : ka.includes("Backline") ? 2 : 1;
      const bTank = kb.includes("Tank") ? 0 : kb.includes("Backline") ? 2 : 1;
      return aTank - bTank;
    });
    for (const t of sortedTargets) {
      if (remaining <= 0) break;
      const def = CARDS_BY_ID[t.unit.defId];
      const lethal = Math.max(0, (def.might ?? 0) + t.unit.buffCount - t.unit.damage);
      const apply = Math.min(remaining, lethal);
      t.unit.damage += apply;
      remaining -= apply;
    }
  }

  assignDamage(totalAtk, defenders, "attacker");
  assignDamage(totalDef, attackers, "defender");

  // Kill units with damage >= might
  killDead(state);

  // Determine result
  const remainingUnits = unitsAtBattlefield(state, bf.uid);
  const remPlayers = new Set(remainingUnits.map((u) => u.player.id));
  // Heal all surviving units (per Combat Cleanup rule)
  for (const u of remainingUnits) u.unit.damage = 0;

  if (remPlayers.size === 1) {
    const winner = [...remPlayers][0];
    if (bf.controllerId !== winner) {
      establishControl(state, bf, winner);
    } else {
      log(state, `${getPlayer(state, winner).name} maintains control.`);
      bf.contested = false;
    }
    // Recall attackers if defenders still present? In our simplified model:
    // if attacker's units survive AND defenders also survive → both stay (re-stage combat).
  } else if (remPlayers.size === 0) {
    // No survivors → battlefield uncontrolled
    bf.controllerId = null;
    bf.contested = false;
    log(state, `Battlefield is left uncontrolled.`);
  } else {
    // Both sides still have units — re-stage (simplified: do nothing this iteration)
    bf.contested = true;
  }
}

function killDead(state: GameState) {
  // First, collect dying units so we can fire onDie BEFORE they're moved to trash
  const dying: { unit: CardInstance; player: PlayerState }[] = [];
  for (const p of state.players) {
    for (const u of p.base.units) {
      const def = CARDS_BY_ID[u.defId];
      if (u.damage >= (def.might ?? 0) + u.buffCount) {
        dying.push({ unit: u, player: p });
      }
    }
  }
  // Fire onDie triggers (Deathknell happens before moving to trash per rules)
  for (const { unit, player } of dying) {
    emitTrigger(state, "onDie", {
      unitUid: unit.uid,
      controllerId: player.id,
      battlefieldId: unit.battlefieldId,
    });
  }
  // Now actually move them to trash
  for (const p of state.players) {
    const survivors: CardInstance[] = [];
    for (const u of p.base.units) {
      const def = CARDS_BY_ID[u.defId];
      if (u.damage >= (def.might ?? 0) + u.buffCount) {
        u.zone = "trash";
        u.damage = 0;
        u.battlefieldId = undefined;
        p.trash.push(u);
        log(state, `${def.name} dies.`);
      } else {
        survivors.push(u);
      }
    }
    p.base.units = survivors;
  }
}

// ---------------- scoring ----------------

function score(
  state: GameState,
  playerId: string,
  bfUid: string,
  via: "Conquer" | "Hold",
) {
  const bf = state.battlefields.find((b) => b.uid === bfUid);
  if (!bf) return;
  if (bf.scoredByThisTurn.includes(playerId)) return;
  bf.scoredByThisTurn.push(playerId);
  addPoints(state, playerId, 1, false, via);
  if (via === "Hold") {
    emitTrigger(state, "onHoldHere", { bfUid, playerId });
    emitTrigger(state, "onHoldAny", { bfUid, playerId });
  } else {
    emitTrigger(state, "onConquerHere", { bfUid, playerId });
    emitTrigger(state, "onConquerAny", { bfUid, playerId });
  }
}

function addPoints(
  state: GameState,
  playerId: string,
  n: number,
  isBurnOut: boolean,
  via?: "Conquer" | "Hold",
) {
  const p = getPlayer(state, playerId);
  // Winning point rule (simplified): if at VS-1 and gaining via Conquer, only counts if you scored ALL battlefields this turn.
  if (
    !isBurnOut &&
    via === "Conquer" &&
    p.points === state.victoryScore - 1
  ) {
    const allScored = state.battlefields.every((b) =>
      b.scoredByThisTurn.includes(playerId),
    );
    if (!allScored) {
      drawCards(state, playerId, 1);
      log(
        state,
        `${p.name} would win via Conquer but hasn't scored all battlefields — draws 1 instead.`,
      );
      return;
    }
  }
  p.points += n;
  if (via) {
    log(state, `${p.name} scores via ${via} (${p.points}/${state.victoryScore}).`);
  }
  // Check win
  const max = Math.max(...state.players.map((pp) => pp.points));
  if (p.points >= state.victoryScore && p.points === max) {
    const others = state.players.filter((pp) => pp.id !== p.id);
    if (others.every((o) => o.points < p.points)) {
      state.winnerId = p.id;
      log(state, `${p.name} wins!`);
    }
  }
}

// ---------------- auto-pay (UX convenience) ----------------

/**
 * Smart attempt to play a card from hand or champion zone.
 *
 * Step 1: validate the card exists and the player can theoretically afford it.
 * Step 2: auto-tap enough ready runes to cover the Energy cost (preferring
 *   runes whose domain DOESN'T match the card's, so matching runes stay
 *   available to be recycled for Power).
 * Step 3: if Power is still short, set state.pendingPlay so the UI can prompt
 *   the user to pick which runes to recycle.
 * Step 4: if Power is fully covered, play the card immediately.
 */
export function attemptPlayCard(state: GameState, uid: string): GameState {
  if (state.winnerId) return state;
  if (state.phase !== "main") return state;
  if (state.pendingPlay) return state; // already prompting

  const card = findCard(state, uid);
  if (!card) return state;
  if (card.zone !== "hand" && card.zone !== "champion_zone") return state;
  if (card.ownerId !== state.turnPlayerId) return state;

  const def = CARDS_BY_ID[card.defId];
  const player = getPlayer(state, card.ownerId);

  const energyNeed = (def.energy ?? 0) - player.pool.energy;
  const totalPower = Object.values(player.pool.power).reduce((a, b) => a + b, 0);
  const powerNeed = (def.power ?? 0) - totalPower;

  if (energyNeed <= 0 && powerNeed <= 0) {
    return playCard(state, uid);
  }

  // Plan rune usage. We need (energyNeed) taps + (powerNeed) recycles.
  const ready = player.base.runes.filter((r) => !r.exhausted);
  const cardDomains = def.domains;
  const matching = ready.filter(
    (r) => cardDomains.includes(r.domain) || r.domain === "Colorless",
  );

  // Reserve `powerNeed` matching runes for recycling
  const reservedForPower = matching.slice(0, Math.max(0, powerNeed));
  if (reservedForPower.length < Math.max(0, powerNeed)) {
    log(state, `Cannot play ${def.name}: not enough matching runes for power.`);
    return state;
  }

  // The rest are tap candidates (preferring non-matching first to preserve flexibility)
  const tapCandidates = ready.filter(
    (r) => !reservedForPower.find((p) => p.uid === r.uid),
  );
  // Sort: non-matching first, then matching
  tapCandidates.sort((a, b) => {
    const aMatch = cardDomains.includes(a.domain) || a.domain === "Colorless";
    const bMatch = cardDomains.includes(b.domain) || b.domain === "Colorless";
    return Number(aMatch) - Number(bMatch);
  });

  if (tapCandidates.length < Math.max(0, energyNeed)) {
    log(state, `Cannot play ${def.name}: not enough runes for energy.`);
    return state;
  }

  // Auto-tap energy
  for (let i = 0; i < energyNeed; i++) {
    const r = tapCandidates[i];
    r.exhausted = true;
    player.pool.energy += 1;
  }
  if (energyNeed > 0) {
    log(
      state,
      `${player.name} auto-taps ${energyNeed} rune${energyNeed > 1 ? "s" : ""} for energy.`,
    );
  }

  if (powerNeed <= 0) {
    return playCard(state, uid);
  }

  // Need user input for power — set pendingPlay
  state.pendingPlay = {
    cardUid: uid,
    powerLeft: powerNeed,
    neededDomains: [...cardDomains],
  };
  log(
    state,
    `${player.name}: pick ${powerNeed} rune${powerNeed > 1 ? "s" : ""} to recycle for ${def.name}'s power.`,
  );
  return state;
}

export function isValidRecycleForPending(
  state: GameState,
  runeUid: string,
): boolean {
  const pending = state.pendingPlay;
  if (!pending) return false;
  const r = findRune(state, runeUid);
  if (!r) return false;
  if (r.exhausted) return false;
  if (r.zone !== "base") return false;
  if (r.ownerId !== state.turnPlayerId) return false;
  if (
    !pending.neededDomains.includes(r.domain) &&
    r.domain !== "Colorless"
  )
    return false;
  return true;
}

export function recycleForPending(
  state: GameState,
  runeUid: string,
): GameState {
  if (!isValidRecycleForPending(state, runeUid)) return state;
  // recycleRuneForPower already does the rune→deck and pool credit
  state = recycleRuneForPower(state, runeUid);
  if (!state.pendingPlay) return state;
  state.pendingPlay.powerLeft -= 1;
  if (state.pendingPlay.powerLeft <= 0) {
    const cardUid = state.pendingPlay.cardUid;
    state.pendingPlay = null;
    state = playCard(state, cardUid);
  }
  return state;
}

export function cancelPendingPlay(state: GameState): GameState {
  // Note: tapping rune for energy already happened and isn't reversed.
  // The user can manually untap each refundable rune afterwards.
  if (state.pendingPlay) {
    log(state, `Play cancelled.`);
    state.pendingPlay = null;
  }
  return state;
}

export function activateLegend(state: GameState, playerId: string): GameState {
  if (state.winnerId) return state;
  if (state.phase !== "main") return state;
  if (playerId !== state.turnPlayerId) return state;
  const p = getPlayer(state, playerId);
  const abilities = getAbilities(p.legendZone.id);
  if (!abilities?.activated?.length) {
    log(state, `${p.legendZone.name} has no implemented activated ability.`);
    return state;
  }
  const ab = abilities.activated[0];
  if (!ab.canActivate(state, playerId)) {
    log(state, `${p.name} cannot activate ${p.legendZone.name} right now.`);
    return state;
  }
  ab.resolve(state, playerId);
  return state;
}

export function canActivateLegend(state: GameState, playerId: string): boolean {
  if (state.winnerId) return false;
  if (state.phase !== "main") return false;
  if (playerId !== state.turnPlayerId) return false;
  const p = getPlayer(state, playerId);
  const abilities = getAbilities(p.legendZone.id);
  if (!abilities?.activated?.length) return false;
  return abilities.activated[0].canActivate(state, playerId);
}

export function getLegendActivationLabel(
  state: GameState,
  playerId: string,
): string | null {
  const p = getPlayer(state, playerId);
  const abilities = getAbilities(p.legendZone.id);
  if (!abilities?.activated?.length) return null;
  return abilities.activated[0].describe(state, playerId);
}

// ----------------------- triggers -----------------------

/** Walk every legend, every battlefield unit, and fire any ability whose
 * trigger kind matches and predicate passes. */
function emitTrigger(
  state: GameState,
  kind: TriggerKind,
  data?: Record<string, unknown>,
): void {
  for (const player of state.players) {
    // Legend triggers
    const legendAbilities = getAbilities(player.legendZone.id);
    if (legendAbilities?.triggers) {
      for (const t of legendAbilities.triggers) {
        if (t.kind !== kind) continue;
        const ctx: TriggerContext = {
          state,
          controllerId: player.id,
          sourceUid: null,
          data,
        };
        if (t.predicate && !t.predicate(ctx)) continue;
        log(state, t.describe(ctx));
        t.resolve(ctx);
      }
    }
    // Unit triggers (champions, others)
    for (const unit of player.base.units) {
      const ab = getAbilities(unit.defId);
      if (!ab?.triggers) continue;
      for (const t of ab.triggers) {
        if (t.kind !== kind) continue;
        const ctx: TriggerContext = {
          state,
          controllerId: player.id,
          sourceUid: unit.uid,
          data,
        };
        if (t.predicate && !t.predicate(ctx)) continue;
        log(state, t.describe(ctx));
        t.resolve(ctx);
      }
    }
  }
}

function processDelayedEffects(state: GameState) {
  const remaining: typeof state.delayedEffects = [];
  for (const eff of state.delayedEffects) {
    const phaseMatch = eff.fireOn.phase === state.phase;
    const playerMatch =
      !eff.fireOn.turnPlayerId || eff.fireOn.turnPlayerId === state.turnPlayerId;
    if (phaseMatch && playerMatch) {
      log(state, `Delayed: ${eff.description}`);
      switch (eff.kind) {
        case "add_rainbow_power": {
          const p = getPlayer(state, eff.ownerId);
          p.pool.power.Colorless += 1;
          break;
        }
        case "channel_runes": {
          const n = (eff.payload?.n as number) ?? 1;
          const p = getPlayer(state, eff.ownerId);
          for (let i = 0; i < n; i++) {
            const r = p.runeDeck.shift();
            if (!r) break;
            r.zone = "base";
            p.base.runes.push(r);
          }
          break;
        }
        case "draw": {
          const n = (eff.payload?.n as number) ?? 1;
          drawCards(state, eff.ownerId, n);
          break;
        }
      }
    } else {
      remaining.push(eff);
    }
  }
  state.delayedEffects = remaining;
}

// ---------------- public surface ----------------

export {
  shuffle,
  newCardInstance,
  newRuneInstance,
};
