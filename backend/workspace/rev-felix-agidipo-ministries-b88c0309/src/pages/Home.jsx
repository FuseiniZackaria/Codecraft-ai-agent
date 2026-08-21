import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStore, subscribeStore } from '../data/store';
import SectionDivider from '../components/SectionDivider';

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Home() {
  const [store, setStore] = useState(getStore());

  useEffect(() => subscribeStore(setStore), []);

  const { settings = {}, events = [], sermons = [], activities = [], news = [] } = store;

  const upcomingEvents = [...events]
    .filter((e) => !e.date || new Date(e.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 3);

  const latestSermons = [...sermons]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3);

  const featuredActivities = activities.slice(0, 4);
  const latestNews = news.slice(0, 1)[0];

  return (
    <>
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <div className="hero__inner container">
          <p className="eyebrow eyebrow--gold">{settings.tagline || 'A Ministry of Presence & Power'}</p>
          <h1 className="hero__title">
            {settings.heroTitle || 'Rev. Felix Agidipo'}
          </h1>
          <p className="hero__subtitle">
            {settings.heroSubtitle ||
              'Shepherding hearts, anointing lives, and carrying the fragrance of Christ into every nation He calls us to.'}
          </p>
          <div className="hero__ctas">
            <Link to="/events" className="btn btn--gold">See Upcoming Events</Link>
            <Link to="/sermons" className="btn btn--ghost">Watch a Sermon</Link>
          </div>
        </div>
      </section>

      <SectionDivider />

      <section className="section container bio-intro">
        <div className="bio-intro__portrait" aria-hidden="true">
          <div className="bio-intro__frame" />
        </div>
        <div className="bio-intro__text">
          <p className="eyebrow">Who We Are</p>
          <h2 className="section-title">A Voice Raised for This Generation</h2>
          <p>
            {settings.bio ||
              'Rev. Felix Agidipo is a teacher of the Word, a shepherd to the wounded, and a vessel poured out in service to Christ\'s church. For over two decades, this ministry has stood as a place where the broken are mended, the hungry are fed truth, and the called are commissioned into their purpose.'}
          </p>
          <Link to="/about" className="text-link">Read the full story →</Link>
        </div>
      </section>

      <SectionDivider />

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Mark Your Calendar</p>
            <h2 className="section-title">Upcoming Events</h2>
          </div>
          <Link to="/events" className="text-link">All events →</Link>
        </div>

        {upcomingEvents.length === 0 ? (
          <p className="empty-note">New gatherings are being prepared — check back soon.</p>
        ) : (
          <div className="magazine-grid">
            {upcomingEvents.map((ev, i) => (
              <article
                key={ev.id}
                className={`card card--event ${i === 0 ? 'card--feature' : ''}`}
              >
                <span className="card__date">{fmtDate(ev.date)}</span>
                <h3 className="card__title">{ev.title}</h3>
                <p className="card__desc">{ev.description}</p>
                {ev.location && <p className="card__meta">📍 {ev.location}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <SectionDivider />

      <section className="section container section--panel">
        <div className="section-head">
          <div>
            <p className="eyebrow eyebrow--gold">Fresh Word</p>
            <h2 className="section-title">Latest Sermons</h2>
          </div>
          <Link to="/sermons" className="text-link">All sermons →</Link>
        </div>

        {latestSermons.length === 0 ? (
          <p className="empty-note">Sermons will be uploaded shortly.</p>
        ) : (
          <div className="magazine-grid magazine-grid--sermons">
            {latestSermons.map((s) => (
              <article key={s.id} className="card card--sermon">
                <p className="card__date">{fmtDate(s.date)}</p>
                <h3 className="card__title">{s.title}</h3>
                <p className="card__meta">{s.speaker || 'Rev. Felix Agidipo'}</p>
                {s.videoUrl && (
                  <a href={s.videoUrl} target="_blank" rel="noreferrer" className="text-link text-link--small">
                    Watch now ▸
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <SectionDivider />

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">The Work</p>
            <h2 className="section-title">Our Activities</h2>
          </div>
          <Link to="/activities" className="text-link">Explore all →</Link>
        </div>

        {featuredActivities.length === 0 ? (
          <p className="empty-note">Ministry activities are being catalogued.</p>
        ) : (
          <div className="activity-grid">
            {featuredActivities.map((a, i) => (
              <div key={a.id} className={`activity-tile ${i % 3 === 0 ? 'activity-tile--tall' : ''}`}>
                <h3>{a.title}</h3>
                <p>{a.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {latestNews && (
        <>
          <SectionDivider />
          <section className="section container news-strip">
            <p className="eyebrow eyebrow--gold">In the News</p>
            <h2 className="section-title">{latestNews.title}</h2>
            <p className="news-strip__excerpt">{latestNews.excerpt || latestNews.body?.slice(0, 160)}</p>
            <Link to="/news" className="text-link">Read all news →</Link>
          </section>
        </>
      )}

      <SectionDivider variant="drop" />

      <section className="cta-band">
        <div className="container cta-band__inner">
          <h2>Come as you are. Leave anointed.</h2>
          <p>Join us in person or online — every seat is set apart for someone.</p>
          <div className="cta-band__actions">
            <Link to="/contact" className="btn btn--gold">Plan Your Visit</Link>
            <div className="socials">
              {(settings.socials || []).map((s) => (
                <a key={s.label} href={s.url} target="_blank" rel="noreferrer" aria-label={s.label}>
                  {s.label}
                </a>
              ))}
              {!(settings.socials && settings.socials.length) && (
                <>
                  <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook">Facebook</a>
                  <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram">Instagram</a>
                  <a href="https://youtube.com" target="_blank" rel="noreferrer" aria-label="YouTube">YouTube</a>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}