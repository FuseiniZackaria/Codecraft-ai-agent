import { useState } from 'react';

// Ian's picture: frontend/public/ian.webp (256x256; replace that file and bump ?v= to change it).
// If the picture is missing or can't load, the first letter of his name shows instead.
export const IAN_IMAGE = '/ian.webp?v=1';

export default function IanAvatar({ name = 'Ian', className = '', letterClassName = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`font-[var(--font-display)] font-bold ${letterClassName}`}>{name.charAt(0)}</span>;
  }
  return (
    <img
      src={IAN_IMAGE}
      alt=""
      aria-hidden="true"
      draggable="false"
      onError={() => setFailed(true)}
      className={`w-full h-full rounded-full object-cover ${className}`}
    />
  );
}
