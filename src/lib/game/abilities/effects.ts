// Composable effect primitives used by ability handlers.
// These mutate state in place.

import { nanoid } from "nanoid";
import { CARDS_BY_ID } from "@/lib/cards/database";
import { CardInstance, Domain, GameState } from "../types";

export function logEvent(state: GameState, msg: string) {
  state.log.push(msg);
  if (state.log.length > 200) state.log.shift();
}

export function findPlayer(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}
export function findOpponent(state: GameState, id: string) {
  return state.players.find((p) => p.id !== id)!;
}

export function channelRunes(
  state: GameState,
  playerId: string,
  n: number,
  exhausted: boolean = false,
) {
  const p = findPlayer(state, playerId);
  for (let i = 0; i < n; i++) {
    const r = p.runeDeck.shift();
    if (!r) break;
    r.zone = "base";
    r.exhausted = exhausted;
    p.base.runes.push(r);
  }
  logEvent(
    state,
    `${p.name} channels ${n} rune${n > 1 ? "s" : ""}${exhausted ? " (exhausted)" : ""}.`,
  );
}

export function drawCardsFor(state: GameState, playerId: string, n: number) {
  const p = findPlayer(state, playerId);
  for (let i = 0; i < n; i++) {
    if (p.mainDeck.length === 0) {
      // Burn out
      for (const c of p.trash) c.zone = "main_deck";
      p.mainDeck = shuffle([...p.mainDeck, ...p.trash]);
      p.trash = [];
      const opp = findOpponent(state, playerId);
      logEvent(state, `${p.name} burns out — ${opp.name} gains 1 point.`);
      opp.points += 1;
      checkWin(state);
      if (state.winnerId) return;
    }
    const c = p.mainDeck.shift();
    if (!c) continue;
    c.zone = "hand";
    p.hand.push(c);
  }
  logEvent(state, `${p.name} draws ${n}.`);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function checkWin(state: GameState) {
  if (state.winnerId) return;
  for (const p of state.players) {
    if (p.points >= state.victoryScore) {
      const max = Math.max(...state.players.map((pp) => pp.points));
      if (p.points === max) {
        const others = state.players.filter((pp) => pp.id !== p.id);
        if (others.every((o) => o.points < p.points)) {
          state.winnerId = p.id;
          logEvent(state, `${p.name} wins!`);
        }
      }
    }
  }
}

/**
 * Spawn a token in the controller's base. tokenDefId must be a card with
 * supertype "Token" in the database.
 */
export function spawnToken(
  state: GameState,
  controllerId: string,
  tokenDefId: string,
  opts: { battlefieldId?: string; ready?: boolean } = {},
): CardInstance | null {
  const def = CARDS_BY_ID[tokenDefId];
  if (!def) {
    logEvent(state, `Token def not found: ${tokenDefId}`);
    return null;
  }
  const player = findPlayer(state, controllerId);
  const inst: CardInstance = {
    uid: nanoid(8),
    defId: tokenDefId,
    ownerId: controllerId,
    controllerId,
    zone: "base",
    battlefieldId: opts.battlefieldId,
    exhausted: !opts.ready,
    damage: 0,
    buffCount: 0,
    enteredThisTurn: true,
    attachments: [],
  };
  player.base.units.push(inst);
  logEvent(
    state,
    `${player.name} creates ${def.name}${opts.battlefieldId ? " at battlefield" : ""}.`,
  );
  return inst;
}

export function addPower(
  state: GameState,
  playerId: string,
  domain: Domain,
  n: number = 1,
) {
  const p = findPlayer(state, playerId);
  p.pool.power[domain] = (p.pool.power[domain] ?? 0) + n;
  logEvent(state, `${p.name} adds ${n} ${domain} power.`);
}

export function addEnergy(state: GameState, playerId: string, n: number = 1) {
  const p = findPlayer(state, playerId);
  p.pool.energy += n;
  logEvent(state, `${p.name} adds ${n} energy.`);
}

export function getMight(card: CardInstance): number {
  const def = CARDS_BY_ID[card.defId];
  return Math.max(0, (def?.might ?? 0) + (card.buffCount ?? 0) - (card.damage ?? 0));
}

export function isMighty(card: CardInstance): boolean {
  return getMight(card) >= 5;
}
