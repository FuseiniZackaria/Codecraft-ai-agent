import { useMemo, useState } from "react";
import { useCollection } from "../data/store";
import SectionDivider from "../components/SectionDivider";

const CATEGORIES = [
  "All",
  "Discipleship",
  "Outreach & Evangelism",
  "Worship & Music",
  "Children & Youth",
  "Prayer & Intercession",
  "Fellowship & Family",
];

const WEEKDAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function weekdayIndex(schedule = "") {
  const found = WEEKDAY_ORDER.findIndex((d) =>
    schedule.toLowerCase().includes(d.toLowerCase())
  );
  return found === -1 ? 99 : found;
}

const SORTS = {
  day: { label: "Day of the Week", fn: (a, b) => weekdayIndex(a.schedule) - weekdayIndex(b.schedule) },
  az: { label: "Alphabetical (A–Z)", fn: (a, b) => a.title.localeCompare(b.title) },
  newest: { label: "Newest Added", fn: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) },
};

export default function Activities() {
  const activities = useCollection("activities");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("day");

  const filtered = useMemo(() => {
    let list = Array.isArray(activities) ? [...activities] : [];
    if (category !== "All") {
      list = list.filter((a) => a.category === category);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.title?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.location?.toLowerCase().includes(q)
      );
    }
    list.sort(SORTS[sortKey].fn);
    return list;
  }, [activities, category, query, sortKey]);

  return (
    <div className="page page-activities">
      <header className="page-hero">
        <p className="eyebrow">The Rhythm of the House</p>
        <h1>Ministry Activities</h1>
        <p className="hero-lede">
          Beyond the pulpit, the life of this ministry beats in its weekly
          gatherings — where discipleship deepens, prayer is sharpened, and
          fellowship is forged. Every activity below is shepherded by Rev.
          Felix Agidipo Ministries and open to all who hunger for more.
        </p>
      </header>

      <SectionDivider />

      <section className="filter-bar" aria-label="Filter and sort activities">
        <div className="filter-chips" role="group" aria-label="Filter by category">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`chip ${category === cat ? "chip-active" : ""}`}
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="filter-controls">
          <label className="field-label" htmlFor="activity-search">
            Search
          </label>
          <input
            id="activity-search"
            type="search"
            placeholder="Search activities, e.g. 'youth' or 'prayer'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <label className="field-label" htmlFor="activity-sort">
            Sort by
          </label>
          <select
            id="activity-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="activities-grid" aria-live="polite">
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>
              No activities match your search just yet. Try a different
              category, or check back soon — the calendar is tended
              regularly.
            </p>
          </div>
        )}

        {filtered.map((activity, i) => (
          <article
            key={activity.id}
            className={`activity-card ${i % 5 === 0 ? "activity-card-feature" : ""}`}
          >
            {activity.image && (
              <div
                className="activity-media"
                style={{ backgroundImage: `url(${activity.image})` }}
                role="img"
                aria-label={activity.title}
              />
            )}
            <div className="activity-body">
              <span className="tag">{activity.category}</span>
              <h3>{activity.title}</h3>
              <p className="activity-schedule">
                <strong>{activity.schedule}</strong>
                {activity.location ? ` · ${activity.location}` : ""}
              </p>
              <p className="activity-desc">{activity.description}</p>
              {activity.leader && (
                <p className="activity-leader">Led by {activity.leader}</p>
              )}
            </div>
          </article>
        ))}
      </section>

      <SectionDivider variant="reverse" />

      <section className="cta-band">
        <h2>Don't see a place to plug in?</h2>
        <p>
          New activities are added as the ministry grows. Reach out and we'll
          help you find your fit within the house.
        </p>
        <a className="btn-gold" href="/contact">
          Get in Touch
        </a>
      </section>
    </div>
  );
}