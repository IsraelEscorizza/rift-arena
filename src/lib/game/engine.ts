import { nanoid } from "nanoid";
import { getCard } from "@/lib/cards/database";
import {
  CardInstance,
  Deck,
  GameState,
  Phase,
  PlayerState,
} from "./types";

const STARTING_LIFE = 20;
const STARTING_HAND = 5;

export function createCardInstance(
  defId: string,
  ownerId: string,
): CardInstance {
  return {
    uid: nanoid(8),
    defId,
    ownerId,
    controllerId: ownerId,
    zone: "deck",
    tapped: false,
    summoningSick: false,
    damage: 0,
    buffs: { attack: 0, health: 0 },
  };
}

export function buildDeck(deck: Deck, ownerId: string): CardInstance[] {
  const cards: CardInstance[] = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.quantity; i++) {
      cards.push(createCardInstance(entry.defId, ownerId));
    }
  }
  return shuffle(cards);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createPlayer(
  id: string,
  name: string,
  deck: Deck,
): PlayerState {
  const deckInstances = buildDeck(deck, id);
  const hand = deckInstances.splice(0, STARTING_HAND).map((c) => ({
    ...c,
    zone: "hand" as const,
  }));
  return {
    id,
    name,
    life: STARTING_LIFE,
    maxResource: 0,
    resource: 0,
    deck: deckInstances,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    hasPlayedResource: false,
  };
}

export function createGame(
  p1Name: string,
  p1Deck: Deck,
  p2Name: string,
  p2Deck: Deck,
): GameState {
  const p1 = createPlayer("p1", p1Name, p1Deck);
  const p2 = createPlayer("p2", p2Name, p2Deck);
  return {
    players: [p1, p2],
    activePlayerId: p1.id,
    priorityPlayerId: p1.id,
    turn: 1,
    phase: "main1",
    combat: null,
    log: [`${p1Name} vs ${p2Name} — game start.`],
    winnerId: null,
    pendingTargets: null,
  };
}

export function getPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((p) => p.id === id);
  if (!p) throw new Error(`Player not found: ${id}`);
  return p;
}

export function getOpponent(state: GameState, id: string): PlayerState {
  return state.players.find((p) => p.id !== id)!;
}

export function findCard(
  state: GameState,
  uid: string,
): { card: CardInstance; player: PlayerState } | null {
  for (const player of state.players) {
    const zones = [
      player.hand,
      player.battlefield,
      player.graveyard,
      player.exile,
      player.deck,
    ];
    for (const zone of zones) {
      const card = zone.find((c) => c.uid === uid);
      if (card) return { card, player };
    }
  }
  return null;
}

function log(state: GameState, msg: string) {
  state.log.push(msg);
  if (state.log.length > 100) state.log.shift();
}

export function drawCards(state: GameState, playerId: string, n: number) {
  const player = getPlayer(state, playerId);
  for (let i = 0; i < n; i++) {
    const card = player.deck.shift();
    if (!card) {
      player.life -= 2;
      log(state, `${player.name} fails to draw and loses 2 life (fatigue).`);
      checkWin(state);
      continue;
    }
    card.zone = "hand";
    player.hand.push(card);
  }
}

export function canPlayCard(state: GameState, uid: string): boolean {
  if (state.winnerId) return false;
  const found = findCard(state, uid);
  if (!found) return false;
  const { card, player } = found;
  if (card.zone !== "hand") return false;
  if (player.id !== state.activePlayerId) return false;
  if (state.phase !== "main1" && state.phase !== "main2") return false;
  const def = getCard(card.defId);
  if (def.type === "resource") {
    return !player.hasPlayedResource;
  }
  return player.resource >= def.cost;
}

export function playCard(
  state: GameState,
  uid: string,
  targetUid?: string,
): GameState {
  if (!canPlayCard(state, uid)) return state;
  const found = findCard(state, uid);
  if (!found) return state;
  const { card, player } = found;
  const def = getCard(card.defId);

  player.hand = player.hand.filter((c) => c.uid !== uid);

  if (def.type === "resource") {
    card.zone = "battlefield";
    player.battlefield.push(card);
    player.maxResource += 1;
    player.resource = player.maxResource;
    player.hasPlayedResource = true;
    log(state, `${player.name} plays resource ${def.name}.`);
    return state;
  }

  player.resource -= def.cost;

  if (def.type === "unit" || def.type === "champion") {
    card.zone = "battlefield";
    card.summoningSick = !def.keywords?.includes("haste");
    player.battlefield.push(card);
    log(state, `${player.name} summons ${def.name}.`);
    return state;
  }

  if (def.type === "spell") {
    log(state, `${player.name} casts ${def.name}.`);
    if (def.effects) {
      for (const effect of def.effects) {
        applyEffect(state, player.id, effect, targetUid);
      }
    }
    card.zone = "graveyard";
    player.graveyard.push(card);
  }

  return state;
}

function applyEffect(
  state: GameState,
  casterId: string,
  effect: NonNullable<ReturnType<typeof getCard>["effects"]>[number],
  targetUid?: string,
) {
  const caster = getPlayer(state, casterId);
  const opponent = getOpponent(state, casterId);

  switch (effect.kind) {
    case "damage": {
      const amount = effect.amount ?? 0;
      if (targetUid) {
        if (targetUid === "p1" || targetUid === "p2") {
          const target = getPlayer(state, targetUid);
          target.life -= amount;
          log(state, `${target.name} takes ${amount} damage.`);
        } else {
          const found = findCard(state, targetUid);
          if (found) {
            found.card.damage += amount;
            log(state, `${getCard(found.card.defId).name} takes ${amount} damage.`);
          }
        }
      } else {
        opponent.life -= amount;
        log(state, `${opponent.name} takes ${amount} damage.`);
      }
      break;
    }
    case "heal": {
      const amount = effect.amount ?? 0;
      caster.life += amount;
      log(state, `${caster.name} heals ${amount}.`);
      break;
    }
    case "draw": {
      drawCards(state, casterId, effect.amount ?? 1);
      log(state, `${caster.name} draws ${effect.amount ?? 1}.`);
      break;
    }
    case "destroy": {
      if (targetUid) {
        const found = findCard(state, targetUid);
        if (found) {
          found.player.battlefield = found.player.battlefield.filter(
            (c) => c.uid !== targetUid,
          );
          found.card.zone = "graveyard";
          found.player.graveyard.push(found.card);
          log(state, `${getCard(found.card.defId).name} is destroyed.`);
        }
      }
      break;
    }
  }
  checkStateBased(state);
  checkWin(state);
}

export function checkStateBased(state: GameState) {
  for (const player of state.players) {
    const survivors: CardInstance[] = [];
    for (const card of player.battlefield) {
      const def = getCard(card.defId);
      if (def.type === "unit" || def.type === "champion") {
        const totalHealth = (def.health ?? 0) + card.buffs.health;
        if (card.damage >= totalHealth) {
          card.zone = "graveyard";
          card.damage = 0;
          player.graveyard.push(card);
          log(state, `${def.name} is destroyed.`);
          continue;
        }
      }
      survivors.push(card);
    }
    player.battlefield = survivors;
  }
}

export function checkWin(state: GameState) {
  if (state.winnerId) return;
  for (const player of state.players) {
    if (player.life <= 0) {
      const winner = getOpponent(state, player.id);
      state.winnerId = winner.id;
      log(state, `${winner.name} wins!`);
    }
  }
}

const PHASE_ORDER: Phase[] = [
  "untap",
  "draw",
  "main1",
  "combat_declare_attackers",
  "combat_declare_blockers",
  "combat_damage",
  "main2",
  "end",
];

export function nextPhase(state: GameState): GameState {
  if (state.winnerId) return state;
  const idx = PHASE_ORDER.indexOf(state.phase);
  if (idx === PHASE_ORDER.length - 1) {
    return endTurn(state);
  }
  const next = PHASE_ORDER[idx + 1];
  state.phase = next;
  enterPhase(state);
  return state;
}

function enterPhase(state: GameState) {
  const active = getPlayer(state, state.activePlayerId);
  switch (state.phase) {
    case "untap":
      for (const c of active.battlefield) c.tapped = false;
      log(state, `${active.name}'s untap.`);
      nextPhase(state);
      break;
    case "draw":
      if (state.turn === 1 && state.activePlayerId === "p1") {
        log(state, `${active.name}'s draw (skipped on first turn).`);
      } else {
        drawCards(state, active.id, 1);
        log(state, `${active.name} draws.`);
      }
      break;
    case "combat_damage":
      resolveCombatDamage(state);
      break;
    case "end":
      log(state, `${active.name}'s end step.`);
      break;
  }
}

export function endTurn(state: GameState): GameState {
  const active = getPlayer(state, state.activePlayerId);
  for (const c of active.battlefield) {
    c.tapped = false;
    c.summoningSick = false;
  }
  active.hasPlayedResource = false;
  const next = getOpponent(state, state.activePlayerId);
  state.activePlayerId = next.id;
  state.priorityPlayerId = next.id;
  state.turn += 1;
  state.phase = "untap";
  state.combat = null;
  log(state, `Turn ${state.turn} — ${next.name}.`);
  enterPhase(state);
  return state;
}

export function declareAttacker(state: GameState, uid: string): GameState {
  if (state.phase !== "combat_declare_attackers") return state;
  const found = findCard(state, uid);
  if (!found) return state;
  if (found.player.id !== state.activePlayerId) return state;
  if (found.card.tapped || found.card.summoningSick) return state;
  if (!state.combat) state.combat = { attackers: [] };
  if (state.combat.attackers.find((a) => a.attackerUid === uid)) {
    state.combat.attackers = state.combat.attackers.filter(
      (a) => a.attackerUid !== uid,
    );
  } else {
    state.combat.attackers.push({ attackerUid: uid });
  }
  return state;
}

export function assignBlocker(
  state: GameState,
  attackerUid: string,
  blockerUid: string | undefined,
): GameState {
  if (state.phase !== "combat_declare_blockers") return state;
  if (!state.combat) return state;
  const entry = state.combat.attackers.find(
    (a) => a.attackerUid === attackerUid,
  );
  if (!entry) return state;
  entry.blockerUid = blockerUid;
  return state;
}

function resolveCombatDamage(state: GameState) {
  if (!state.combat) return;
  const active = getPlayer(state, state.activePlayerId);
  const defender = getOpponent(state, state.activePlayerId);

  for (const entry of state.combat.attackers) {
    const attacker = active.battlefield.find(
      (c) => c.uid === entry.attackerUid,
    );
    if (!attacker) continue;
    const aDef = getCard(attacker.defId);
    const aPow = (aDef.attack ?? 0) + attacker.buffs.attack;

    attacker.tapped = true;

    if (entry.blockerUid) {
      const blocker = defender.battlefield.find(
        (c) => c.uid === entry.blockerUid,
      );
      if (blocker) {
        const bDef = getCard(blocker.defId);
        const bPow = (bDef.attack ?? 0) + blocker.buffs.attack;
        attacker.damage += bPow;
        blocker.damage += aPow;
        if (aDef.keywords?.includes("lifesteal")) {
          active.life += aPow;
        }
        log(
          state,
          `${aDef.name} (${aPow}) clashes with ${bDef.name} (${bPow}).`,
        );
        continue;
      }
    }

    defender.life -= aPow;
    if (aDef.keywords?.includes("lifesteal")) {
      active.life += aPow;
    }
    log(state, `${aDef.name} hits ${defender.name} for ${aPow}.`);
  }

  checkStateBased(state);
  checkWin(state);
  state.combat = null;
}
