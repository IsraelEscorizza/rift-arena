// Generate two starter decks from the real card pool, picking only MVP-playable cards.
import fs from "node:fs";
import path from "node:path";

const all = JSON.parse(
  fs.readFileSync(path.resolve("src/lib/cards/data/all-cards.json"), "utf8"),
);

function detectKeywords(text) {
  if (!text) return [];
  const kw = [];
  for (const k of [
    "Tank","Backline","Action","Reaction","Ambush","Ganking","Hidden",
    "Quick-Draw","Temporary","Unique","Vision","Weaponmaster","Accelerate"
  ]) {
    if (new RegExp(`\\[${k}\\]`, "i").test(text)) kw.push(k);
  }
  return kw;
}
function detectNum(text, kw) {
  if (!text) return 0;
  const m = text.match(new RegExp(`\\[${kw}\\s+(\\d+)\\]`, "i"));
  return m ? parseInt(m[1], 10) : 0;
}
function isPlayable(c) {
  const text = c.text?.rich ?? c.text?.plain ?? "";
  const kw = detectKeywords(text);
  const stripped = text
    .replace(/<[^>]+>/g, "")
    .replace(/\[[A-Za-z\- ]+\d*\]/g, "")
    .replace(/\s+/g, "")
    .trim();
  const isVanilla = stripped.length === 0;
  if (c.classification.type === "Unit") {
    return isVanilla || detectNum(text, "Assault") > 0 || detectNum(text, "Shield") > 0;
  }
  if (c.classification.type === "Battlefield") return true;
  if (c.classification.type === "Rune") return c.classification.rarity === "Common";
  if (c.classification.type === "Legend") return isVanilla;
  return false;
}

function buildDeck(deckName, primaryDomain, secondaryDomain) {
  // Pick any legend matching the domains (abilities may not all be implemented but legend sits in zone)
  const legends = all.filter(
    (c) =>
      c.classification.type === "Legend" &&
      !c.metadata?.alternate_art &&
      c.classification.domain.includes(primaryDomain) &&
      c.classification.domain.every((d) =>
        [primaryDomain, secondaryDomain, "Colorless"].includes(d),
      ),
  );
  const legend = legends[0];
  if (!legend) throw new Error(`No legend for ${primaryDomain}`);

  // Chosen Champion: any unit with same tag as legend
  const legendTag = legend.tags?.[0];
  let chosenChampion =
    all.find(
      (c) =>
        c.classification.type === "Unit" &&
        c.classification.supertype === "Champion" &&
        (c.tags ?? []).includes(legendTag) &&
        isPlayable(c),
    ) ?? all.find(
      (c) =>
        c.classification.type === "Unit" &&
        c.classification.domain.includes(primaryDomain) &&
        isPlayable(c),
    );
  if (!chosenChampion) throw new Error(`No champion for ${primaryDomain}`);

  // Pick units of these domains. We allow non-vanilla — abilities just won't all fire.
  // Stats still work fine.
  const units = all
    .filter(
      (c) =>
        c.classification.type === "Unit" &&
        !c.metadata?.alternate_art &&
        !c.metadata?.signature &&
        c.classification.domain.every((d) =>
          [primaryDomain, secondaryDomain, "Colorless"].includes(d),
        ) &&
        c.id !== chosenChampion.id,
    )
    .sort((a, b) => (a.attributes.energy ?? 0) - (b.attributes.energy ?? 0));

  // Build mainDeck: 40 cards, target curve: low/mid/high
  const mainDeck = [];
  let totalCards = 0;
  // Add chosen champion x3 (max copies)
  mainDeck.push({ defId: chosenChampion.id, quantity: 3 });
  totalCards += 3;
  for (const u of units) {
    if (totalCards >= 40) break;
    const qty = Math.min(3, 40 - totalCards);
    mainDeck.push({ defId: u.id, quantity: qty });
    totalCards += qty;
  }

  // Build runeDeck: 12 runes
  const basicPrimaryRune = all.find(
    (c) =>
      c.classification.type === "Rune" &&
      c.classification.rarity === "Common" &&
      c.classification.domain.length === 1 &&
      c.classification.domain[0] === primaryDomain,
  );
  const basicSecondaryRune = all.find(
    (c) =>
      c.classification.type === "Rune" &&
      c.classification.rarity === "Common" &&
      c.classification.domain.length === 1 &&
      c.classification.domain[0] === secondaryDomain,
  );
  const runeDeck = [];
  if (basicPrimaryRune) runeDeck.push({ defId: basicPrimaryRune.id, quantity: 7 });
  if (basicSecondaryRune) runeDeck.push({ defId: basicSecondaryRune.id, quantity: 5 });
  // Pad if missing
  const runeTotal = runeDeck.reduce((s, e) => s + e.quantity, 0);
  if (runeTotal < 12 && basicPrimaryRune) {
    runeDeck[0].quantity += 12 - runeTotal;
  }

  // Battlefields: pick 3 of any domain
  const battlefields = all
    .filter((c) => c.classification.type === "Battlefield")
    .slice(0, 3)
    .map((c) => c.id);

  return {
    id: `starter-${primaryDomain.toLowerCase()}`,
    name: deckName,
    legendId: legend.id,
    chosenChampionId: chosenChampion.id,
    mainDeck,
    runeDeck,
    battlefieldIds: battlefields,
    _debug: {
      legend: legend.name,
      champion: chosenChampion.name,
      mainCount: totalCards,
      runeCount: runeDeck.reduce((s, e) => s + e.quantity, 0),
    },
  };
}

const deckA = buildDeck("Fury Strike (Starter)", "Fury", "Body");
const deckB = buildDeck("Mind & Calm (Starter)", "Mind", "Calm");

console.log("Deck A:", deckA._debug);
console.log("Deck B:", deckB._debug);

delete deckA._debug;
delete deckB._debug;

const out = `// AUTO-GENERATED by scripts/generate-starter-decks.mjs
import type { DeckList } from "@/lib/game/types";

export const STARTER_DECKS: DeckList[] = ${JSON.stringify([deckA, deckB], null, 2)};
`;

fs.writeFileSync(path.resolve("src/lib/decks/starters.ts"), out);
console.log("Wrote src/lib/decks/starters.ts");
