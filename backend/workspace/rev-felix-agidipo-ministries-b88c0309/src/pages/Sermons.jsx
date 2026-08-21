import { useMemo, useState } from "react";
import { useCollection } from "../data/store.js";
import SectionDivider from "../components/SectionDivider.jsx";

function getYouTubeId(url = "") {
  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" });
}

const PAGE_SIZE = 6;

export default function Sermons() {
  const [sermons] = useCollection("sermons");
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState("newest");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [playingId, setPlayingId] = useState(null);

  const seriesOptions = useMemo(() => {
    const set = new Set((sermons || []).map((s) => s.series).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [sermons]);

  const tagOptions = useMemo(() => {
    const set = new Set();
    (sermons || []).forEach((s) => (s.tags || []).forEach((t) => set.add(t)));
    return ["all", ...Array.from(set).sort()];
  }, [sermons]);

  const filtered = useMemo(() => {
    let list = (sermons || []).slice();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        [s.title, s.speaker, s.scripture, s.summary]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(q))
      );
    }
    if (series !== "all") list = list.filter((s) => s.series === series);
    if (tag !== "all") list = list.filter((s) => (s.tags || []).includes(tag));
    list.sort((a, b) => {
      const da = new Date(a.date || 0).getTime();
      const db = new Date(b.date || 0).getTime();
      return sort === "newest" ? db - da : da - db;
    });
    return list;
  }, [sermons, query, series, tag, sort]);

  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > shown.length;

  return (
    <main className="sermons-page">
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">The Sermon Library</p>
          <h1 className="page-hero__title">Words Poured Out, Kept for Return</h1>
          <p className="page-hero__lede">
            Every message preached at Rev. Felix Agidipo Ministries is archived here —
            searchable by scripture, series, or the burden it carried, so you can sit
            under the word again whenever you need it.
          </p>
        </div>
      </section>

      <SectionDivider />

      <section className="section section--champagne sermons-filterbar">
        <div className="container">
          <div className="filter-bar">
            <input
              type="search"
              className="input filter-bar__search"
              placeholder="Search by title, speaker, or scripture…"
              value={query}
              aria-label="Search sermons"
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE_SIZE);
              }}
            />
            <select
              className="select"
              value={series}
              aria-label="Filter by series"
              onChange={(e) => {
                setSeries(e.target.value);
                setVisible(PAGE_SIZE);
              }}
            >
              {seriesOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All Series" : s}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={tag}
              aria-label="Filter by topic"
              onChange={(e) => {
                setTag(e.target.value);
                setVisible(PAGE_SIZE);
              }}
            >
              {tagOptions.map((t) => (
                <option key={t} value={t}>
                  {t === "all" ? "All Topics" : t}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={sort}
              aria-label="Sort order"
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
          <p className="filter-bar__count">
            {filtered.length} sermon{filtered.length === 1 ? "" : "s"} found
          </p>
        </div>
      </section>

      <section className="section section--ivory sermons-grid-wrap">
        <div className="container">
          {shown.length === 0 ? (
            <div className="empty-state">
              <h3>No sermons match your search</h3>
              <p>Try clearing a filter, or check back soon — new messages are added regularly.</p>
            </div>
          ) : (
            <div className="grid-asymmetric sermons-grid">
              {shown.map((s, i) => {
                const videoId = getYouTubeId(s.youtubeUrl);
                const isPlaying = playingId === s.id;
                const cardSize = i % 5 === 0 ? "card--wide" : "card--regular";
                return (
                  <article className={`card sermon-card ${cardSize}`} key={s.id}>
                    <div className="sermon-card__media">
                      {videoId ? (
                        isPlaying ? (
                          <iframe
                            className="sermon-card__iframe"
                            src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                            title={s.title}
                            frameBorder="0"
                            allow="accelerated-video-decode; autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                          />
                        ) : (
                          <button
                            type="button"
                            className="sermon-card__thumb-btn"
                            onClick={() => setPlayingId(s.id)}
                            aria-label={`Play sermon: ${s.title}`}
                            style={{
                              backgroundImage: `url(https://img.youtube.com/vi/${videoId}/hqdefault.jpg)`,
                            }}
                          >
                            <span className="sermon-card__play" aria-hidden="true">▶</span>
                          </button>
                        )
                      ) : (
                        <div className="sermon-card__thumb-btn sermon-card__thumb-btn--empty">
                          <span aria-hidden="true">🕊</span>
                        </div>
                      )}
                    </div>
                    <div className="sermon-card__body">
                      {s.series && <p className="sermon-card__series">{s.series}</p>}
                      <h3 className="sermon-card__title">{s.title}</h3>
                      <p className="sermon-card__meta">
                        {s.speaker}
                        {s.date ? ` · ${formatDate(s.date)}` : ""}
                      </p>
                      {s.scripture && <p className="sermon-card__scripture">{s.scripture}</p>}
                      {s.summary && <p className="sermon-card__summary">{s.summary}</p>}
                      {!!(s.tags || []).length && (
                        <div className="sermon-card__tags">
                          {s.tags.map((t) => (
                            <span className="badge" key={t}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="load-more-wrap">
              <button
                type="button"
                className="btn btn-outline-gold"
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
              >
                Load More Sermons
              </button>
            </div>
          )}
        </div>
      </section>

      <SectionDivider />
    </main>
  );
}