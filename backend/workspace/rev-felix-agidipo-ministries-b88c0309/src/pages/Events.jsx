import { useState, useMemo } from 'react';
import { useCollection } from '../data/store.js';
import SectionDivider from '../components/SectionDivider.jsx';

const DEFAULT_EVENTS = [
  {
    id: 'ev-fire-glory',
    title: 'Fire & Glory Crusade',
    date: '2025-12-12T17:00',
    location: 'Agidipo Chapel Grounds, Ibadan',
    address: 'Km 8, Ibadan–Ife Expressway, Ibadan, Oyo State',
    mapUrl: 'https://maps.google.com/?q=Ibadan+Ife+Expressway+Ibadan',
    summary: 'Three nights of open-air deliverance, healing and worship as we contend for the fire that fell in the beginning.',
    description:
      'The Fire & Glory Crusade returns for its ninth year, gathering thousands under the night sky for prophetic ministration, testimonies of healing and an altar call that has marked entire households. Come expecting the God of Elijah to answer by fire.',
    registrationRequired: false,
    registrationNote: 'Free entry. Arrive early — grounds open at 4:00 PM.',
    tags: ['Crusade', 'Deliverance'],
  },
  {
    id: 'ev-ministers-impartation',
    title: "Ministers' Impartation Conference",
    date: '2026-02-19T09:00',
    location: 'Grace Hall, Lagos',
    address: '14 Awolowo Road, Ikoyi, Lagos',
    mapUrl: 'https://maps.google.com/?q=Awolowo+Road+Ikoyi+Lagos',
    summary: 'A closed-session gathering for pastors and ministry leaders on the mantle, the message, and the ministry of oil.',
    description:
      'Rev. Felix Agidipo convenes fellow ministers for three days of raw teaching on prophetic authority, pastoral endurance and the anointing that sustains a call over decades. Includes private impartation and a Q&A fireside session.',
    registrationRequired: true,
    registrationLink: 'mailto:events@felixagidipoministries.org?subject=Ministers%20Impartation%20Conference',
    registrationNote: 'Limited to 300 credentialed ministers. Registration closes Feb 5.',
    tags: ['Conference', 'Leaders'],
  },
  {
    id: 'ev-watchnight',
    title: 'Watch Night Crossover Service',
    date: '2025-12-31T22:00',
    location: 'Agidipo Chapel, Ibadan',
    address: 'Km 8, Ibadan–Ife Expressway, Ibadan, Oyo State',
    mapUrl: 'https://maps.google.com/?q=Agidipo+Chapel+Ibadan',
    summary: 'We cross into the new year on our knees, anointing the threshold of the coming season with prayer and thanksgiving.',
    description:
      'A sanctuary vigil of worship, prophetic declarations and Holy Communion carrying the congregation from the old year into the new — closing with the anointing of oil over every household representative present.',
    registrationRequired: false,
    registrationNote: 'Open to all. Doors open 9:30 PM.',
    tags: ['Vigil', 'Communion'],
  },
  {
    id: 'ev-family-altar',
    title: 'Family Altar Retreat',
    date: '2026-04-10T08:00',
    location: 'Prayer Mountain Retreat Centre, Oyo',
    address: 'Iseyin Road, Oyo State',
    mapUrl: 'https://maps.google.com/?q=Iseyin+Road+Oyo+State',
    summary: 'A weekend for households to rebuild the family altar — fasting, teaching, and covenant renewal for husbands, wives and children.',
    description:
      'Families withdraw from the noise of the city for a weekend of fasting, marriage counsel, and generational deliverance sessions, closing with a covenant renewal service for every couple present.',
    registrationRequired: true,
    registrationLink: 'mailto:events@felixagidipoministries.org?subject=Family%20Altar%20Retreat',
    registrationNote: 'Accommodation limited — register by March 20 to secure a room.',
    tags: ['Retreat', 'Family'],
  },
  {
    id: 'ev-anniversary',
    title: '30th Anniversary Thanksgiving',
    date: '2024-09-08T10:00',
    location: 'Agidipo Chapel, Ibadan',
    address: 'Km 8, Ibadan–Ife Expressway, Ibadan, Oyo State',
    mapUrl: 'https://maps.google.com/?q=Agidipo+Chapel+Ibadan',
    summary: 'Thirty years of ministry celebrated with testimonies, a historical exhibition, and a citywide thanksgiving procession.',
    description:
      'The ministry marked three decades of service with an all-day thanksgiving service, an exhibition tracing Rev. Agidipo\'s journey from a village altar to a national ministry, and a procession through Ibadan streets.',
    registrationRequired: false,
    registrationNote: 'Archived event — photos and highlights in the Gallery.',
    tags: ['Anniversary', 'Thanksgiving'],
  },
  {
    id: 'ev-healing-school',
    title: 'School of Healing & Faith',
    date: '2024-11-16T09:00',
    location: 'Grace Hall, Lagos',
    address: '14 Awolowo Road, Ikoyi, Lagos',
    mapUrl: 'https://maps.google.com/?q=Awolowo+Road+Ikoyi+Lagos',
    summary: 'A five-day intensive on divine healing scripture, case testimonies, and ministering to the sick with compassion and authority.',
    description:
      'Attendees studied the healing ministry of Christ verse by verse, practiced ministry in small groups, and left equipped to pray for the sick with both compassion and confidence.',
    registrationRequired: false,
    registrationNote: 'Archived event — recordings available under Sermons.',
    tags: ['Teaching', 'Healing'],
  },
];

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function toICSDate(iso) {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function downloadICS(event) {
  const start = toICSDate(event.date);
  const end = toICSDate(new Date(new Date(event.date).getTime() + 2 * 60 * 60 * 1000).toISOString());
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Felix Agidipo Ministries//Events//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@felixagidipoministries.org`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title}`,
    `LOCATION:${event.location}, ${event.address}`,
    `DESCRIPTION:${event.summary.replace(/,/g, '\\,')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.replace(/\s+/g, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shareLinks(event) {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(`${event.title} — ${formatDate(event.date)} at ${event.location}`);
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
  };
}

export default function Events() {
  const [events] = useCollection('events', DEFAULT_EVENTS);
  const [filter, setFilter] = useState('upcoming');
  const [shareOpenId, setShareOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
    return {
      upcoming: sorted.filter((e) => new Date(e.date).getTime() >= now),
      past: sorted.filter((e) => new Date(e.date).getTime() < now).reverse(),
    };
  }, [events]);

  const list = filter === 'upcoming' ? upcoming : past;

  function handleCopy(event) {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopiedId(event.id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  return (
    <div className="page page-events">
      <header className="page-hero page-hero--events">
        <div className="container">
          <p className="eyebrow">Gatherings &amp; Occasions</p>
          <h1>Events</h1>
          <p className="page-hero__lede">
            From open-air crusades to closed-session leadership conferences, every gathering carries
            the same posture — an altar set, oil poured, and room made for God to move.
          </p>
        </div>
      </header>

      <SectionDivider />

      <section className="section">
        <div className="container">
          <div className="tab-group" role="tablist" aria-label="Filter events">
            <button
              role="tab"
              aria-selected={filter === 'upcoming'}
              className={`tab ${filter === 'upcoming' ? 'tab--active' : ''}`}
              onClick={() => setFilter('upcoming')}
            >
              Upcoming ({upcoming.length})
            </button>
            <button
              role="tab"
              aria-selected={filter === 'past'}
              className={`tab ${filter === 'past' ? 'tab--active' : ''}`}
              onClick={() => setFilter('past')}
            >
              Past ({past.length})
            </button>
          </div>

          {list.length === 0 ? (
            <p className="empty-state">No {filter} events at this time. Please check back soon.</p>
          ) : (
            <div className="events-grid">
              {list.map((event, i) => {
                const links = shareLinks(event);
                const featured = filter === 'upcoming' && i === 0;
                return (
                  <article
                    key={event.id}
                    className={`event-card ${featured ? 'event-card--featured' : ''}`}
                  >
                    <div className="event-media" aria-hidden="true">
                      <span className="event-media__month">
                        {new Date(event.date).toLocaleDateString('en-US', { month: 'short' })}
                      </span>
                      <span className="event-media__day">
                        {new Date(event.date).toLocaleDateString('en-US', { day: '2-digit' })}
                      </span>
                    </div>

                    <div className="event-body">
                      <div className="event-tags">
                        {event.tags?.map((t) => (
                          <span className="event-tag" key={t}>{t}</span>
                        ))}
                      </div>

                      <h3 className="event-title">{event.title}</h3>

                      <p className="event-meta">
                        {formatDate(event.date)} · {formatTime(event.date)}
                      </p>
                      <p className="event-meta event-meta--location">{event.location}</p>

                      <p className="event-summary">{event.summary}</p>

                      <details className="event-details">
                        <summary>Full details</summary>
                        <p>{event.description}</p>
                        <p className="event-address">{event.address}</p>
                      </details>

                      <p className="event-registration">
                        {event.registrationRequired ? (
                          <>
                            <strong>Registration required.</strong> {event.registrationNote}
                          </>
                        ) : (
                          <>{event.registrationNote}</>
                        )}
                      </p>

                      <div className="event-actions">
                        <a
                          className="btn btn-ghost"
                          href={event.mapUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Get Directions
                        </a>

                        {filter === 'upcoming' && (
                          <button className="btn btn-ghost" onClick={() => downloadICS(event)}>
                            Add to Calendar
                          </button>
                        )}

                        {filter === 'upcoming' && event.registrationRequired && (
                          <a className="btn btn-primary" href={event.registrationLink}>
                            Register
                          </a>
                        )}

                        <div className="share-wrap">
                          <button
                            className="btn btn-icon"
                            aria-haspopup="true"
                            aria-expanded={shareOpenId === event.id}
                            onClick={() =>
                              setShareOpenId(shareOpenId === event.id ? null : event.id)
                            }
                          >
                            Share
                          </button>
                          {shareOpenId === event.id && (
                            <div className="share-menu" role="menu">
                              <a href={links.facebook} target="_blank" rel="noreferrer" role="menuitem">
                                Facebook
                              </a>
                              <a href={links.x} target="_blank" rel="noreferrer" role="menuitem">
                                X (Twitter)
                              </a>
                              <a href={links.whatsapp} target="_blank" rel="noreferrer" role="menuitem">
                                WhatsApp
                              </a>
                              <button role="menuitem" onClick={() => handleCopy(event)}>
                                {copiedId === event.id ? 'Link copied!' : 'Copy link'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <SectionDivider />

      <section className="section section--callout">
        <div className="container callout-box">
          <h2>Hosting a joint outreach?</h2>
          <p>
            Churches and fellowships partnering with Rev. Felix Agidipo Ministries for a crusade,
            conference, or retreat can request event listing and support materials directly.
          </p>
          <a className="btn btn-primary" href="/contact">
            Request a Partnership
          </a>
        </div>
      </section>
    </div>
  );
}