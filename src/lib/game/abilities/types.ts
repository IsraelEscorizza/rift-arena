import { CardInstance, Domain, GameState } from "../types";

export type TriggerKind =
  | "onPlayUnit" // a unit enters play under the controller of the legend/champion
  | "onPlayMightyUnit" // unit with Might >= 5
  | "onConquerAny" // ANY conquer by the legend/unit's controller
  | "onHoldAny" // ANY hold by the legend/unit's controller
  | "onConquerHere" // unit's owner conquered the BF this unit is at
  | "onHoldHere" // unit's owner holds the BF this unit is at
  | "onDie" // this unit dies — sourceUid is the dying unit
  | "onWinCombat" // controller's units win a combat
  | "onAttack" // this unit gets attacker designation
  | "onDefend" // this unit gets defender designation
  | "atBeginningStart" // start of controller's Beginning Phase
  | "atEndOfTurn" // end of controller's turn (Ending Phase)
  | "onPlaySpell" // a spell is played by controller — data: { spellDefId, energyCost, powerCost }
  | "onOpponentMove"; // an opposing unit moves anywhere on the board

export interface TriggerContext {
  state: GameState;
  /** Player who controls the source (legend/unit). */
  controllerId: string;
  /** UID of the source unit, or null for legends. */
  sourceUid: string | null;
  /** Trigger-specific extra data. */
  data?: Record<string, unknown>;
}

export interface TriggerHandler {
  kind: TriggerKind;
  /** Should this trigger fire given the context? */
  predicate?: (ctx: TriggerContext) => boolean;
  /** Human-readable description for the log. */
  describe: (ctx: TriggerContext) => string;
  /** The actual effect, mutates state. */
  resolve: (ctx: TriggerContext) => void;
}

export interface ActivatedCost {
  energy?: number;
  power?: number;
  /** Power must come from one of these domains. */
  powerDomains?: Domain[];
  exhaustSelf?: boolean; // exhaust the source legend/unit
}

export interface ActivatedAbility {
  describe: (state: GameState, controllerId: string) => string;
  /** Returns the actual cost given current game state (for reductions). */
  computeCost: (state: GameState, controllerId: string) => ActivatedCost;
  canActivate: (state: GameState, controllerId: string) => boolean;
  resolve: (state: GameState, controllerId: string) => void;
}

/** A spell effect describes what to do when a spell resolves.
 * - `target`: what the player must select (or null if no target needed)
 * - `resolve`: applies the effect; receives optional target uid
 */
export interface SpellEffect {
  describe: string;
  target:
    | { kind: "none" }
    | { kind: "any_unit" }
    | { kind: "enemy_unit" }
    | { kind: "friendly_unit" }
    | { kind: "battlefield" }
    | { kind: "player" };
  resolve: (
    state: import("../types").GameState,
    casterId: string,
    targetUid?: string,
  ) => void;
}

export interface CardAbilities {
  triggers?: TriggerHandler[];
  activated?: ActivatedAbility[];
  /** For spells: the effect that fires on resolution. */
  spell?: SpellEffect;
}
