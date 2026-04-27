export type CardType = "unit" | "spell" | "resource" | "champion";

export type Faction = "void" | "ember" | "verdant" | "tide" | "neutral";

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export type Zone =
  | "deck"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "stack";

export type Phase =
  | "untap"
  | "draw"
  | "main1"
  | "combat_declare_attackers"
  | "combat_declare_blockers"
  | "combat_damage"
  | "main2"
  | "end";

export interface CardEffect {
  kind:
    | "damage"
    | "heal"
    | "draw"
    | "buff"
    | "destroy"
    | "summon_token"
    | "discard";
  amount?: number;
  target?: "any" | "self" | "opponent" | "unit" | "player";
}

export interface CardDefinition {
  id: string;
  name: string;
  type: CardType;
  faction: Faction;
  rarity: Rarity;
  cost: number;
  attack?: number;
  health?: number;
  text: string;
  effects?: CardEffect[];
  keywords?: ("haste" | "taunt" | "lifesteal" | "flying" | "deathtouch")[];
  art?: string;
}

export interface CardInstance {
  uid: string;
  defId: string;
  ownerId: string;
  controllerId: string;
  zone: Zone;
  tapped: boolean;
  summoningSick: boolean;
  damage: number;
  buffs: { attack: number; health: number };
}

export interface PlayerState {
  id: string;
  name: string;
  life: number;
  maxResource: number;
  resource: number;
  deck: CardInstance[];
  hand: CardInstance[];
  battlefield: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  hasPlayedResource: boolean;
}

export interface CombatState {
  attackers: { attackerUid: string; blockerUid?: string }[];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  activePlayerId: string;
  priorityPlayerId: string;
  turn: number;
  phase: Phase;
  combat: CombatState | null;
  log: string[];
  winnerId: string | null;
  pendingTargets: {
    sourceUid: string;
    effectIndex: number;
  } | null;
}

export interface Deck {
  id: string;
  name: string;
  cards: { defId: string; quantity: number }[];
}
