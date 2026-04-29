// Convert Riftcodex card JSON dump into a typed TS module.
import fs from "node:fs";
import path from "node:path";

const inFile = path.resolve("src/lib/cards/data/all-cards.json");
const outFile = path.resolve("src/lib/cards/generated.ts");

const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));

// Strip HTML tags from rich text and normalize basic tokens
function clean(text) {
  if (!text) return "";
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/:rb_energy_(\d+):/g, "[$1]")
    .replace(/:rb_(fury|calm|mind|body|chaos|order):/g, (_, d) => `[${d[0].toUpperCase()}]`)
    .replace(/:rb_power:/g, "[P]")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detectKeywords(text) {
  if (!text) return [];
  const kw = [];
  const candidates = [
    "Tank", "Backline", "Action", "Reaction", "Ambush", "Ganking",
    "Hidden", "Quick-Draw", "Temporary", "Unique", "Vision",
    "Weaponmaster", "Accelerate"
  ];
  for (const k of candidates) {
    const re = new RegExp(`\\[${k}\\]`, "i");
    if (re.test(text)) kw.push(k);
  }
  return kw;
}

function detectNumeric(text, keyword) {
  if (!text) return 0;
  const re = new RegExp(`\\[${keyword}\\s+(\\d+)\\]`, "i");
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : 0;
}

function isVanilla(text, keywords, assault, shield, hunt) {
  if (!text || text.length === 0) return true;
  // Vanilla = only text is bracketed keywords with no extra rules
  const stripped = text
    .replace(/\[[A-Za-z\- ]+\d*\]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return stripped.length === 0;
}

const out = [];
for (const c of raw) {
  const plain = clean(c.text?.plain ?? c.text?.rich ?? "");
  const keywords = detectKeywords(c.text?.rich ?? c.text?.plain ?? "");
  const assault = detectNumeric(c.text?.rich ?? "", "Assault") ||
                  detectNumeric(c.text?.plain ?? "", "Assault");
  const shield = detectNumeric(c.text?.rich ?? "", "Shield") ||
                 detectNumeric(c.text?.plain ?? "", "Shield");
  const hunt = detectNumeric(c.text?.rich ?? "", "Hunt") ||
               detectNumeric(c.text?.plain ?? "", "Hunt");

  out.push({
    id: c.id,
    riftboundId: c.riftbound_id,
    name: c.name,
    type: c.classification.type,
    supertype: c.classification.supertype ?? null,
    rarity: c.classification.rarity,
    domains: c.classification.domain,
    energy: c.attributes.energy ?? null,
    might: c.attributes.might ?? null,
    power: c.attributes.power ?? null,
    rulesText: plain,
    flavor: c.text?.flavour ?? null,
    imageUrl: c.media.image_url,
    setId: c.set.set_id,
    setLabel: c.set.label,
    collectorNumber: c.collector_number,
    tags: c.tags ?? [],
    keywords,
    assault,
    shield,
    hunt,
    isVanilla: isVanilla(plain, keywords, assault, shield, hunt),
    altArt: c.metadata?.alternate_art ?? false,
    signature: c.metadata?.signature ?? false,
  });
}

const ts = `// AUTO-GENERATED — DO NOT EDIT. Run scripts/convert-cards.mjs to regenerate.
import type { CardDefinition } from "@/lib/game/types";

const RAW: unknown = ${JSON.stringify(out)};

export const ALL_CARDS: CardDefinition[] = RAW as CardDefinition[];

export const CARDS_BY_ID: Record<string, CardDefinition> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.id, c])
);
`;

fs.writeFileSync(outFile, ts);
console.log(`Wrote ${out.length} cards to ${outFile}`);
console.log(`Vanilla count: ${out.filter((c) => c.isVanilla).length}`);
console.log(`Units: ${out.filter((c) => c.type === "Unit").length}`);
console.log(`Spells: ${out.filter((c) => c.type === "Spell").length}`);
console.log(`Legends: ${out.filter((c) => c.type === "Legend").length}`);
console.log(`Battlefields: ${out.filter((c) => c.type === "Battlefield").length}`);
console.log(`Runes: ${out.filter((c) => c.type === "Rune").length}`);
