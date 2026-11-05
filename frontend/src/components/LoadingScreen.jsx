// CodeCraft loading animation: the logo, with the CODECRAFT letters rising in
// a wave (CODE in navy, CRAFT in orange, like the logo).
//
//   <LoadingScreen />                      full page (app start)
//   <LoadingScreen compact label="..." />  inside a page or tab
//
// The same look is written straight into index.html, so it shows before the
// app has even downloaded. Styles: .cc-loader* in index.css.

const LETTERS = 'CODECRAFT'.split('');

export default function LoadingScreen({ compact = false, label = null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={compact ? 'cc-loader cc-loader--compact' : 'cc-loader cc-loader--full'}
    >
      <svg className="cc-loader__mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path className="cc-loader__left" d="M12 6L4 16L12 26" strokeWidth="2.5" strokeLinecap="square" />
        <path className="cc-loader__right" d="M20 6L28 16L20 26" strokeWidth="2.5" strokeLinecap="square" />
        <rect className="cc-loader__dot" x="15" y="15" width="2" height="2" />
      </svg>
      <div className="cc-loader__word" aria-hidden="true">
        {LETTERS.map((ch, i) => (
          <span key={i} className={i < 4 ? 'cc-loader__code' : 'cc-loader__craft'} style={{ animationDelay: `${i * 0.08}s` }}>
            {ch}
          </span>
        ))}
      </div>
      <span className="cc-loader__label">{label || 'Loading CodeCraft…'}</span>
    </div>
  );
}
