import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FACTION_COLORS: Record<string, string> = {
  ember: "from-red-700 to-orange-500 border-orange-400",
  void: "from-purple-900 to-fuchsia-700 border-fuchsia-400",
  verdant: "from-emerald-800 to-green-600 border-green-400",
  tide: "from-blue-800 to-cyan-600 border-cyan-400",
  neutral: "from-zinc-700 to-zinc-500 border-zinc-300",
};

export const FACTION_GLOW: Record<string, string> = {
  ember: "shadow-orange-500/50",
  void: "shadow-fuchsia-500/50",
  verdant: "shadow-green-500/50",
  tide: "shadow-cyan-500/50",
  neutral: "shadow-zinc-400/40",
};
