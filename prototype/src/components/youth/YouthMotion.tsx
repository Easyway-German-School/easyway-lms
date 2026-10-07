"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

import Avatar from "@/components/Avatar";
import { firstName } from "@/lib/typing";

/**
 * Shared motion for the youth look — stories, spinning face rings, floating
 * colour blobs. Classic WhatsApp rooms never import this file.
 */

export const youthSpring = { type: "spring" as const, stiffness: 420, damping: 28, mass: 0.7 };

export const youthEase = [0.22, 1.1, 0.36, 1] as const;

export const youthItem = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.42, ease: youthEase } },
};

export const youthStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export function YouthBlobs() {
  return (
    <div className="youth-blobs pointer-events-none" aria-hidden>
      <span className="youth-blob youth-blob-a" />
      <span className="youth-blob youth-blob-b" />
      <span className="youth-blob youth-blob-c" />
    </div>
  );
}

export function YouthFace({
  config,
  seed,
  size = 44,
  live = false,
  className = "",
}: {
  config?: unknown;
  seed: string;
  size?: number;
  live?: boolean;
  className?: string;
}) {
  return (
    <span className={`youth-face ${live ? "youth-face-live" : ""} ${className}`} style={{ width: size, height: size }}>
      <span className="youth-face-ring" />
      <Avatar config={config} seed={seed} size={size - 6} className="relative rounded-full" />
    </span>
  );
}

export type StoryFace = {
  id: string;
  name: string;
  avatar?: unknown;
  live?: boolean;
};

export function YouthStoryStrip({
  people,
  onPick,
}: {
  people: StoryFace[];
  onPick?: (id: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <div className="youth-stories">
      {people.map((person, index) => (
        <button
          key={person.id}
          type="button"
          onClick={() => onPick?.(person.id)}
          style={{ animationDelay: `${index * 50}ms` }}
          className="youth-story youth-pop"
        >
          <YouthFace config={person.avatar} seed={person.name} size={56} live={person.live} />
          <span className="youth-story-name">{firstName(person.name)}</span>
        </button>
      ))}
    </div>
  );
}

export function YouthPop({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...youthSpring, delay }}
    >
      {children}
    </motion.div>
  );
}
