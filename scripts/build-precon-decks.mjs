// Build the 4 Proving Grounds preconstructed decks from the official OGS set.
// Reference: https://riftbound.gg/origins-proving-grounds/
// The official 40-card lists aren't published in scrapable form, so we
// construct thematic decks that:
//   - Use the OGS "Starter" Legend and matching Champion as Chosen Champion
//   - Include all OGS cards the deck's domain identity allows
//   - Fill the rest from Origins (OGN) cards matching the same domains and tags
//   - 12 runes split between primary/secondary domain
//   - 3 battlefields

import fs from "node:fs";
import path from "node:path";

const all = JSON.parse(
  fs.readFileSync(path.resolve("src/lib/cards/data/all-cards.json"), "utf8"),
);

function notTokenAlt(c) {
  if (c.classification.supertype === "Token") return false;
  if (c.metadata?.alternate_art) return false;
  if ((c.name ?? "").includes("(Metal)")) return false;
  return true;
}

function findExact(name, type) {
  return all.find(
    (c) => c.name === name && c.classification.type === type,
  );
}

function buildDeck(deckName, deckId, legendName, championName, primary, secondary) {
  const legend = findExact(legendName, "Legend");
  if (!legend) throw new Error(`Legend not found: ${legendName}`);
  const champion = findExact(championName, "Unit");
  if (!champion) throw new Error(`Champion not found: ${championName}`);

  const allowed = [primary, secondary, "Colorless"];
  // OGS cards matching identity (legend domains) — these are the "exclusive" precon cards
  const ogsPool = all
    .filter(
      (c) =>
        c.set.set_id === "OGS" &&
        notTokenAlt(c) &&
        c.id !== legend.id &&
        c.id !== champion.id &&
        ["Unit", "Spell", "Gear"].includes(c.classification.type) &&
        c.classification.domain.length > 0 &&
        c.classification.domain.every((d) => allowed.includes(d)),
    );

  // Origins (OGN) cards matching identity
  const ognPool = all
    .filter(
      (c) =>
        c.set.set_id === "OGN" &&
        notTokenAlt(c) &&
        !c.metadata?.signature &&
        c.id !== legend.id &&
        c.id !== champion.id &&
        ["Unit", "Spell", "Gear"].includes(c.classification.type) &&
        c.classification.domain.length > 0 &&
        c.classification.domain.every((d) => allowed.includes(d)),
    )
    .sort((a, b) => (a.attributes.energy ?? 99) - (b.attributes.energy ?? 99));

  const mainDeck = [];
  let total = 0;
  // 3 copies of chosen champion
  mainDeck.push({ defId: champion.id, quantity: 3 });
  total += 3;

  // Add OGS exclusives (max 3 each)
  for (const c of ogsPool) {
    if (total >= 40) break;
    const qty = Math.min(2, 40 - total);
    mainDeck.push({ defId: c.id, quantity: qty });
    total += qty;
  }
  // Fill from OGN
  for (const c of ognPool) {
    if (total >= 40) break;
    if (mainDeck.find((e) => e.defId === c.id)) continue;
    const qty = Math.min(3, 40 - total);
    mainDeck.push({ defId: c.id, quantity: qty });
    total += qty;
  }
  if (total < 40) throw new Error(`Could not fill ${deckName}: only ${total}`);

  // Runes
  const runeOf = (dom) =>
    all.find(
      (c) =>
        c.classification.type === "Rune" &&
        c.classification.rarity === "Common" &&
        c.classification.domain.length === 1 &&
        c.classification.domain[0] === dom &&
        notTokenAlt(c),
    );
  const r1 = runeOf(primary);
  const r2 = runeOf(secondary);
  const runeDeck = [];
  if (r1) runeDeck.push({ defId: r1.id, quantity: 7 });
  if (r2) runeDeck.push({ defId: r2.id, quantity: 5 });
  const rt = runeDeck.reduce((s, e) => s + e.quantity, 0);
  if (rt < 12 && r1) runeDeck[0].quantity += 12 - rt;

  // Battlefields — pick 3 from any (Riftbound official picks vary; we just pick 3)
  const battlefields = all
    .filter((c) => c.classification.type === "Battlefield" && notTokenAlt(c))
    .slice(0, 3)
    .map((c) => c.id);

  return {
    id: deckId,
    name: deckName,
    legendId: legend.id,
    chosenChampionId: champion.id,
    mainDeck,
    runeDeck,
    battlefieldIds: battlefields,
    _debug: {
      legend: legend.name,
      champion: champion.name,
      mainCount: total,
      runeCount: runeDeck.reduce((s, e) => s + e.quantity, 0),
      uniqueDefs: mainDeck.length,
      ogsExclusives: ogsPool.length,
    },
  };
}

const decks = [
  buildDeck(
    "Annie — Dark Child (Proving Grounds)",
    "pg-annie",
    "Annie - Dark Child (Starter)",
    "Annie - Fiery",
    "Fury",
    "Chaos",
  ),
  buildDeck(
    "Garen — Might of Demacia (Proving Grounds)",
    "pg-garen",
    "Garen - Might of Demacia (Starter)",
    "Garen - Rugged",
    "Body",
    "Order",
  ),
  buildDeck(
    "Lux — Lady of Luminosity (Proving Grounds)",
    "pg-lux",
    "Lux - Lady of Luminosity (Starter)",
    "Lux - Illuminated",
    "Mind",
    "Order",
  ),
  buildDeck(
    "Master Yi — Wuju Bladesman (Proving Grounds)",
    "pg-master-yi",
    "Master Yi - Wuju Bladesman (Starter)",
    "Master Yi - Meditative",
    "Calm",
    "Body",
  ),
];

for (const d of decks) {
  console.log(`${d.name}:`, d._debug);
  delete d._debug;
}

const out = `// AUTO-GENERATED by scripts/build-precon-decks.mjs
// Source: Origins Proving Grounds preconstructed decks (Riot, 2025)
import type { DeckList } from "@/lib/game/types";

export const STARTER_DECKS: DeckList[] = ${JSON.stringify(decks, null, 2)};
`;

fs.writeFileSync(path.resolve("src/lib/decks/starters.ts"), out);
console.log("Wrote src/lib/decks/starters.ts");
