require('dotenv').config();
(async () => {
  const res = await fetch('https://backend.composio.dev/api/v3/connected_accounts?toolkit_slug=github', {
    headers: { 'x-api-key': process.env.COMPOSIO_API_KEY },
  });
  const json = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(json.items?.map(i => ({
    id: i.id,
    toolkit: i.toolkit?.slug,
    status: i.status,
    status_reason: i.status_reason,
  })), null, 2));
})();
