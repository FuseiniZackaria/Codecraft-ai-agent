import { useStore } from '../../store/useStore';

/** Live counts shown next to nav items and tabs, keyed by `badgeKey` in navConfig. */
export function useNavBadges() {
  const tasks = useStore((s) => s.tasks);
  return { unreadTasks: tasks.filter((t) => !t.read).length };
}
