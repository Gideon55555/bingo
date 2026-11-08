import React from 'react';

// Original simple figures: four ordinary people (one shirt colour per seat) and a police officer.
export function Person({ color, label, ...rest }) {
  return (
    <svg viewBox="0 0 40 56" className="fig" aria-hidden="true" {...rest}>
      <ellipse cx="20" cy="53" rx="11" ry="2.6" fill="rgba(0,0,0,.45)" />
      <rect x="13" y="36" width="5.5" height="16" rx="2.6" fill="#2b2a33" /><rect x="21.5" y="36" width="5.5" height="16" rx="2.6" fill="#2b2a33" />
      <path d="M9 38 Q8 22 20 21 Q32 22 31 38 Z" fill={color} stroke="rgba(0,0,0,.3)" strokeWidth="1" />
      <rect x="5.5" y="24" width="5" height="13" rx="2.5" fill={color} transform="rotate(12 8 24)" />
      <rect x="29.5" y="24" width="5" height="13" rx="2.5" fill={color} transform="rotate(-12 32 24)" />
      <circle cx="20" cy="12" r="8" fill="#a86a3d" />
      <path d="M12 11 Q12 3.5 20 3.5 Q28 3.5 28 11 Q25 7 20 7.5 Q15 7 12 11Z" fill="#1d1410" />
      <circle cx="17" cy="12.5" r="1" fill="#1d1410" /><circle cx="23" cy="12.5" r="1" fill="#1d1410" />
      <path d="M17.5 16 Q20 17.6 22.5 16" stroke="#1d1410" strokeWidth="1" fill="none" strokeLinecap="round" />
      {label && <text x="20" y="33" textAnchor="middle" fontSize="9" fontWeight="900" fill="rgba(0,0,0,.65)">{label}</text>}
    </svg>
  );
}

export function Cop(props) {
  return (
    <svg viewBox="0 0 40 56" className="fig" aria-hidden="true" {...props}>
      <ellipse cx="20" cy="53" rx="12" ry="2.8" fill="rgba(0,0,0,.5)" />
      <rect x="12.5" y="36" width="6" height="16" rx="2.6" fill="#141c3a" /><rect x="21.5" y="36" width="6" height="16" rx="2.6" fill="#141c3a" />
      <path d="M8 39 Q7 22 20 21 Q33 22 32 39 Z" fill="#23346e" stroke="#0d1530" strokeWidth="1" />
      <rect x="4.5" y="24" width="5.5" height="14" rx="2.7" fill="#23346e" transform="rotate(14 7 24)" />
      <rect x="30" y="24" width="5.5" height="14" rx="2.7" fill="#23346e" transform="rotate(-14 33 24)" />
      <rect x="8.5" y="34" width="23" height="3.2" fill="#111" /><rect x="18" y="33.8" width="4" height="3.6" rx=".6" fill="#f3c14b" />
      <path d="M20 21 L20 33" stroke="#0d1530" strokeWidth="1" />
      <path d="M25.5 25.5 l1.1 2.2 2.4.3 -1.8 1.6 .5 2.4 -2.2-1.2 -2.2 1.2 .5-2.4 -1.8-1.6 2.4-.3z" fill="#f3c14b" />
      <circle cx="20" cy="13" r="7.6" fill="#8d5a33" />
      <circle cx="17.2" cy="13.5" r="1" fill="#1d1410" /><circle cx="22.8" cy="13.5" r="1" fill="#1d1410" />
      <path d="M16.5 17.2 L23.5 17.2" stroke="#1d1410" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M10.5 9 Q20 1 29.5 9 L28 10.6 L12 10.6 Z" fill="#1b2752" />
      <rect x="11" y="9.6" width="18" height="2.6" rx="1" fill="#0b0f20" />
      <path d="M20 4.2 l1.2 1.6 -1.2 1.6 -1.2 -1.6z" fill="#f3c14b" />
    </svg>
  );
}

