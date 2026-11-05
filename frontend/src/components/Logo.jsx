// The CodeCraft </> mark. `onDark` draws the left bracket in white for the navy brand bar.
export default function Logo({ size = 22, onDark = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 6L4 16L12 26" stroke={onDark ? '#ffffff' : 'var(--color-text)'} strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" />
      <path d="M20 6L28 16L20 26" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" />
      <rect x="15" y="15" width="2" height="2" fill="var(--color-accent)" />
    </svg>
  );
}
