import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowRight, ExternalLink } from 'lucide-react';
import { api } from '../services/api';

function StatColumn({ label, value, urgent }) {
  return (
    <div className="flex-1 min-w-[110px] px-5 first:pl-0 border-l border-[var(--color-border)] first:border-l-0">
      <div className="flex items-baseline gap-2">
        <span className="font-[var(--font-display)] text-4xl font-semibold text-[var(--color-text)]">{value}</span>
        {urgent && value > 0 && <span className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />}
      </div>
      <div className="text-sm text-[var(--color-text-muted)] mt-1">{label}</div>
    </div>
  );
}

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight };
const DIRECTION_COLOR = { up: 'text-[var(--color-accent)]', down: 'text-[var(--color-text-muted)]', flat: 'text-[var(--color-text-muted)]' };

function TopicRow({ rank, topic, direction, context }) {
  const Icon = DIRECTION_ICON[direction];
  return (
    <div className="flex items-center gap-4 py-3 border-b border-[var(--color-border)] last:border-0">
      <span className="font-[var(--font-mono)] text-sm text-[var(--color-text-muted)] w-5">{rank}</span>
      <span className="flex-1 font-medium">{topic}</span>
      <span className="text-xs text-[var(--color-text-muted)]">{context}</span>
      <Icon size={16} className={DIRECTION_COLOR[direction]} />
    </div>
  );
}

function DailyBarChart({ dailyMentions }) {
  const days = Object.keys(dailyMentions).sort();
  const max = Math.max(1, ...Object.values(dailyMentions));
  if (days.length === 0) {
    return <div className="text-sm text-[var(--color-text-muted)]">Not enough data yet to show a trend.</div>;
  }
  return (
    <div className="flex items-end gap-3 h-32">
      {days.map((day) => {
        const value = dailyMentions[day];
        const heightPct = Math.max(4, (value / max) * 100);
        const label = new Date(day).toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <div key={day} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="text-xs font-medium text-[var(--color-text)]">{value}</div>
            <div className="w-full rounded-sm bg-[var(--color-accent)]" style={{ height: `${heightPct}%` }} title={`${day}: ${value} mentions`} />
            <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function BriefingDashboard() {
  const [workflows, setWorkflows] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState('');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .listWorkflows()
      .then((list) => {
        setWorkflows(list);
        if (list.length > 0) setSelectedGoal(list[0].goal);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedGoal) return;
    setLoading(true);
    setError(null);
    api
      .getBriefingDashboard(selectedGoal)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedGoal]);

  const gaining = stats?.trendingTopics.filter((t) => t.direction === 'up') || [];
  const others = stats?.trendingTopics.filter((t) => t.direction !== 'up') || [];

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-[var(--font-display)] text-2xl font-semibold text-[var(--color-text)]">Intelligence</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            What's collected, at a glance — no need to read every report by hand.
          </p>
        </div>
        {workflows.length > 0 && (
          <select
            value={selectedGoal}
            onChange={(e) => setSelectedGoal(e.target.value)}
            className="px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm shrink-0"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.goal}>{w.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)] mb-6">
          {error}
        </div>
      )}
      {loading && <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>}

      {stats && !loading && (
        <>
          <div className="flex mb-10">
            <StatColumn label="Breaking" value={stats.breakingNewsCount} urgent />
            <StatColumn label="Trending issues" value={stats.trendingIssuesCount} />
            <StatColumn label="Articles collected" value={stats.articlesCollectedCount} />
            <StatColumn label="Gaining attention" value={stats.issuesGainingAttentionCount} />
          </div>

          <h2 className="font-medium mb-1">Gaining attention</h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-2">Topics with rising coverage this week.</p>
          {gaining.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] mb-8">Nothing is trending up right now.</p>
          ) : (
            <div className="mb-8">
              {gaining.map((t, i) => (
                <TopicRow
                  key={t.topic}
                  rank={i + 1}
                  topic={t.topic}
                  direction={t.direction}
                  context={t.lastWeekCount === 0 ? 'new this week' : `${t.thisWeekCount} articles, up from ${t.lastWeekCount}`}
                />
              ))}
            </div>
          )}

          {others.length > 0 && (
            <>
              <h2 className="font-medium mb-2 text-[var(--color-text-muted)]">Also tracked</h2>
              <div className="mb-8">
                {others.map((t, i) => (
                  <TopicRow
                    key={t.topic}
                    rank={gaining.length + i + 1}
                    topic={t.topic}
                    direction={t.direction}
                    context={`${t.thisWeekCount} articles`}
                  />
                ))}
              </div>
            </>
          )}

          <h2 className="font-medium mb-4">Latest news</h2>
          {stats.latestNews.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] mb-8">Nothing collected yet.</p>
          ) : (
            <div className="mb-10">
              {stats.latestNews.map((n) => (
                <div key={n.url} className="py-4 border-b border-[var(--color-border)] last:border-0">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-xs text-[var(--color-text-muted)] whitespace-nowrap shrink-0">
                      {new Date(n.collectedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mb-1.5">
                    {n.sourceDomain || 'unknown source'}{n.topic ? ` · ${n.topic}` : ''}
                  </div>
                  {n.summary && <p className="text-sm text-[var(--color-text-muted)] mb-1.5 line-clamp-2">{n.summary}</p>}
                  <a href={n.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)] font-medium">
                    Read original <ExternalLink size={12} />
                  </a>
                </div>
              ))}
            </div>
          )}

          <h2 className="font-medium mb-1">Trend history</h2>
          <p className="text-sm text-[var(--color-text-muted)] mb-4">Articles collected per day, last 7 days.</p>
          <DailyBarChart dailyMentions={stats.dailyMentions} />
        </>
      )}
    </div>
  );
}