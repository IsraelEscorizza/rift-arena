import Link from "next/link";
import { Sparkles, Swords, Hammer } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,_#1a0b2e_0%,_#0a0418_70%)] text-white">
      <div className="flex items-center gap-3">
        <Sparkles className="h-12 w-12 text-fuchsia-400" />
        <h1 className="text-6xl font-black tracking-tight">
          Rift<span className="text-fuchsia-400">Arena</span>
        </h1>
      </div>
      <p className="mt-3 max-w-md text-center text-sm opacity-70">
        A digital arena to play Riftbound. Build decks, command champions,
        clash across the rift.
      </p>

      <div className="mt-12 flex gap-4">
        <Link
          href="/play"
          className="flex items-center gap-2 rounded bg-fuchsia-700 px-8 py-4 text-lg font-bold shadow-lg shadow-fuchsia-900/50 hover:bg-fuchsia-600"
        >
          <Swords className="h-5 w-5" /> Play vs AI
        </Link>
        <Link
          href="/deck-builder"
          className="flex items-center gap-2 rounded border-2 border-fuchsia-700 px-8 py-4 text-lg font-bold hover:bg-fuchsia-900/30"
        >
          <Hammer className="h-5 w-5" /> Deck Builder
        </Link>
      </div>

      <p className="mt-16 text-xs opacity-40">
        MVP — placeholder cards. Drop in real Riftbound rules and we adapt.
      </p>
    </main>
  );
}
