import React, { useMemo, useState } from 'react';
import { useCollection } from '../data/store';
import SectionDivider from '../components/SectionDivider';

const ACCENTS = ['gold', 'burgundy', 'navy'];

function accentFor(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return ACCENTS[h % ACCENTS.length];
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr || '';
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function excerptOf(item) {
  if (item.excerpt) return item.excerpt;
  const plain = (item.body || '').replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? plain.slice(0, 157) + '…' : plain;
}

export default function News() {
  const news = useCollection('news') || [];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [tag, setTag] = useState(null);
  const [activeSlug, setActiveSlug] = useState(null);
  const [visible, setVisible] = useState(6);

  const sorted = useMemo(
    () => [...news].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [news]
  );

  const categories = useMemo(() => {
    const set = new Set(sorted.map(n => n.category).filter(Boolean));
    return ['All', ...set];
  }, [sorted]);

  const tags = useMemo(() => {
    const set = new Set();
    sorted.forEach(n => (n.tags || []).forEach(t => set.add(t)));
    return [...set];
  }, [sorted]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter(n => {
      const matchesCategory = category === 'All' || n.category === category;
      const matchesTag = !tag || (n.tags || []).includes(tag);
      const matchesQuery =
        !q ||
        n.title?.toLowerCase().includes(q) ||
        excerptOf(n).toLowerCase().includes(q);
      return matchesCategory && matchesTag && matchesQuery;
    });
  }, [sorted, query, category, tag]);

  const active = activeSlug ? sorted.find(n => n.slug === activeSlug || n.id === activeSlug) : null;

  if (active) {
    const related = sorted
      .filter(n => n.id !== active.id && n.category === active.category)
      .slice(0, 3);

    return (
      <div className="page news-page">
        <section className="section section--hero-mini">
          <div className="container">
            <button
              className="btn btn-outline back-link"
              onClick={() => setActiveSlug(null)}
              aria-label="Back to all news"
            >
              ← Back to News
            </button>
            <p className={`tag-pill accent-${accentFor(active.category)}`}>{active.category || 'Ministry News'}</p>
            <h1 className="display-1">{active.title}</h1>
            <div className="meta">
              <time dateTime={active.date}>{formatDate(active.date)}</time>
              {active.author && <span> · by {active.author}</span>}
            </div>
          </div>
        </section>

        <SectionDivider />

        <section className="section">
          <div className="container article-detail">
            {active.image && (
              <img className="article-image" src={active.image} alt={active.title} />
            )}
            <div className="article-body">
              {(active.body || excerptOf(active))
                .split(/\n\s*\n/)
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>

            {!!(active.tags && active.tags.length) && (
              <div className="tag-cloud" aria-label="Article tags">
                {active.tags.map(t => (
                  <button
                    key={t}
                    className={`tag-pill accent-${accentFor(t)}`}
                    onClick={() => {
                      setTag(t);
                      setActiveSlug(null);
                    }}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}

            <div className="share-row">
              <span className="meta">Share this word:</span>
              <a
                className="btn btn-outline"
                href={`mailto:?subject=${encodeURIComponent(active.title)}&body=${encodeURIComponent(
                  (active.excerpt || excerptOf(active)) + '\n\n— Rev. Felix Agidipo Ministries'
                )}`}
              >
                Email
              </a>
              <a
                className="btn btn-outline"
                href={`https://wa.me/?text=${encodeURIComponent(active.title + ' — ' + (active.excerpt || ''))}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
            </div>
          </div>
        </section>

        {related.length > 0 && (
          <>
            <SectionDivider />
            <section className="section">
              <div className="container">
                <h2 className="display-2">More in {active.category}</h2>
                <div className="grid-mag news-grid">
                  {related.map(item => (
                    <article
                      key={item.id}
                      className="card news-card"
                      onClick={() => setActiveSlug(item.slug || item.id)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={e => e.key === 'Enter' && setActiveSlug(item.slug || item.id)}
                    >
                      <h3>{item.title}</h3>
                      <p className="meta">{formatDate(item.date)}</p>
                      <p>{excerptOf(item)}</p>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    );
  }

  const featured = filtered[0];
  const rest = filtered.slice(1, visible);

  return (
    <div className="page news-page">
      <section className="section section--hero">
        <div className="container">
          <p className="eyebrow">Word &amp; Witness</p>
          <h1 className="display-1">News &amp; Testimonies</h1>
          <p className="lede">
            Reports from the field, prophetic updates, and testimonies of the goodness of God
            through the ministry of Rev. Felix Agidipo.
          </p>
        </div>
      </section>

      <SectionDivider />

      <section className="section">
        <div className="container">
          <div className="filter-bar" role="search">
            <input
              type="search"
              className="input"
              placeholder="Search news and testimonies…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search news"
            />
            <nav className="category-tabs" aria-label="Filter by category">
              {categories.map(c => (
                <button
                  key={c}
                  className={`btn btn-pill ${category === c ? 'is-active' : ''}`}
                  aria-current={category === c ? 'true' : undefined}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </nav>
          </div>

          {tags.length > 0 && (
            <div className="tag-cloud" aria-label="Filter by tag">
              {tag && (
                <button className="tag-pill accent-burgundy" onClick={() => setTag(null)}>
                  ✕ Clear #{tag}
                </button>
              )}
              {tags
                .filter(t => t !== tag)
                .map(t => (
                  <button key={t} className={`tag-pill accent-${accentFor(t)}`} onClick={() => setTag(t)}>
                    #{t}
                  </button>
                ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="empty-state">
              No stories match just yet. Adjust your search, or check back soon — the Lord is always
              writing a new chapter.
            </p>
          ) : (
            <>
              {featured && (
                <article
                  className="card news-card news-card--feature"
                  onClick={() => setActiveSlug(featured.slug || featured.id)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={e => e.key === 'Enter' && setActiveSlug(featured.slug || featured.id)}
                >
                  {featured.image && <img src={featured.image} alt={featured.title} />}
                  <div>
                    <p className={`tag-pill accent-${accentFor(featured.category)}`}>
                      {featured.category || 'Ministry News'}
                    </p>
                    <h2 className="display-2">{featured.title}</h2>
                    <p className="meta">{formatDate(featured.date)}</p>
                    <p>{excerptOf(featured)}</p>
                    <span className="read-more">Read full story →</span>
                  </div>
                </article>
              )}

              <div className="grid-mag news-grid">
                {rest.map(item => (
                  <article
                    key={item.id}
                    className="card news-card"
                    onClick={() => setActiveSlug(item.slug || item.id)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={e => e.key === 'Enter' && setActiveSlug(item.slug || item.id)}
                  >
                    {item.image && <img src={item.image} alt={item.title} />}
                    <p className={`tag-pill accent-${accentFor(item.category)}`}>
                      {item.category || 'Ministry News'}
                    </p>
                    <h3>{item.title}</h3>
                    <p className="meta">{formatDate(item.date)}</p>
                    <p>{excerptOf(item)}</p>
                    <span className="read-more">Read more →</span>
                  </article>
                ))}
              </div>

              {visible < filtered.length && (
                <div className="load-more-row">
                  <button className="btn btn-gold" onClick={() => setVisible(v => v + 6)}>
                    Load More Stories
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}