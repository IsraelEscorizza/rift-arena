import type { CardDefinition, Domain } from "@/lib/game/types";
import { ALL_CARDS, CARDS_BY_ID } from "./generated";

export { ALL_CARDS, CARDS_BY_ID };

export function getCard(id: string): CardDefinition {
  const c = CARDS_BY_ID[id];
  if (!c) throw new Error(`Card not found: ${id}`);
  return c;
}

export function findCardByRiftboundId(rid: string): CardDefinition | undefined {
  return ALL_CARDS.find((c) => c.riftboundId.toLowerCase() === rid.toLowerCase());
}

export function getLegends(): CardDefinition[] {
  return ALL_CARDS.filter((c) => c.type === "Legend");
}

export function getBattlefields(): CardDefinition[] {
  return ALL_CARDS.filter((c) => c.type === "Battlefield");
}

export function getBasicRunes(): CardDefinition[] {
  // Basic runes are typed "Rune" with simple text "Tap: Add ..."
  return ALL_CARDS.filter((c) => c.type === "Rune");
}

export function findBasicRuneOfDomain(domain: Domain): CardDefinition | undefined {
  return ALL_CARDS.find(
    (c) =>
      c.type === "Rune" &&
      c.rarity === "Common" &&
      c.domains.length === 1 &&
      c.domains[0] === domain,
  );
}

export function getDomainSymbol(d: Domain): string {
  return {
    Fury: "🔥",
    Calm: "🌿",
    Mind: "💧",
    Body: "🛡",
    Chaos: "💜",
    Order: "✨",
    Colorless: "⚪",
  }[d];
}

export function getDomainHex(d: Domain): string {
  return {
    Fury: "#dc2626",
    Calm: "#16a34a",
    Mind: "#2563eb",
    Body: "#ea580c",
    Chaos: "#9333ea",
    Order: "#eab308",
    Colorless: "#71717a",
  }[d];
}

// Cards that the engine can play meaningfully right now (vanilla stats + supported keywords)
export function isMVPPlayable(c: CardDefinition): boolean {
  if (c.type === "Battlefield") return true;
  if (c.type === "Legend") return c.isVanilla; // legend abilities mostly unimplemented
  if (c.type === "Rune") return true;
  if (c.type === "Unit") {
    return c.isVanilla || c.assault > 0 || c.shield > 0;
  }
  if (c.type === "Spell") {
    // Skip spells for MVP — most have unique effects we haven't coded
    return false;
  }
  if (c.type === "Gear") return c.isVanilla;
  return false;
}
