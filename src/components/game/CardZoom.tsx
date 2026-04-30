"use client";

import { createContext, useContext, useState, useCallback } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { CARDS_BY_ID } from "@/lib/cards/database";
import { CardDefinition } from "@/lib/game/types";
import { X } from "lucide-react";

type ZoomTarget = string | CardDefinition; // defId or full def

interface ZoomCtx {
  open: (target: ZoomTarget) => void;
}

const Ctx = createContext<ZoomCtx>({ open: () => {} });

export function useCardZoom() {
  return useContext(Ctx);
}

export function CardZoomProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<CardDefinition | null>(null);
  const open = useCallback((t: ZoomTarget) => {
    if (typeof t === "string") {
      const def = CARDS_BY_ID[t];
      if (def) setActive(def);
    } else {
      setActive(t);
    }
  }, []);
  const close = useCallback(() => setActive(null), []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            onContextMenu={(e) => {
              e.preventDefault();
              close();
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ type: "spring", stiffness: 250, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[92vh] max-w-[92vw]"
            >
              <button
                onClick={close}
                className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-fuchsia-700 hover:bg-fuchsia-500"
              >
                <X className="h-4 w-4" />
              </button>
              {active.imageUrl && (
                <Image
                  src={active.imageUrl}
                  alt={active.name}
                  width={600}
                  height={840}
                  unoptimized
                  className="max-h-[88vh] w-auto rounded-lg shadow-2xl"
                />
              )}
              <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/85 p-3 text-white">
                <div className="text-lg font-bold">{active.name}</div>
                <div className="text-xs opacity-70">
                  {active.type} • {active.domains.join(" / ")} •{" "}
                  {active.energy != null
                    ? `${active.energy} Energy`
                    : "no energy"}{" "}
                  {(active.power ?? 0) > 0 && `• ${active.power} Power`}{" "}
                  {active.might != null && `• ${active.might} Might`}
                </div>
                {active.rulesText && (
                  <div className="mt-1 whitespace-pre-line text-xs opacity-90">
                    {active.rulesText}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
