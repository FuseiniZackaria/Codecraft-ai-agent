// Pulls the base-36 post ID out of a reddit.com/.../comments/{id}/... URL
// and formats it as a "fullname" (t3_ prefix = post, t1_ = comment).
function extractThingId(url) {
  const match = (url || '').match(/comments\/([a-z0-9]+)/i);
  return match ? `t3_${match[1]}` : null;
}

module.exports = { extractThingId };
