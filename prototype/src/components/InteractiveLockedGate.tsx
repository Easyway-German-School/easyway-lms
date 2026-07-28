"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface InteractiveLockedGateProps {
  requiredDeposit: number;
  totalPaid: number;
  tuitionFee: number;
  onPayClick: () => void;
}

export default function InteractiveLockedGate({
  requiredDeposit,
  totalPaid,
  tuitionFee,
  onPayClick,
}: InteractiveLockedGateProps) {
  const [isClicked, setIsClicked] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const progressPercent = Math.min(100, Math.round((totalPaid / requiredDeposit) * 100));

  const handlePadlockClick = () => {
    setIsClicked(true);
    setShowCharacter(true);
    setTimeout(() => {
      setShowCharacter(false);
      setIsClicked(false);
    }, 3000);
  };

  return (
    <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-rose-500/10 p-8 text-sm text-amber-900 shadow-sm">
      <div className="flex flex-col items-center gap-8 md:flex-row md:items-start md:justify-between">
        {/* Left: Animated Padlock */}
        <div className="flex flex-col items-center gap-4">
          <motion.button
            onClick={handlePadlockClick}
            className="relative h-32 w-32 cursor-pointer focus:outline-none"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
          >
            {/* Outer glow */}
            <motion.div
              className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 opacity-20"
              animate={{
                boxShadow: [
                  "0 0 20px rgba(251, 146, 60, 0.3)",
                  "0 0 40px rgba(251, 146, 60, 0.6)",
                  "0 0 20px rgba(251, 146, 60, 0.3)",
                ],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Padlock SVG */}
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 h-full w-full"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Shackle (top rounded part) */}
              <motion.path
                d="M 30 50 Q 30 30 50 30 Q 70 30 70 50"
                stroke="url(#padlockGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                animate={{
                  strokeWidth: isClicked ? [4, 6, 4] : 4,
                }}
                transition={{ duration: 0.3 }}
              />

              {/* Body */}
              <motion.rect
                x="25"
                y="48"
                width="50"
                height="40"
                rx="4"
                fill="url(#padlockGradient)"
                animate={{
                  y: isClicked ? [48, 45, 48] : 48,
                }}
                transition={{ duration: 0.2, repeat: isClicked ? 3 : 0 }}
              />

              {/* Keyhole */}
              <circle cx="50" cy="62" r="4" fill="#ffffff" opacity="0.6" />

              {/* Shine effect */}
              <motion.ellipse
                cx="35"
                cy="55"
                rx="6"
                ry="8"
                fill="#ffffff"
                opacity="0.4"
                animate={{
                  opacity: [0.4, 0.8, 0.4],
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />

              <defs>
                <linearGradient id="padlockGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fb923c" />
                  <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
              </defs>
            </svg>
          </motion.button>

          <p className="text-center text-xs font-semibold uppercase tracking-widest text-amber-700">
            Click the lock
          </p>
        </div>

        {/* Right: Message and Progress */}
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">🔐 Payment Required</p>
          <p className="mt-3 text-2xl font-bold text-amber-900">Your study kit is locked</p>
          <p className="mt-3 text-sm leading-relaxed text-amber-800">
            Pay the required deposit to unlock all course materials, interactive lessons, and tutor feedback. Your registration is active—complete this step to access everything.
          </p>

          {/* Progress Bar */}
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">Payment Progress</span>
              <span className="text-sm font-bold text-amber-900">{progressPercent}%</span>
            </div>
            <div className="h-4 rounded-full bg-white/50">
              <motion.div
                className="h-4 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <p className="text-xs text-amber-700">
              {totalPaid.toLocaleString()} NGN of {requiredDeposit.toLocaleString()} NGN
            </p>
          </div>

          {/* CTA Button */}
          <motion.button
            onClick={onPayClick}
            className="mt-6 rounded-full bg-gradient-to-r from-amber-600 to-orange-600 px-8 py-3 font-semibold text-white shadow-lg shadow-amber-600/30 transition hover:shadow-xl hover:shadow-amber-600/50"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
          >
            Complete Payment
          </motion.button>
        </div>
      </div>

      {/* Animated Character */}
      <AnimatePresence>
        {showCharacter && (
          <motion.div
            key="character"
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="pointer-events-none fixed bottom-8 right-8 z-50 max-w-xs"
          >
            {/* Cartoon Character Bubble */}
            <div className="relative">
              {/* Character Head */}
              <div className="flex flex-col items-center gap-3">
                {/* Head */}
                <motion.div
                  className="relative h-24 w-20 rounded-full bg-gradient-to-b from-yellow-300 to-yellow-400 shadow-lg"
                  animate={{
                    y: [0, -5, 0],
                  }}
                  transition={{ duration: 0.5, repeat: 2 }}
                >
                  {/* Eyes - Sad */}
                  <div className="absolute top-6 flex w-full justify-center gap-4 px-2">
                    <motion.div
                      className="h-3 w-3 rounded-full bg-gray-800"
                      animate={{
                        y: [0, 2, 0],
                      }}
                      transition={{ duration: 0.3, repeat: 2 }}
                    />
                    <motion.div
                      className="h-3 w-3 rounded-full bg-gray-800"
                      animate={{
                        y: [0, 2, 0],
                      }}
                      transition={{ duration: 0.3, repeat: 2 }}
                    />
                  </div>

                  {/* Sad mouth */}
                  <motion.svg
                    className="absolute bottom-3 left-1/2 h-3 w-6 -translate-x-1/2"
                    viewBox="0 0 24 12"
                  >
                    <motion.path
                      d="M 2 8 Q 12 2 22 8"
                      stroke="#333"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </motion.svg>
                </motion.div>

                {/* Speech Bubble */}
                <motion.div
                  className="relative rounded-2xl bg-white px-4 py-2 shadow-lg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <p className="whitespace-nowrap text-center text-sm font-bold text-gray-800">
                    Nuh uh! 🙅
                  </p>
                  <p className="mt-1 text-center text-xs text-gray-600">
                    Finish your payment first!
                  </p>

                  {/* Tail */}
                  <div className="absolute -bottom-2 left-4 h-3 w-3 bg-white" />
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
