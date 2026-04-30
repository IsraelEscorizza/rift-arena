// Generate two starter decks from the real card pool.
import fs from "node:fs";
import path from "node:path";

const all = JSON.parse(
  fs.readFileSync(path.resolve("src/lib/cards/data/all-cards.json"), "utf8"),
);

function notTokenOrAlt(c) {
  if (c.classification.supertype === "Token") return false;
  if (c.metadata?.alternate_art) return false;
  if (c.metadata?.signature) return false;
  if ((c.name ?? "").includes("Overnumbered")) return false;
  if ((c.name ?? "").includes("(Metal)")) return false;
  if ((c.name ?? "").includes("(Starter)")) return false;
  return true;
}

/** Get the character name from a card with subtitle, e.g. "Volibear - Relentless Storm" → "Volibear". */
function characterOf(card) {
  const name = card.name ?? "";
  const idx = name.indexOf(" - ");
  return idx > 0 ? name.slice(0, idx).trim() : name.trim();
}

function buildDeck(deckName, primaryDomain, secondaryDomain, preferredCharacter) {
  // Pick a legend matching the domains (and optionally a specific character)
  const legendCandidates = all.filter(
    (c) =>
      c.classification.type === "Legend" &&
      notTokenOrAlt(c) &&
      c.classification.domain.includes(primaryDomain) &&
      c.classification.domain.every((d) =>
        [primaryDomain, secondaryDomain, "Colorless"].includes(d),
      ),
  );

  let legend = preferredCharacter
    ? legendCandidates.find((c) => characterOf(c) === preferredCharacter)
    : null;
  if (!legend) legend = legendCandidates[0];
  if (!legend) throw new Error(`No legend for ${primaryDomain}`);

  const character = characterOf(legend);

  // Chosen Champion MUST be a Champion unit of the same character.
  // Look for: Champion-supertype units whose character (name prefix) matches.
  let chosenChampion = all.find(
    (c) =>
      c.classification.type === "Unit" &&
      c.classification.supertype === "Champion" &&
      notTokenOrAlt(c) &&
      characterOf(c) === character,
  );
  // Secondary check: champion with `character` in tags
  if (!chosenChampion) {
    chosenChampion = all.find(
      (c) =>
        c.classification.type === "Unit" &&
        c.classification.supertype === "Champion" &&
        notTokenOrAlt(c) &&
        (c.tags ?? []).includes(character),
    );
  }
  if (!chosenChampion) {
    throw new Error(
      `No matching champion unit found for legend ${legend.name} (character "${character}").`,
    );
  }

  // Build main deck pool: 40 cards. Filter:
  //  - Type Unit / Spell / Gear (Riftbound deck contents)
  //  - NOT tokens / alt art / signatures / overnumbered
  //  - All domains contained in deck identity
  //  - Not the chosen champion itself (we add 3 copies separately)
  const allowedDomains = [primaryDomain, secondaryDomain, "Colorless"];
  const pool = all
    .filter(
      (c) =>
        ["Unit", "Spell", "Gear"].includes(c.classification.type) &&
        notTokenOrAlt(c) &&
        c.classification.domain.length > 0 &&
        c.classification.domain.every((d) => allowedDomains.includes(d)) &&
        c.id !== chosenChampion.id,
    )
    .sort((a, b) => (a.attributes.energy ?? 99) - (b.attributes.energy ?? 99));

  const mainDeck = [];
  let total = 0;
  // 3 copies of chosen champion
  mainDeck.push({ defId: chosenChampion.id, quantity: 3 });
  total += 3;
  // Then fill with pool
  for (const u of pool) {
    if (total >= 40) break;
    const qty = Math.min(3, 40 - total);
    mainDeck.push({ defId: u.id, quantity: qty });
    total += qty;
  }
  if (total < 40)
    throw new Error(`Could not assemble 40 cards for ${deckName} — only ${total}`);

  // Rune deck: 12 basic runes split between primary/secondary domain
  const runeOfDomain = (dom) =>
    all.find(
      (c) =>
        c.classification.type === "Rune" &&
        c.classification.rarity === "Common" &&
        c.classification.domain.length === 1 &&
        c.classification.domain[0] === dom &&
        notTokenOrAlt(c),
    );
  const primaryRune = runeOfDomain(primaryDomain);
  const secondaryRune = runeOfDomain(secondaryDomain);
  const runeDeck = [];
  if (primaryRune) runeDeck.push({ defId: primaryRune.id, quantity: 7 });
  if (secondaryRune) runeDeck.push({ defId: secondaryRune.id, quantity: 5 });
  const runeTotal = runeDeck.reduce((s, e) => s + e.quantity, 0);
  if (runeTotal < 12 && primaryRune) runeDeck[0].quantity += 12 - runeTotal;

  // Battlefields: 3, prefer non-Token battlefields
  const battlefields = all
    .filter(
      (c) =>
        c.classification.type === "Battlefield" &&
        notTokenOrAlt(c),
    )
    .slice(0, 3)
    .map((c) => c.id);

  return {
    id: `starter-${character.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: deckName,
    legendId: legend.id,
    chosenChampionId: chosenChampion.id,
    mainDeck,
    runeDeck,
    battlefieldIds: battlefields,
    _debug: {
      character,
      legend: legend.name,
      champion: chosenChampion.name,
      mainCount: total,
      runeCount: runeDeck.reduce((s, e) => s + e.quantity, 0),
    },
  };
}

const deckA = buildDeck("Volibear — Relentless Storm", "Fury", "Body", "Volibear");
const deckB = buildDeck("Lillia — Bashful Bloom", "Calm", "Mind", "Lillia");

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
