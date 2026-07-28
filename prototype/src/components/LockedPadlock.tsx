'use client';

import { useState, useRef } from 'react';

export default function LockedPadlock() {
  const [isClicked, setIsClicked] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const playDenialSound = () => {
    // Create a simple beep sound using Web Audio API for "nuhh nuhh"
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // First "nuhh"
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    
    osc1.frequency.setValueAtTime(200, audioContext.currentTime);
    osc1.frequency.setValueAtTime(150, audioContext.currentTime + 0.1);
    gain1.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain1.gain.setValueAtTime(0, audioContext.currentTime + 0.15);
    
    osc1.start(audioContext.currentTime);
    osc1.stop(audioContext.currentTime + 0.15);
    
    // Second "nuhh"
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    
    osc2.frequency.setValueAtTime(200, audioContext.currentTime + 0.2);
    osc2.frequency.setValueAtTime(150, audioContext.currentTime + 0.3);
    gain2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.2);
    gain2.gain.setValueAtTime(0, audioContext.currentTime + 0.35);
    
    osc2.start(audioContext.currentTime + 0.2);
    osc2.stop(audioContext.currentTime + 0.35);
  };

  const handlePadlockClick = () => {
    setIsClicked(true);
    playDenialSound();
    
    // Reset after animation
    setTimeout(() => setIsClicked(false), 1500);
  };

  return (
    <div className="relative flex flex-col items-center justify-center py-8">
      {/* Animated Glowing Padlock */}
      <style>{`
        @keyframes glow {
          0%, 100% {
            filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.6));
          }
          50% {
            filter: drop-shadow(0 0 20px rgba(245, 158, 11, 1)) drop-shadow(0 0 40px rgba(245, 158, 11, 0.4));
          }
        }

        @keyframes shake {
          0%, 100% {
            transform: translateX(0) translateY(0);
          }
          25% {
            transform: translateX(-8px) translateY(-2px);
          }
          50% {
            transform: translateX(8px) translateY(2px);
          }
          75% {
            transform: translateX(-8px) translateY(-2px);
          }
        }

        @keyframes bounce-pop {
          0% {
            transform: scale(0) translateY(40px);
            opacity: 0;
          }
          60% {
            transform: scale(1.1) translateY(-10px);
            opacity: 1;
          }
          100% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }

        @keyframes frown {
          0%, 100% {
            transform: rotateZ(0deg);
          }
          25% {
            transform: rotateZ(-5deg);
          }
          75% {
            transform: rotateZ(5deg);
          }
        }

        .padlock-container {
          animation: glow 2s ease-in-out infinite;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .padlock-container:hover {
          transform: scale(1.05);
        }

        .padlock-container.clicked {
          animation: shake 0.5s;
        }

        .character {
          animation: bounce-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .character.frown {
          animation: frown 0.8s ease-in-out 0.2s;
        }
      `}</style>

      {/* Padlock SVG */}
      <div
        className={`padlock-container ${isClicked ? 'clicked' : ''}`}
        onClick={handlePadlockClick}
      >
        <svg
          width="120"
          height="140"
          viewBox="0 0 120 140"
          className="drop-shadow-2xl"
        >
          {/* Padlock shackle (top arch) */}
          <path
            d="M 30 60 Q 30 20 60 20 Q 90 20 90 60"
            stroke="#f59e0b"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />

          {/* Padlock body */}
          <rect
            x="25"
            y="55"
            width="70"
            height="65"
            rx="6"
            fill="#fbbf24"
            stroke="#f59e0b"
            strokeWidth="3"
          />

          {/* Keyhole */}
          <circle cx="60" cy="80" r="6" fill="#78350f" />
          <path
            d="M 60 86 L 60 95"
            stroke="#78350f"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* Shine/gloss effect */}
          <ellipse
            cx="45"
            cy="70"
            rx="10"
            ry="15"
            fill="white"
            opacity="0.3"
          />
        </svg>
      </div>

      {/* Cartoon Character - appears on click */}
      {isClicked && (
        <div className="character absolute top-0 left-1/2 transform -translate-x-1/2">
          <svg
            width="100"
            height="110"
            viewBox="0 0 100 110"
            className="drop-shadow-lg"
          >
            {/* Head */}
            <circle cx="50" cy="35" r="25" fill="#FF6B6B" stroke="#D63031" strokeWidth="2" />

            {/* Eyes - sad/annoyed look */}
            <circle cx="40" cy="30" r="5" fill="white" />
            <circle cx="60" cy="30" r="5" fill="white" />

            {/* Pupils looking down-left (annoyed) */}
            <circle cx="38" cy="32" r="3" fill="black" />
            <circle cx="58" cy="32" r="3" fill="black" />

            {/* Eyebrows - angry/frowning */}
            <path
              d="M 35 22 Q 40 20 45 22"
              stroke="#D63031"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 55 22 Q 60 20 65 22"
              stroke="#D63031"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />

            {/* Mouth - frown */}
            <path
              d="M 40 48 Q 50 42 60 48"
              stroke="#D63031"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />

            {/* Arms */}
            <rect x="20" y="50" width="12" height="35" rx="6" fill="#FF6B6B" stroke="#D63031" strokeWidth="2" />
            <rect x="68" y="50" width="12" height="35" rx="6" fill="#FF6B6B" stroke="#D63031" strokeWidth="2" />

            {/* Hands in "NO" gesture */}
            <circle cx="25" cy="88" r="6" fill="#FFDBAC" stroke="#D63031" strokeWidth="1.5" />
            <circle cx="75" cy="88" r="6" fill="#FFDBAC" stroke="#D63031" strokeWidth="1.5" />

            {/* Body */}
            <rect x="38" y="60" width="24" height="30" rx="4" fill="#FF8787" stroke="#D63031" strokeWidth="2" />

            {/* Legs */}
            <rect x="42" y="90" width="6" height="16" rx="3" fill="#FFDBAC" stroke="#D63031" strokeWidth="1.5" />
            <rect x="52" y="90" width="6" height="16" rx="3" fill="#FFDBAC" stroke="#D63031" strokeWidth="1.5" />
          </svg>

          {/* "NUHH NUHH" text */}
          <div className="frown absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-8">
            <div className="text-2xl font-black text-red-600 drop-shadow-lg whitespace-nowrap">
              NUHH NUHH!
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
