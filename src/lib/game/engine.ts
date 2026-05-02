// Riftbound TCG engine — implements official rules.
//
// Implemented:
// - Two players, 8 victory points, 2 battlefields
// - Champion Legend + Chosen Champion + Main Deck + Rune Deck zones
// - Phases: Awaken / Beginning(scoring=Hold) / Channel / Draw / Main / Ending
// - Energy + Power resource pool, basic runes (tap=Energy, recycle=Power)
// - Standard Move: exhaust unit to move base ↔ battlefield
// - Combat Showdown: action window before damage; Action/Reaction cards playable
// - Combat damage: sum-Might, Tank/Backline ordering, Shield/Assault, Deathknell
// - Scoring: Conquer (gain control) + Hold (maintain at Beginning)
// - Burn Out when deck empty
// - Mulligan: set aside up to 2 cards at game start, draw replacements

import { nanoid } from "nanoid";
import {
  BattlefieldInstance,
  CardDefinition,
  CardInstance,
  DeckList,
  Domain,
  GameState,
  MulliganState,
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
const MULLIGAN_MAX = 2;

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

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newCardInstance(defId: string, ownerId: string): CardInstance {
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

export function newRuneInstance(defId: string, ownerId: string): RuneInstance {
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
    pendingSpellTarget: null,
    delayedEffects: [],
    mulliganState: null,
  };

  // Apply static battlefield modifiers (e.g. Aspirant's Climb)
  const ASPIRANTS_CLIMB_ID = "69bc5befd308c64675ca89c0";
  for (const defId of Object.keys(state.battlefieldDefs)) {
    if (defId === ASPIRANTS_CLIMB_ID) state.victoryScore += 1;
  }

  // Initialize mulligan before starting phases
  initMulligan(state);
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
  m += card.tempMightThisTurn ?? 0;
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

// Returns whether the game is currently in a state that blocks normal play
function isInCombatShowdown(state: GameState): boolean {
  return state.combat?.step === "showdown";
}

// ---------------- mulligan ----------------

function initMulligan(state: GameState): void {
  state.mulliganState = {
    players: state.players.map((p) => ({
      id: p.id,
      setAside: [],
      done: false,
    })),
  };
  log(state, `Mulligan: each player may set aside up to ${MULLIGAN_MAX} cards.`);
}

export function finalizeMulligan(
  state: GameState,
  playerId: string,
  setAsideUids: string[],
): GameState {
  if (!state.mulliganState) return state;
  const ms = state.mulliganState.players.find((p) => p.id === playerId);
  if (!ms || ms.done) return state;

  const player = getPlayer(state, playerId);
  const capped = setAsideUids.slice(0, MULLIGAN_MAX);

  // Remove chosen cards from hand
  const setAsideCards: CardInstance[] = [];
  for (const uid of capped) {
    const idx = player.hand.findIndex((c) => c.uid === uid);
    if (idx >= 0) {
      setAsideCards.push(player.hand.splice(idx, 1)[0]);
    }
  }

  // Draw replacements first, then recycle set-aside cards
  drawCards(state, playerId, setAsideCards.length);

  for (const c of setAsideCards) {
    c.zone = "main_deck";
    // Per rules: recycled (go to bottom of main deck)
    player.mainDeck.push(c);
  }

  ms.done = true;
  log(
    state,
    `${player.name} mulligans ${setAsideCards.length} card${setAsideCards.length !== 1 ? "s" : ""}.`,
  );

  // If all players done, end mulligan and start first turn
  if (state.mulliganState.players.every((p) => p.done)) {
    state.mulliganState = null;
    log(state, `Mulligan complete — game begins.`);
    enterPhase(state, "awaken");
  }

  return state;
}

// ---------------- phases ----------------

export function enterPhase(state: GameState, phase: GameState["phase"]) {
  state.phase = phase;
  const active = getPlayer(state, state.turnPlayerId);
  switch (phase) {
    case "awaken":
      for (const u of active.base.units) u.exhausted = false;
      for (const g of active.base.gear) g.exhausted = false;
      for (const r of active.base.runes) r.exhausted = false;
      active.legendExhausted = false;
      for (const u of active.base.units) u.enteredThisTurn = false;
      log(state, `${active.name}: Awaken Phase.`);
      enterPhase(state, "beginning");
      break;
    case "beginning":
      for (const bf of state.battlefields) {
        bf.scoredByThisTurn = bf.scoredByThisTurn.filter(
          (id) => id !== active.id,
        );
      }
      emitTrigger(state, "atBeginningStart", { playerId: active.id });
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
      drawCards(state, active.id, 1);
      log(state, `${active.name}: Draw Phase.`);
      for (const p of state.players) p.pool = emptyPool();
      enterPhase(state, "main");
      break;
    case "main":
      log(state, `${active.name}: Main Phase.`);
      processDelayedEffects(state);
      break;
    case "ending":
      log(state, `${active.name}: Ending Phase.`);
      emitTrigger(state, "atEndOfTurn", { playerId: active.id });
      for (const p of state.players) {
        for (const u of p.base.units) {
          u.damage = 0;
          (u as any).tempMightThisTurn = 0;
        }
        p.pool = emptyPool();
      }
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
  // Cannot end turn during mulligan or a combat showdown
  if (state.mulliganState) return state;
  if (isInCombatShowdown(state)) {
    log(state, `Cannot end turn during a Showdown.`);
    return state;
  }
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
  for (const c of p.trash) c.zone = "main_deck";
  p.mainDeck = shuffle([...p.mainDeck, ...p.trash]);
  p.trash = [];
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

  // During a combat showdown, the focus player may tap runes (rune tap is a Reaction)
  const allowedId = isInCombatShowdown(state)
    ? state.combat!.showdownFocusId
    : state.turnPlayerId;
  if (r.ownerId !== allowedId) return state;

  r.exhausted = true;
  const p = getPlayer(state, r.ownerId);
  p.pool.energy += 1;
  log(state, `${p.name} taps ${CARDS_BY_ID[r.defId]?.name ?? "rune"} for [1].`);
  if (state.pendingPlay) {
    state.pendingPlay.energyLeft = Math.max(0, state.pendingPlay.energyLeft - 1);
    tryFinalizePending(state);
  }
  return state;
}

export function canUntapRune(state: GameState, runeUid: string): boolean {
  const r = findRune(state, runeUid);
  if (!r) return false;
  if (!r.exhausted) return false;
  if (r.zone !== "base") return false;
  const allowedId = isInCombatShowdown(state)
    ? state.combat!.showdownFocusId
    : state.turnPlayerId;
  if (r.ownerId !== allowedId) return false;
  if (state.phase !== "main") return false;
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

  const allowedId = isInCombatShowdown(state)
    ? state.combat!.showdownFocusId
    : state.turnPlayerId;
  if (r.ownerId !== allowedId) return state;

  const p = getPlayer(state, r.ownerId);
  p.base.runes = p.base.runes.filter((x) => x.uid !== runeUid);
  r.zone = "rune_deck";
  r.exhausted = false;
  p.runeDeck.push(r);
  const domain = r.domain;
  if (domain === "Colorless") {
    p.pool.power.Colorless += 1;
  } else {
    p.pool.power[domain] += 1;
  }
  log(state, `${p.name} recycles rune for [${domain[0]}].`);
  if (state.pendingPlay) {
    const pp = state.pendingPlay;
    if (pp.neededDomains.includes(domain) || domain === "Colorless") {
      pp.powerLeft = Math.max(0, pp.powerLeft - 1);
    }
    tryFinalizePending(state);
  }
  return state;
}

function canPayCost(
  pool: ResourcePool,
  energyCost: number,
  powerCost: number,
  domains: Domain[],
): boolean {
  const colorless = pool.power.Colorless ?? 0;
  let availableMatching = colorless;
  for (const d of domains) {
    if (d === "Colorless") continue;
    availableMatching += pool.power[d] ?? 0;
  }
  if (availableMatching < powerCost) return false;
  if (pool.energy < energyCost) return false;
  return true;
}

function payCost(
  pool: ResourcePool,
  energyCost: number,
  powerCost: number,
  domains: Domain[],
) {
  pool.energy -= energyCost;
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
  if (state.mulliganState) return false;

  const card = findCard(state, uid);
  if (!card) return false;
  if (card.zone !== "hand" && card.zone !== "champion_zone") return false;

  const def = CARDS_BY_ID[card.defId];

  if (isInCombatShowdown(state)) {
    // Only the focus player may play cards during the showdown window
    if (card.ownerId !== state.combat!.showdownFocusId) return false;
    // Only Action or Reaction keyword cards are playable during a Showdown
    if (!def.keywords.includes("Action") && !def.keywords.includes("Reaction")) {
      return false;
    }
  } else {
    if (state.phase !== "main") return false;
    if (card.ownerId !== state.turnPlayerId) return false;
  }

  const player = getPlayer(state, card.ownerId);
  const energy = def.energy ?? 0;
  const power = def.power ?? 0;
  return canPayCost(player.pool, energy, power, def.domains);
}

export function playCard(state: GameState, uid: string): GameState {
  if (!canPlayCard(state, uid)) return state;
  const card = findCard(state, uid);
  if (!card) return state;
  const def = CARDS_BY_ID[card.defId];
  const player = getPlayer(state, card.ownerId);

  payCost(player.pool, def.energy ?? 0, def.power ?? 0, def.domains);

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
    const ab = getAbilities(def.id);
    if (ab?.spell) {
      log(state, `${player.name} casts ${def.name}: ${ab.spell.describe}.`);
      if (ab.spell.target.kind === "none") {
        ab.spell.resolve(state, player.id);
        card.zone = "trash";
        player.trash.push(card);
      } else {
        state.pendingSpellTarget = {
          spellUid: card.uid,
          defId: def.id,
          casterId: player.id,
          targetKind: ab.spell.target.kind,
          description: ab.spell.describe,
        };
        card.zone = "banishment";
        player.banishment.push(card);
      }
    } else {
      card.zone = "trash";
      player.trash.push(card);
      log(state, `${player.name} casts ${def.name} (effects not implemented).`);
    }
    emitTrigger(state, "onPlaySpell", {
      spellDefId: def.id,
      energyCost: def.energy ?? 0,
      powerCost: def.power ?? 0,
      casterId: player.id,
    });
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
  if (state.mulliganState) return false;
  const card = findCard(state, unitUid);
  if (!card) return false;
  if (card.controllerId !== state.turnPlayerId) return false;
  if (card.exhausted) return false;
  const def = CARDS_BY_ID[card.defId];
  if (def.type !== "Unit") return false;
  if (card.zone !== "base") return false;
  return true;
}

export function standardMove(
  state: GameState,
  unitUid: string,
  destBfUid: string | null,
): GameState {
  return standardMoveMultiple(state, [unitUid], destBfUid);
}

export function standardMoveMultiple(
  state: GameState,
  unitUids: string[],
  destBfUid: string | null,
): GameState {
  const movers: { card: CardInstance; def: CardDefinition }[] = [];
  for (const uid of unitUids) {
    if (!canStandardMove(state, uid, destBfUid)) return state;
    const card = findCard(state, uid);
    if (!card) return state;
    movers.push({ card, def: CARDS_BY_ID[card.defId] });
  }
  if (movers.length === 0) return state;

  const playerName = getPlayer(state, movers[0].card.controllerId).name;

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
        `${playerName} moves ${movers.length} units to ${bfDef.name} (${movers.map((m) => m.def.name).join(", ")}).`,
      );
    }
  } else {
    if (movers.length === 1) {
      log(state, `${playerName} moves ${movers[0].def.name} back to base.`);
    } else {
      log(state, `${playerName} returns ${movers.length} units to base.`);
    }
  }

  for (const m of movers) {
    emitTrigger(state, "onOpponentMove", {
      destBfUid: destBfUid ?? null,
      movedUnitUid: m.card.uid,
      moverId: m.card.controllerId,
    });
  }

  checkContested(state);
  initiateContestedActions(state);
  return state;
}

function checkContested(state: GameState) {
  for (const bf of state.battlefields) {
    const units = unitsAtBattlefield(state, bf.uid);
    if (units.length === 0) {
      bf.contested = false;
      continue;
    }
    const players = new Set(units.map((u) => u.player.id));
    if (bf.controllerId && players.size === 1 && players.has(bf.controllerId)) {
      bf.contested = false;
      continue;
    }
    bf.contested = true;
  }
}

/**
 * After a move, check for contested battlefields and either:
 * - Establish uncontested control immediately (only one side present)
 * - Initiate a Combat Showdown (two sides present)
 */
function initiateContestedActions(state: GameState) {
  for (const bf of state.battlefields) {
    const units = unitsAtBattlefield(state, bf.uid);
    const playersHere = [...new Set(units.map((u) => u.player.id))];

    if (playersHere.length === 0) {
      if (bf.controllerId !== null) {
        bf.controllerId = null;
        bf.contested = false;
        log(state, `${state.battlefieldDefs[bf.defId].name} becomes uncontrolled.`);
      }
      continue;
    }

    if (playersHere.length === 1) {
      const onlyPlayer = playersHere[0];
      if (bf.controllerId !== onlyPlayer) {
        establishControl(state, bf, onlyPlayer);
      }
      bf.contested = false;
      continue;
    }

    // Two sides present → start Combat Showdown (if not already in one here)
    if (playersHere.length >= 2 && (!state.combat || state.combat.battlefieldUid !== bf.uid)) {
      const attackerId =
        bf.controllerId && playersHere.includes(bf.controllerId)
          ? playersHere.find((p) => p !== bf.controllerId)!
          : state.turnPlayerId;
      const defenderId = playersHere.find((p) => p !== attackerId)!;

      state.combat = {
        battlefieldUid: bf.uid,
        attackerId,
        defenderId,
        step: "showdown",
        showdownFocusId: attackerId,
        showdownPassCount: 0,
      };
      const bfName = state.battlefieldDefs[bf.defId]?.name ?? bf.uid;
      log(
        state,
        `⚔️ Combat Showdown at ${bfName}! ${getPlayer(state, attackerId).name} has focus — play an Action card or pass.`,
      );
      break; // handle one combat at a time
    }
  }
}

// ---------------- combat showdown ----------------

/**
 * Pass focus during the Combat Showdown.
 * When both players pass consecutively the damage step executes.
 */
export function passShowdown(state: GameState, playerId: string): GameState {
  if (!state.combat || state.combat.step !== "showdown") return state;
  if (state.combat.showdownFocusId !== playerId) return state;

  const combat = state.combat;
  const opp = getOpponent(state, playerId);
  combat.showdownPassCount++;

  if (combat.showdownPassCount >= 2) {
    // Both passed — run damage
    log(state, `Both players passed — combat damage resolves.`);
    state.combat = null;
    const bf = state.battlefields.find((b) => b.uid === combat.battlefieldUid);
    if (bf) runCombatDamage(state, bf, combat.attackerId, combat.defenderId);
  } else {
    // Pass focus to the other player
    combat.showdownFocusId = opp.id;
    const bfName = state.battlefieldDefs[combat.battlefieldUid]?.name ?? "";
    log(
      state,
      `${getPlayer(state, playerId).name} passes — ${opp.name} has focus at ${bfName}.`,
    );
  }

  return state;
}

export function canPassShowdown(state: GameState, playerId: string): boolean {
  return (
    state.combat?.step === "showdown" &&
    state.combat.showdownFocusId === playerId
  );
}

// ---------------- combat damage ----------------

function establishControl(
  state: GameState,
  bf: BattlefieldInstance,
  newControllerId: string,
) {
  bf.controllerId = newControllerId;
  bf.contested = false;
  score(state, newControllerId, bf.uid, "Conquer");
}

function runCombatDamage(
  state: GameState,
  bf: BattlefieldInstance,
  attackerId: string,
  defenderId: string,
) {
  const units = unitsAtBattlefield(state, bf.uid);
  const attackers = units.filter((u) => u.player.id === attackerId);
  const defenders = units.filter((u) => u.player.id === defenderId);

  if (attackers.length === 0 && defenders.length === 0) return;

  function effMight(card: CardInstance, role: "attacker" | "defender"): number {
    const def = CARDS_BY_ID[card.defId];
    let m = (def.might ?? 0) + card.buffCount + (card.tempMightThisTurn ?? 0);
    if (role === "attacker") m += def.assault ?? 0;
    if (role === "defender") m += def.shield ?? 0;
    // Garen - Commander aura
    const garenCommanderId = "69bc5bd9d308c64675ca8822";
    if (card.battlefieldId) {
      const owner = state.players.find((p) =>
        p.base.units.find((u) => u.uid === card.uid),
      );
      if (owner) {
        const hasCommanderAdjacent = owner.base.units.some(
          (u) =>
            u.uid !== card.uid &&
            u.battlefieldId === card.battlefieldId &&
            u.defId === garenCommanderId,
        );
        if (hasCommanderAdjacent) m += 1;
      }
    }
    return Math.max(0, m);
  }

  const totalAtk = attackers.reduce((s, u) => s + effMight(u.unit, "attacker"), 0);
  const totalDef = defenders.reduce((s, u) => s + effMight(u.unit, "defender"), 0);

  const bfName = state.battlefieldDefs[bf.defId]?.name ?? bf.uid;
  log(state, `Combat at ${bfName}: ${totalAtk} vs ${totalDef}.`);

  function assignDamage(
    fromTotal: number,
    targets: { unit: CardInstance; player: PlayerState }[],
  ) {
    let remaining = fromTotal;
    const sortedTargets = [...targets].sort((a, b) => {
      const ka = CARDS_BY_ID[a.unit.defId].keywords;
      const kb = CARDS_BY_ID[b.unit.defId].keywords;
      const aOrder = ka.includes("Tank") ? 0 : ka.includes("Backline") ? 2 : 1;
      const bOrder = kb.includes("Tank") ? 0 : kb.includes("Backline") ? 2 : 1;
      return aOrder - bOrder;
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

  assignDamage(totalAtk, defenders);
  assignDamage(totalDef, attackers);

  killDead(state);

  // Combat cleanup — heal survivors, determine control
  const remainingUnits = unitsAtBattlefield(state, bf.uid);
  for (const u of remainingUnits) u.unit.damage = 0;
  const remPlayers = new Set(remainingUnits.map((u) => u.player.id));

  if (remPlayers.size === 1) {
    const winner = [...remPlayers][0];
    if (bf.controllerId !== winner) {
      establishControl(state, bf, winner);
    } else {
      log(state, `${getPlayer(state, winner).name} maintains control.`);
      bf.contested = false;
    }
  } else if (remPlayers.size === 0) {
    bf.controllerId = null;
    bf.contested = false;
    log(state, `Battlefield left uncontrolled.`);
  } else {
    bf.contested = true;
  }
}

function killDead(state: GameState) {
  const dying: { unit: CardInstance; player: PlayerState }[] = [];
  for (const p of state.players) {
    for (const u of p.base.units) {
      const def = CARDS_BY_ID[u.defId];
      if (u.damage >= (def.might ?? 0) + u.buffCount) {
        dying.push({ unit: u, player: p });
      }
    }
  }
  for (const { unit, player } of dying) {
    emitTrigger(state, "onDie", {
      unitUid: unit.uid,
      controllerId: player.id,
      battlefieldId: unit.battlefieldId,
    });
  }
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

export function attemptPlayCard(state: GameState, uid: string): GameState {
  if (state.winnerId) return state;
  if (state.mulliganState) return state;
  if (state.pendingPlay) return state;

  const card = findCard(state, uid);
  if (!card) return state;
  if (card.zone !== "hand" && card.zone !== "champion_zone") return state;

  // Determine who is the allowed player
  const allowedId = isInCombatShowdown(state)
    ? state.combat!.showdownFocusId
    : state.turnPlayerId;
  if (card.ownerId !== allowedId) return state;

  const def = CARDS_BY_ID[card.defId];

  // During showdown, only Action/Reaction cards
  if (isInCombatShowdown(state)) {
    if (!def.keywords.includes("Action") && !def.keywords.includes("Reaction")) {
      return state;
    }
  }

  const player = getPlayer(state, card.ownerId);
  const energyNeed = Math.max(0, (def.energy ?? 0) - player.pool.energy);
  const totalPower = Object.values(player.pool.power).reduce((a, b) => a + b, 0);
  const powerNeed = Math.max(0, (def.power ?? 0) - totalPower);

  if (energyNeed === 0 && powerNeed === 0) {
    return playCard(state, uid);
  }

  const ready = player.base.runes.filter((r) => !r.exhausted);
  const allMatching = player.base.runes.filter(
    (r) => def.domains.includes(r.domain) || r.domain === "Colorless",
  );
  if (ready.length < Math.max(energyNeed, powerNeed)) {
    log(state, `Cannot play ${def.name}: not enough ready runes.`);
    return state;
  }
  if (allMatching.length < powerNeed) {
    log(state, `Cannot play ${def.name}: not enough matching runes for power.`);
    return state;
  }

  state.pendingPlay = {
    cardUid: uid,
    energyLeft: energyNeed,
    powerLeft: powerNeed,
    neededDomains: [...def.domains],
  };
  log(state, `${player.name}: pay ${energyNeed} energy + ${powerNeed} power for ${def.name}.`);
  return state;
}

function tryFinalizePending(state: GameState) {
  const pp = state.pendingPlay;
  if (!pp) return;
  if (pp.energyLeft > 0 || pp.powerLeft > 0) return;
  const cardUid = pp.cardUid;
  state.pendingPlay = null;
  playCard(state, cardUid);
}

export function isValidRecycleForPending(
  state: GameState,
  runeUid: string,
): boolean {
  const pending = state.pendingPlay;
  if (!pending) return false;
  const r = findRune(state, runeUid);
  if (!r) return false;
  if (r.zone !== "base") return false;
  const allowedId = isInCombatShowdown(state)
    ? state.combat!.showdownFocusId
    : state.turnPlayerId;
  if (r.ownerId !== allowedId) return false;
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
  if (isInCombatShowdown(state)) return state;
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
  if (isInCombatShowdown(state)) return false;
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

// ----------------------- gear / card activated abilities -----------------------

export function canActivateCard(
  state: GameState,
  playerId: string,
  cardUid: string,
): boolean {
  if (state.winnerId) return false;
  const p = getPlayer(state, playerId);
  const gear = p.base.gear.find((g) => g.uid === cardUid);
  if (!gear) return false;
  const abilities = getAbilities(gear.defId);
  if (!abilities?.activated?.length) return false;
  return abilities.activated[0].canActivate(state, playerId);
}

export function activateCard(state: GameState, cardUid: string): GameState {
  if (state.winnerId) return state;
  let ownerId: string | null = null;
  for (const p of state.players) {
    if (p.base.gear.find((g) => g.uid === cardUid)) {
      ownerId = p.id;
      break;
    }
  }
  if (!ownerId) return state;
  const p = getPlayer(state, ownerId);
  const gear = p.base.gear.find((g) => g.uid === cardUid)!;
  const abilities = getAbilities(gear.defId);
  if (!abilities?.activated?.length) {
    log(state, `${gear.defId} has no activated ability.`);
    return state;
  }
  const ab = abilities.activated[0];
  if (!ab.canActivate(state, ownerId)) {
    log(state, `Cannot activate ${gear.defId} right now.`);
    return state;
  }
  ab.resolve(state, ownerId);
  return state;
}

// ----------------------- spell target resolution -----------------------

export function isValidSpellTarget(
  state: GameState,
  targetUid: string,
): boolean {
  const p = state.pendingSpellTarget;
  if (!p) return false;
  switch (p.targetKind) {
    case "any_unit": {
      for (const pl of state.players) {
        if (pl.base.units.find((u) => u.uid === targetUid)) return true;
      }
      return false;
    }
    case "enemy_unit": {
      const opp = state.players.find((pl) => pl.id !== p.casterId);
      return !!opp?.base.units.find((u) => u.uid === targetUid);
    }
    case "friendly_unit": {
      const me = state.players.find((pl) => pl.id === p.casterId);
      return !!me?.base.units.find((u) => u.uid === targetUid);
    }
    case "battlefield":
      return !!state.battlefields.find((b) => b.uid === targetUid);
    case "player":
      return !!state.players.find((pl) => pl.id === targetUid);
    case "unit_at_battlefield": {
      for (const pl of state.players) {
        const u = pl.base.units.find((u) => u.uid === targetUid);
        if (u && u.battlefieldId) return true;
      }
      return false;
    }
    case "enemy_unit_at_battlefield": {
      const opp = state.players.find((pl) => pl.id !== p.casterId);
      return !!opp?.base.units.find(
        (u) => u.uid === targetUid && !!u.battlefieldId,
      );
    }
    case "friendly_unit_at_base": {
      const me = state.players.find((pl) => pl.id === p.casterId);
      return !!me?.base.units.find(
        (u) => u.uid === targetUid && !u.battlefieldId,
      );
    }
  }
}

export function resolveSpellTarget(
  state: GameState,
  targetUid: string,
): GameState {
  const p = state.pendingSpellTarget;
  if (!p) return state;
  if (!isValidSpellTarget(state, targetUid)) return state;
  const ab = getAbilities(p.defId);
  if (!ab?.spell) {
    state.pendingSpellTarget = null;
    return state;
  }
  ab.spell.resolve(state, p.casterId, targetUid);
  for (const pl of state.players) {
    const idx = pl.banishment.findIndex((c) => c.uid === p.spellUid);
    if (idx >= 0) {
      const c = pl.banishment.splice(idx, 1)[0];
      c.zone = "trash";
      pl.trash.push(c);
      break;
    }
  }
  state.pendingSpellTarget = null;
  killDead(state);
  return state;
}

export function cancelSpellTarget(state: GameState): GameState {
  const p = state.pendingSpellTarget;
  if (!p) return state;
  for (const pl of state.players) {
    const idx = pl.banishment.findIndex((c) => c.uid === p.spellUid);
    if (idx >= 0) {
      const c = pl.banishment.splice(idx, 1)[0];
      c.zone = "hand";
      pl.hand.push(c);
      break;
    }
  }
  log(state, `Spell cancelled (returned to hand).`);
  state.pendingSpellTarget = null;
  return state;
}

// ----------------------- triggers -----------------------

function emitTrigger(
  state: GameState,
  kind: TriggerKind,
  data?: Record<string, unknown>,
): void {
  for (const player of state.players) {
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
