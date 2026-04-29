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
): GameState {
  const p1 = buildPlayer("p1", p1Name, p1Deck);
  const p2 = buildPlayer("p2", p2Name, p2Deck);

  // Battlefield selection: each player provides 3, randomly pick. MVP: simply take 1 each.
  const bfDefs: Record<string, CardDefinition> = {};
  const battlefields: BattlefieldInstance[] = [];
  const allBfPool = [...p1Deck.battlefieldIds, ...p2Deck.battlefieldIds];
  const picked = shuffle(allBfPool).slice(0, BATTLEFIELDS_PER_GAME);
  for (const id of picked) {
    const def = CARDS_BY_ID[id];
    if (!def) continue;
    bfDefs[id] = def;
    const ownerId =
      p1Deck.battlefieldIds.includes(id) ? "p1" : "p2";
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
      // Ready everything (units, gear, runes) at active player's locations
      for (const u of active.base.units) u.exhausted = false;
      for (const g of active.base.gear) g.exhausted = false;
      for (const r of active.base.runes) r.exhausted = false;
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
  if (!canStandardMove(state, unitUid, destBfUid)) return state;
  const card = findCard(state, unitUid);
  if (!card) return state;
  const def = CARDS_BY_ID[card.defId];
  const player = getPlayer(state, card.controllerId);
  card.exhausted = true;
  card.battlefieldId = destBfUid ?? undefined;
  if (destBfUid) {
    log(
      state,
      `${player.name} moves ${def.name} to ${state.battlefieldDefs[
        state.battlefields.find((b) => b.uid === destBfUid)!.defId
      ].name}.`,
    );
  } else {
    log(state, `${player.name} moves ${def.name} back to base.`);
  }
  // Check contested
  checkContested(state);
  // Auto-resolve combat at end of move (MVP simplification)
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

// ---------------- public surface ----------------

export {
  shuffle,
  newCardInstance,
  newRuneInstance,
};
