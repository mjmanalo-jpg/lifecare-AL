import React from "react";

interface LcmsLogoProps {
  className?: string;
  iconOnly?: boolean;
}

export default function LcmsLogo({ className = "h-8 w-auto", iconOnly = false }: LcmsLogoProps) {
  return (
    <div className="flex items-center gap-2.5 select-none group">
      {/* Premium Blue Heart Care Logo */}
      <div className="relative shrink-0 flex items-center justify-center">
        <svg
          className="w-10 h-10 transition-transform duration-300 group-hover:scale-105"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Main Blue Heart Container with premium gradient */}
          <defs>
            <linearGradient id="lcmsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1d4ed8" />
            </linearGradient>
          </defs>
          <path
            d="M50 88C50 88 15 58 15 36C15 19 28 8 44 8C50 8 50 14 50 14C50 14 50 8 56 8C72 8 85 19 85 36C85 58 50 88 50 88Z"
            fill="url(#lcmsGradient)"
            filter="drop-shadow(0 2px 4px rgba(37, 99, 235, 0.2))"
          />
          {/* Inner Heart Layer for Depth */}
          <path
            d="M50 80C50 80 23 54 23 36C23 23 33 14 46 14C50 14 50 18 50 18C50 18 50 14 54 14C67 14 77 23 77 36C77 54 50 80 50 80Z"
            fill="white"
            opacity="0.95"
          />
          {/* Center Cross / Stethoscope Care Icon */}
          <g transform="translate(10, 5)" fill="#1d4ed8">
            {/* Stethoscope/Cross/Heart Element */}
            <path
              d="M40 28h-6v-6c0-1.1-.9-2-2-2s-2 .9-2 2v6h-6c-1.1 0-2 .9-2 2s.9 2 2 2h6v6c0 1.1.9 2 2 2s2-.9 2-2v-6h6c1.1 0 2-.9 2-2s-.9-2-2-2z"
              className="fill-blue-600"
            />
          </g>
          {/* Mini pulse/heart in center */}
          <circle cx="50" cy="35" r="3" fill="#1d4ed8" />
          <path
            d="M45 48 C 45 42, 55 42, 55 48 C 55 52, 50 55, 50 57 C 50 55, 45 52, 45 48 Z"
            fill="#1d4ed8"
          />
        </svg>
      </div>

      {!iconOnly && (
        <div className="flex flex-col">
          <span className="text-xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent leading-none">
            LCMS
          </span>
          <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 tracking-wider uppercase mt-1">
            LifeCare CMS
          </span>
        </div>
      )}
    </div>
  );
}
