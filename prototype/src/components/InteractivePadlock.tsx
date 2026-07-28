'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function InteractivePadlock() {
  const [isClicked, setIsClicked] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);

  const handlePadlockClick = () => {
    setIsClicked(true);
    setShowCharacter(true);
    setTimeout(() => {
      setShowCharacter(false);
      setIsClicked(false);
    }, 3000);
  };

  return (
    <div className="relative inline-block">
      {/* Animated Padlock */}
      <motion.button
        onClick={handlePadlockClick}
        className="relative flex items-center justify-center w-24 h-24 focus:outline-none"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
      >
        {/* Glowing Background */}
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400 blur-xl opacity-60"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.6, 0.8, 0.6],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
          }}
        />

        {/* SVG Padlock */}
        <motion.svg
          viewBox="0 0 24 24"
          className="relative z-10 w-16 h-16 drop-shadow-lg"
          animate={isClicked ? { y: [0, -5, 0] } : { y: 0 }}
          transition={{
            duration: 0.6,
            repeat: isClicked ? 2 : 0,
          }}
        >
          {/* Outer glow filter */}
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="padlockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>

          {/* Padlock shackle (top curved part) */}
          <path
            d="M 6 10 Q 6 5 12 5 Q 18 5 18 10"
            fill="none"
            stroke="url(#padlockGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
          />

          {/* Padlock body */}
          <rect
            x="7"
            y="10"
            width="10"
            height="9"
            rx="1"
            fill="url(#padlockGradient)"
            filter="url(#glow)"
          />

          {/* Keyhole */}
          <circle cx="12" cy="14" r="1.5" fill="#92400e" />
          <path
            d="M 12 15.5 L 12 16.5"
            stroke="#92400e"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </motion.svg>

        {/* Shine effect */}
        <motion.div
          className="absolute top-2 left-4 w-3 h-3 bg-white rounded-full opacity-40 blur-sm"
          animate={{
            x: [0, 4, 0],
            y: [0, -2, 0],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
          }}
        />
      </motion.button>

      {/* Cartoon Character Popup */}
      <AnimatePresence>
        {showCharacter && (
          <motion.div
            className="absolute top-0 left-full ml-4 z-20"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Character Container */}
            <div className="relative w-28 h-32 bg-gradient-to-b from-amber-300 to-yellow-300 rounded-3xl shadow-2xl border-4 border-amber-400 overflow-hidden">
              {/* Head */}
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-16 h-16 bg-gradient-to-b from-yellow-200 to-yellow-300 rounded-full border-4 border-amber-400 shadow-lg flex items-center justify-center">
                {/* Eyes - looking sad/confused */}
                <div className="absolute flex gap-3 top-6">
                  {/* Left eye */}
                  <motion.div
                    className="w-3 h-3 bg-slate-800 rounded-full"
                    animate={{ y: [0, 2, 0] }}
                    transition={{ duration: 0.5, delay: 0 }}
                  />
                  {/* Right eye */}
                  <motion.div
                    className="w-3 h-3 bg-slate-800 rounded-full"
                    animate={{ y: [0, 2, 0] }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                  />
                </div>

                {/* Sad mouth (upside-down arc) */}
                <motion.svg
                  className="absolute bottom-3"
                  width="20"
                  height="10"
                  viewBox="0 0 20 10"
                  animate={{
                    y: [0, -2, 0],
                  }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                  }}
                >
                  <path
                    d="M 5 5 Q 10 2 15 5"
                    stroke="#92400e"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                </motion.svg>
              </div>

              {/* Body */}
              <div className="absolute top-20 left-1/2 transform -translate-x-1/2 w-12 h-8 bg-gradient-to-b from-amber-300 to-orange-300 rounded-lg border-2 border-amber-400 shadow-md" />

              {/* Speech Bubble */}
              <motion.div
                className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-white px-3 py-1 rounded-full border-2 border-amber-400 shadow-lg whitespace-nowrap text-xs font-bold text-amber-900"
                animate={{
                  y: [-5, 0, -5],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Infinity,
                }}
              >
                Nuh uh! 🚫
              </motion.div>

              {/* Shake animation */}
              <motion.div
                className="absolute inset-0"
                animate={isClicked ? { x: [-2, 2, -2, 2, 0] } : {}}
                transition={{ duration: 0.4 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
