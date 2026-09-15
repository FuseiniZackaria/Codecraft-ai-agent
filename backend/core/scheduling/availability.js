/**
 * availability.js - deterministic free-slot calculation.
 *
 * Pure function: given a list of already-busy periods (from the real
 * calendar) plus working-hours rules, computes which slots are genuinely
 * free. No network or LLM calls - so it's cheap, instant, and fully
 * unit-testable without mocking Google Calendar at all. The only place
 * that touches the real calendar is the plugin that fetches busyPeriods in
 * the first place; everything here is just math over plain data.
 */

const DEFAULT_RULES = {
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri (0 = Sunday, per JS Date convention)
  startHour: 9,
  endHour: 17,
  slotMinutes: 30,
  daysAhead: 7,
};

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * @param {Array<{start: string, end: string}>} busyPeriods - ISO datetime strings, real calendar events
 * @param {object} [rules] - override DEFAULT_RULES
 * @param {Date} [now] - injectable for tests
 * @returns {Array<{start: string, end: string}>} available slots, ISO datetime strings, in chronological order
 */
function computeFreeSlots(busyPeriods = [], rules = {}, now = new Date()) {
  const r = { ...DEFAULT_RULES, ...rules };
  const busy = busyPeriods
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .filter((b) => !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()));

  const slots = [];

  for (let dayOffset = 0; dayOffset < r.daysAhead; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    if (!r.workingDays.includes(day.getDay())) continue;

    const dayStart = new Date(day);
    dayStart.setHours(r.startHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(r.endHour, 0, 0, 0);

    for (let slotStart = new Date(dayStart); slotStart < dayEnd; slotStart = new Date(slotStart.getTime() + r.slotMinutes * 60000)) {
      const slotEnd = new Date(slotStart.getTime() + r.slotMinutes * 60000);
      if (slotEnd > dayEnd) break;

      // Never propose a slot that's already in the past (matters for today's remaining slots).
      if (slotStart < now) continue;

      const conflict = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
      if (!conflict) {
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
      }
    }
  }

  return slots;
}

/**
 * @param {string} proposedStart - ISO datetime the caller wants to book
 * @param {string} proposedEnd - ISO datetime
 * @param {Array<{start: string, end: string}>} busyPeriods
 * @returns {boolean} true if the slot is free (no overlap with any busy period)
 */
function isSlotFree(proposedStart, proposedEnd, busyPeriods = []) {
  const start = new Date(proposedStart);
  const end = new Date(proposedEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;

  return !busyPeriods.some((b) => {
    const bStart = new Date(b.start);
    const bEnd = new Date(b.end);
    if (isNaN(bStart.getTime()) || isNaN(bEnd.getTime())) return false;
    return overlaps(start, end, bStart, bEnd);
  });
}

module.exports = { computeFreeSlots, isSlotFree, DEFAULT_RULES };