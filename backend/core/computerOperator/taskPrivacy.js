/**
 * A request to change files on someone's OWN computer (Computer Helper) is
 * theirs alone: nobody else - not even the owner - sees it in task lists,
 * approves, edits or deletes it (own-PC-only rule). Those tasks carry
 * payload.forUserId; lite task rows carry it as computer_for_user.
 * Local-mode tasks (the backend on the owner's PC) have neither and are unchanged.
 */
const ctx = require('../usage/context');

function forUserOf(row) {
  return row?.payload?.forUserId || row?.computer_for_user || null;
}

function isComputerTask(row) {
  return String(row?.toolCall?.tool || '').startsWith('computer.') || row?.agent === 'computer-operator';
}

/** True when `row` is a person-pinned computer task that is NOT `viewerId`'s. */
function isOthersComputerTask(row, viewerId) {
  const forUserId = forUserOf(row);
  return !!forUserId && isComputerTask(row) && forUserId !== viewerId;
}

/** Filter for whoever is asking right now; work with no person sees none of them. */
function hideOthersComputerTasks(rows) {
  const viewerId = ctx.current().userId || null;
  return (rows || []).filter((r) => !isOthersComputerTask(r, viewerId));
}

module.exports = { isOthersComputerTask, hideOthersComputerTasks };
