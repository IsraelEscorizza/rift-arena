// Riftbound TCG types (matching official rules)

export type Domain =
  | "Fury"
  | "Calm"
  | "Mind"
  | "Body"
  | "Chaos"
  | "Order"
  | "Colorless";

export type CardType =
  | "Unit"
  | "Spell"
  | "Gear"
  | "Rune"
  | "Battlefield"
  | "Legend";

export type Rarity =
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Epic"
  | "Showcase"
  | "Promo";

export type Keyword =
  | "Tank"
  | "Backline"
  | "Action"
  | "Reaction"
  | "Ambush"
  | "Ganking"
  | "Hidden"
  | "Quick-Draw"
  | "Temporary"
  | "Unique"
  | "Vision"
  | "Weaponmaster"
  | "Accelerate";

export interface CardDefinition {
  id: string; // riftcodex id
  riftboundId: string; // e.g. "ogn-011"
  name: string;
  type: CardType;
  supertype?: string | null;
  rarity: Rarity;
  domains: Domain[];
  energy: number | null;
  might: number | null;
  power: number | null; // power cost (number of power symbols)
  rulesText: string;
  flavor: string | null;
  imageUrl: string;
  setId: string;
  setLabel: string;
  collectorNumber: number;
  tags: string[];
  // parsed mechanics (best-effort)
  keywords: Keyword[];
  assault: number; // 0 if none
  shield: number;
  hunt: number;
  isVanilla: boolean; // no abilities — fully implementable
}

export type Zone =
  | "main_deck"
  | "rune_deck"
  | "hand"
  | "base"
  | "battlefield"
  | "trash"
  | "banishment"
  | "champion_zone"
  | "legend_zone"
  | "chain";

export interface CardInstance {
  uid: string;
  defId: string;
  ownerId: string;
  controllerId: string;
  zone: Zone;
  battlefieldId?: string; // when zone === 'battlefield'
  exhausted: boolean;
  damage: number;
  buffCount: 0 | 1; // Riftbound: max 1 buff per unit
  /** Temporary +might that expires at end of turn (for "this turn" effects). */
  tempMightThisTurn?: number;
  enteredThisTurn: boolean;
  attachments: string[]; // gear uids attached
}

export interface RuneInstance {
  uid: string;
  defId: string;
  ownerId: string;
  zone: "rune_deck" | "base";
  exhausted: boolean;
  domain: Domain;
}

export interface BattlefieldInstance {
  uid: string;
  defId: string;
  ownerId: string; // who brought it
  controllerId: string | null; // who controls it now
  contested: boolean;
  scoredByThisTurn: string[]; // playerIds who already scored this BF this turn
}

export interface ResourcePool {
  energy: number;
  power: Record<Domain, number>;
}

export interface PlayerState {
  id: string;
  name: string;
  team: number; // 0/1 for 2v2; in 1v1 use 0/1 still
  points: number;
  xp: number;
  // Decks
  mainDeck: CardInstance[];
  runeDeck: RuneInstance[];
  hand: CardInstance[];
  trash: CardInstance[];
  banishment: CardInstance[];
  // Permanent locations
  base: { units: CardInstance[]; gear: CardInstance[]; runes: RuneInstance[] };
  // Special zones
  championZone: CardInstance | null; // chosen champion
  legendZone: CardDefinition; // legend never leaves; just keep the definition
  legendExhausted: boolean; // track exhausted state for activated abilities
  domainIdentity: Domain[];
  // Resources (cleared each turn end and at end of draw phase)
  pool: ResourcePool;
}

export type Phase =
  | "awaken"
  | "beginning"
  | "channel"
  | "draw"
  | "main"
  | "ending";

export type GameMode = "duel"; // MVP: 1v1 duel only

export interface PendingTarget {
  forActionId: string;
  description: string;
}

export interface PendingPlay {
  cardUid: string;
  powerLeft: number;
  neededDomains: Domain[]; // domains that satisfy this card's power
}

export interface GameState {
  mode: GameMode;
  victoryScore: number;
  players: PlayerState[]; // 2 in MVP
  battlefields: BattlefieldInstance[];
  battlefieldDefs: Record<string, CardDefinition>;
  turnPlayerId: string;
  priorityPlayerId: string;
  turnNumber: number;
  phase: Phase;
  // Combat
  combat: {
    battlefieldUid: string;
    attackerId: string;
    defenderId: string;
    step: "showdown" | "damage" | "resolution";
  } | null;
  log: string[];
  winnerId: string | null;
  pendingMove: { unitUid: string } | null;
  // When user clicks a card whose Power cost requires recycling runes,
  // we hold this state until they pick which runes to recycle.
  pendingPlay: PendingPlay | null;
  // After a spell with target is "played" but before it resolves, we hold this.
  pendingSpellTarget: PendingSpellTarget | null;
  // Effects that will fire at a future scheduled time (e.g. start of next main).
  delayedEffects: DelayedEffect[];
}

export interface PendingSpellTarget {
  spellUid: string;
  defId: string;
  casterId: string;
  targetKind:
    | "any_unit"
    | "enemy_unit"
    | "friendly_unit"
    | "battlefield"
    | "player";
  description: string;
}

export interface DelayedEffect {
  uid: string;
  ownerId: string;
  fireOn: { phase: Phase; turnPlayerId?: string }; // fires when entering this phase under condition
  description: string;
  /** kind = effect type, payload = data */
  kind:
    | "add_rainbow_power"
    | "channel_runes"
    | "draw"
    | "deal_damage";
  payload?: Record<string, unknown>;
}

export interface DeckList {
  id: string;
  name: string;
  legendId: string; // CardDefinition.id of legend
  chosenChampionId: string; // CardDefinition.id of unit champion
  mainDeck: { defId: string; quantity: number }[];
  runeDeck: { defId: string; quantity: number }[];
  battlefieldIds: string[];
}
