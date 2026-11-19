import React from 'react';
import type { ThemeShift } from '../types/laundry';

interface ThemeToggleProps {
  shift: ThemeShift;
  onToggle: (next: ThemeShift) => void;
}

/**
 * Day/Night Shift Toggle inspired by Uiverse rishichawda/fluffy-robin-48
 * styled with Neo-Brutalist ink outline & hard offset shadow.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ shift, onToggle }) => {
  const isNight = shift === 'night';

  return (
    <label
      htmlFor="kilowash-shift-toggle"
      title={
        isNight
          ? 'Night Shift (24H) — Click for Day Shift'
          : 'Day Shift (24H) — Click for Night Shift'
      }
      className="relative inline-block cursor-pointer select-none shrink-0"
      style={{ width: '82px', height: '38px' }}
    >
      <input
        id="kilowash-shift-toggle"
        type="checkbox"
        checked={isNight}
        onChange={(e) => onToggle(e.target.checked ? 'night' : 'day')}
        className="sr-only"
        aria-label="Toggle Day and Night shift"
      />
      <svg
        viewBox="0 0 90 36"
        className="block w-full h-full rounded-full overflow-hidden"
        style={{
          border: '2.5px solid var(--ink)',
          boxShadow: '3px 3px 0 var(--shadow-color)',
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Sky container */}
        <rect
          x="0"
          y="0"
          width="90"
          height="36"
          rx="18"
          fill={isNight ? '#2b4360' : '#70C5EE'}
          style={{ transition: 'fill 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />

        {/* Day Clouds */}
        <g
          style={{
            opacity: isNight ? 0 : 1,
            transform: isNight ? 'translateX(12px)' : 'translateX(0)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <path
            d="M50 25a4.5 4.5 0 0 1 4.5-4.5h2a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1-3.5 3.5h-6.5a1.5 1.5 0 0 1 0-3z"
            fill="#ffffff"
          />
          <circle cx="65" cy="14" r="4" fill="#ffffff" />
          <circle cx="70" cy="15" r="5" fill="#ffffff" />
          <circle cx="75" cy="16" r="3.5" fill="#ffffff" />
        </g>

        {/* Night Stars */}
        <g
          style={{
            opacity: isNight ? 1 : 0,
            transform: isNight ? 'translateY(0)' : 'translateY(-6px)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <circle cx="16" cy="12" r="1.4" fill="#fff8c9" />
          <circle cx="27" cy="24" r="1.1" fill="#fff8c9" />
          <circle cx="35" cy="10" r="1.6" fill="#fff8c9" />
          <path
            d="M22 15l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z"
            fill="#fff8c9"
          />
        </g>

        {/* Sliding Knob: Sun / Moon */}
        <g
          style={{
            transform: isNight ? 'translate(54px, 2.5px)' : 'translate(3px, 2.5px)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <circle
            cx="15.5"
            cy="15.5"
            r="13"
            fill="#ffffff"
            stroke="#111111"
            strokeWidth="2"
          />
          {/* Sun */}
          <g
            style={{
              opacity: isNight ? 0 : 1,
              transition: 'opacity 0.25s ease',
            }}
          >
            <circle cx="15.5" cy="15.5" r="7.5" fill="#f39c12" />
            <circle cx="15.5" cy="15.5" r="5" fill="#f1c40f" />
          </g>
          {/* Moon */}
          <g
            style={{
              opacity: isNight ? 1 : 0,
              transition: 'opacity 0.25s ease',
            }}
          >
            <circle cx="15.5" cy="15.5" r="8" fill="#d9e2ec" />
            <circle cx="12.5" cy="13" r="1.8" fill="#9fb3c8" />
            <circle cx="18" cy="18" r="2.2" fill="#9fb3c8" />
            <circle cx="18" cy="11.5" r="1.1" fill="#9fb3c8" />
          </g>
        </g>
      </svg>
    </label>
  );
};
