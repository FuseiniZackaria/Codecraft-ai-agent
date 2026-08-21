// src/data/store.js
// Lightweight localStorage-backed "database" simulating a CMS for
// Rev. Felix Agidipo Ministries. Provides seed content + CRUD helpers
// and a pub/sub mechanism so React components re-render on change.

const NS = "ram"; // Rev. Agidipo Ministries namespace
const VERSION = "v1";

const KEYS = {
  activities: `${NS}_${VERSION}_activities`,
  events: `${NS}_${VERSION}_events`,
  sermons: `${NS}_${VERSION}_sermons`,
  gallery: `${NS}_${VERSION}_gallery`,
  news: `${NS}_${VERSION}_news`,
  settings: `${NS}_${VERSION}_settings`,
  seeded: `${NS}_${VERSION}_seeded`,
};

const EVENT_NAME = "ram-store-change";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function emitChange(collection) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { collection } }));
}

export function subscribe(collection, callback) {
  const handler = (e) => {
    if (!collection || e.detail?.collection === collection) callback();
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

// ---------------------------------------------------------------------------
// SEED CONTENT
// ---------------------------------------------------------------------------

const SEED = {
  settings: {
    ministryName: "Rev. Felix Agidipo Ministries",
    tagline: "Carriers of the Anointing, Bearers of the Word",
    heroHeadline: "Where the Oil Flows, Bondages Break",
    heroSubtext:
      "For over two decades, Rev. Felix Agidipo has ministered the Word with signs following — raising a generation anointed to heal, deliver, and disciple nations.",
    address: "14 Consecration Avenue, Ikeja, Lagos, Nigeria",
    phone: "+234 803 555 0142",
    email: "info@agidipoministries.org",
    serviceTimes: "Sundays 8:00 AM & 10:30 AM · Wednesdays 6:00 PM (Impartation Hour)",
    facebook: "https://facebook.com/agidipoministries",
    youtube: "https://youtube.com/@agidipoministries",
    instagram: "https://instagram.com/agidipoministries",
    aboutStory:
      "Rev. Felix Agidipo answered the call to ministry in 1999 after a life-altering encounter during a season of prayer and fasting. What began as a small cottage fellowship of twelve believers has grown into a global ministry with congregations, media reach, and outreach arms across three continents. His message is simple and unyielding: the same anointing that broke the yoke in ages past still flows today.",
    aboutMission:
      "To saturate this generation with the tangible presence and power of God through preaching, discipleship, healing, and compassionate outreach — raising sons and daughters who carry the anointing wherever they go.",
    aboutVision:
      "A world where every community has witnessed the undeniable, healing power of God through a Spirit-filled, Word-grounded Church.",
  },

  activities: [
    {
      id: uid(),
      title: "Dawn Intercession Watch",
      category: "Prayer",
      schedule: "Every day, 5:00 AM – 6:30 AM",
      description:
        "A daily altar of intercession where the Ministry stands in the gap for families, nations, and the Church at large before the break of day.",
      image:
        "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Compassion Outreach",
      category: "Outreach",
      schedule: "Last Saturday of every month",
      description:
        "Feeding, clothing, and ministering to widows, orphans, and underserved communities across Lagos and beyond — the Gospel demonstrated in deed.",
      image:
        "https://images.unsplash.com/photo-1593113630400-ea4288922497?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "School of the Anointing",
      category: "Discipleship",
      schedule: "Tuesdays, 6:00 PM – 8:00 PM",
      description:
        "A structured mentorship track training believers in the Word, prayer, and the operation of spiritual gifts for ministry and marketplace.",
      image:
        "https://images.unsplash.com/photo-1529070538774-1843cb3265df?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Youth Fire Fellowship",
      category: "Youth",
      schedule: "Fridays, 5:30 PM – 7:30 PM",
      description:
        "A vibrant gathering raising a bold, Spirit-filled generation through worship, mentorship, and hands-on ministry experience.",
      image:
        "https://images.unsplash.com/photo-1523580494863-6f3031224c94?q=80&w=1200&auto=format&fit=crop",
    },
  ],

  events: [
    {
      id: uid(),
      title: "National Anointing Convention",
      date: "2025-03-14",
      time: "9:00 AM",
      location: "Grace Dome, Ikeja, Lagos",
      description:
        "A three-day gathering of hungry hearts contending for a fresh outpouring — nightly ministration by Rev. Felix Agidipo and guest fathers of faith.",
      image:
        "https://images.unsplash.com/photo-1508162246048-a06d20cd3e5e?q=80&w=1200&auto=format&fit=crop",
      featured: true,
    },
    {
      id: uid(),
      title: "City-Wide Healing Crusade",
      date: "2025-05-02",
      time: "5:00 PM",
      location: "Freedom Field, Ojota, Lagos",
      description:
        "An open-air crusade declaring the goodness of God to the city, with testimonies of healing and deliverance from previous crusades.",
      image:
        "https://images.unsplash.com/photo-1478147427282-58a87a120781?q=80&w=1200&auto=format&fit=crop",
      featured: true,
    },
    {
      id: uid(),
      title: "Women of Virtue Retreat",
      date: "2025-06-20",
      time: "10:00 AM",
      location: "Champagne Hills Resort, Epe",
      description:
        "A restorative weekend of teaching, prayer, and fellowship for women pursuing purpose and healing.",
      image:
        "https://images.unsplash.com/photo-1544027993-37dbfe43562a?q=80&w=1200&auto=format&fit=crop",
      featured: false,
    },
    {
      id: uid(),
      title: "December Cross-Over Service",
      date: "2025-12-31",
      time: "10:00 PM",
      location: "Ministry Headquarters, Ikeja",
      description:
        "A night of thanksgiving, prophetic declaration, and worship as we cross into a new year of grace.",
      image:
        "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?q=80&w=1200&auto=format&fit=crop",
      featured: false,
    },
  ],

  sermons: [
    {
      id: uid(),
      title: "The Oil That Never Runs Dry",
      speaker: "Rev. Felix Agidipo",
      date: "2025-01-12",
      series: "Anointing Series",
      audioUrl: "https://example.org/sermons/oil-never-runs-dry.mp3",
      videoUrl: "https://youtube.com/watch?v=example1",
      summary:
        "A message on the widow's oil in 2 Kings 4 — how obedience and empty vessels position us for unending supply.",
      image:
        "https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Carriers, Not Containers",
      speaker: "Rev. Felix Agidipo",
      date: "2025-01-26",
      series: "Anointing Series",
      audioUrl: "https://example.org/sermons/carriers-not-containers.mp3",
      videoUrl: "https://youtube.com/watch?v=example2",
      summary:
        "The anointing is not given to be stored but to be poured out. A charge to every believer to carry the presence beyond the walls of the church.",
      image:
        "https://images.unsplash.com/photo-1516450137517-162bfbeb8dba?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Faith That Moves the Impossible",
      speaker: "Rev. Felix Agidipo",
      date: "2024-12-08",
      series: "Foundations of Faith",
      audioUrl: "https://example.org/sermons/faith-moves-impossible.mp3",
      videoUrl: "https://youtube.com/watch?v=example3",
      summary:
        "Exploring Mark 11:22-24 — practical steps to cultivate mountain-moving faith in seasons of delay.",
      image:
        "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "The Fragrance of Consecration",
      speaker: "Rev. Felix Agidipo",
      date: "2024-11-17",
      series: "Foundations of Faith",
      audioUrl: "https://example.org/sermons/fragrance-of-consecration.mp3",
      videoUrl: "https://youtube.com/watch?v=example4",
      summary:
        "Like the alabaster box broken at the Master's feet, true worship costs something — and releases a fragrance that fills the house.",
      image:
        "https://images.unsplash.com/photo-1445445290350-18a3b86e0b5a?q=80&w=1200&auto=format&fit=crop",
    },
  ],

  gallery: [
    {
      id: uid(),
      caption: "Altar call at the National Anointing Convention, 2024",
      category: "Convention",
      image:
        "https://images.unsplash.com/photo-1438032005730-c779502df39b?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      caption: "Baptism service at Ministry Headquarters",
      category: "Baptism",
      image:
        "https://images.unsplash.com/photo-1471371744196-8a54ad0fdbb4?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      caption: "Compassion Outreach distribution day",
      category: "Outreach",
      image:
        "https://images.unsplash.com/photo-1593113646773-028c64a8f1b8?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      caption: "Worship team leading a night of ministration",
      category: "Worship",
      image:
        "https://images.unsplash.com/photo-1508973379184-7517410fb0bc?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      caption: "Youth Fire Fellowship anniversary gathering",
      category: "Youth",
      image:
        "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      caption: "Rev. Felix Agidipo ministering at the Healing Crusade",
      category: "Crusade",
      image:
        "https://images.unsplash.com/photo-1508615039623-a25605d2b022?q=80&w=1200&auto=format&fit=crop",
    },
  ],

  news: [
    {
      id: uid(),
      title: "Ministry Announces New Media Center Launch",
      date: "2025-01-05",
      excerpt:
        "Rev. Felix Agidipo Ministries unveils a fully-equipped media center to expand its broadcast reach across Africa and the diaspora.",
      body:
        "In a step to widen the reach of the Gospel, the Ministry has commissioned a new media center at its Ikeja headquarters. The facility will support live-streaming of services, podcast production, and multi-language sermon translation, ensuring the message of the anointing reaches homes far beyond the physical auditorium.",
      image:
        "https://images.unsplash.com/photo-1478737270239-2f02b77fc618?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Over 3,000 Register for Upcoming Healing Crusade",
      date: "2024-12-20",
      excerpt:
        "Anticipation builds as registration figures surge ahead of the City-Wide Healing Crusade slated for May.",
      body:
        "Volunteers report an overwhelming response from churches and community groups across Lagos as pre-registration opens for the City-Wide Healing Crusade. Testimonies from previous crusades continue to circulate, drawing first-time attendees eager to witness the power of God firsthand.",
      image:
        "https://images.unsplash.com/photo-1519834785169-98be25ec3f84?q=80&w=1200&auto=format&fit=crop",
    },
    {
      id: uid(),
      title: "Compassion Outreach Reaches 500 Families in December",
      date: "2024-12-01",
      excerpt:
        "The Ministry's monthly outreach arm closes the year with its largest distribution effort yet.",
      body:
        "The Compassion Outreach team distributed food packages, clothing, and school supplies to over 500 families across three Lagos communities this December, capping a year of consistent, faith-driven service to the underserved.",
      image:
        "https://images.unsplash.com/photo-1593113630400-ea4288922497?q=80&w=1200&auto=format&fit=crop",
    },
  ],
};

// ---------------------------------------------------------------------------
// SEEDING
// ---------------------------------------------------------------------------

function seedIfEmpty() {
  const alreadySeeded = localStorage.getItem(KEYS.seeded);
  if (alreadySeeded) return;

  write(KEYS.activities, SEED.activities);
  write(KEYS.events, SEED.events);
  write(KEYS.sermons, SEED.sermons);
  write(KEYS.gallery, SEED.gallery);
  write(KEYS.news, SEED.news);
  write(KEYS.settings, SEED.settings);
  localStorage.setItem(KEYS.seeded, "true");
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// GENERIC CRUD FACTORY (for array-based collections)
// ---------------------------------------------------------------------------

function makeCollection(name, key) {
  return {
    getAll() {
      return read(key, []);
    },
    getById(id) {
      return read(key, []).find((item) => item.id === id) || null;
    },
    add(item) {
      const list = read(key, []);
      const record = { id: uid(), ...item };
      const next = [record, ...list];
      write(key, next);
      emitChange(name);
      return record;
    },
    update(id, updates) {
      const list = read(key, []);
      let updated = null;
      const next = list.map((item) => {
        if (item.id === id) {
          updated = { ...item, ...updates, id };
          return updated;
        }
        return item;
      });
      write(key, next);
      emitChange(name);
      return updated;
    },
    remove(id) {
      const list = read(key, []);
      const next = list.filter((item) => item.id !== id);
      write(key, next);
      emitChange(name);
    },
    reset() {
      write(key, SEED[name]);
      emitChange(name);
    },
  };
}

export const activities = makeCollection("activities", KEYS.activities);
export const events = makeCollection("events", KEYS.events);
export const sermons = makeCollection("sermons", KEYS.sermons);
export const gallery = makeCollection("gallery", KEYS.gallery);
export const news = makeCollection("news", KEYS.news);

// ---------------------------------------------------------------------------
// SETTINGS (singleton object, not an array)
// ---------------------------------------------------------------------------

export const settings = {
  get() {
    return read(KEYS.settings, SEED.settings);
  },
  update(updates) {
    const current = read(KEYS.settings, SEED.settings);
    const next = { ...current, ...updates };
    write(KEYS.settings, next);
    emitChange("settings");
    return next;
  },
  reset() {
    write(KEYS.settings, SEED.settings);
    emitChange("settings");
    return SEED.settings;
  },
};

// ---------------------------------------------------------------------------
// GLOBAL RESET (used by Admin "restore defaults" action)
// ---------------------------------------------------------------------------

export function resetAllData() {
  activities.reset();
  events.reset();
  sermons.reset();
  gallery.reset();
  news.reset();
  settings.reset();
}

export function clearAllData() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  seedIfEmpty();
  ["activities", "events", "sermons", "gallery", "news", "settings"].forEach(
    emitChange
  );
}

export default {
  activities,
  events,
  sermons,
  gallery,
  news,
  settings,
  subscribe,
  resetAllData,
  clearAllData,
};