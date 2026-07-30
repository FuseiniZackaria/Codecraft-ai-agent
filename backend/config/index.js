require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadBusinessContext() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'business.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

module.exports = {
  port: process.env.PORT || 4000,
  llm: {
    // Real providers read keys from env. If absent, router falls back to the
    // mock provider so the system is runnable out of the box.
    openaiKey: process.env.OPENAI_API_KEY || null,
    aiApiKey: process.env.AI_API_KEY || null,
  },
  supabase: {
    url: process.env.SUPABASE_URL || null,
    serviceKey: process.env.SUPABASE_SERVICE_KEY || null,
  },
  search: {
    tavilyKey: process.env.TAVILY_API_KEY || null,
  },
  composio: {
    apiKey: process.env.COMPOSIO_API_KEY || null,
    // Fallback user ID for tools with no specific connected account pinned below.
    userId: process.env.COMPOSIO_USER_ID || 'default',
    // Pin specific connected accounts (from the Composio dashboard) per toolkit,
    // so we never have to guess which userId a given connection belongs to.
    connectedAccountIds: {
      gmail: process.env.COMPOSIO_GMAIL_CONNECTED_ACCOUNT_ID || null,
      reddit: process.env.COMPOSIO_REDDIT_CONNECTED_ACCOUNT_ID || null,
      github: process.env.COMPOSIO_GITHUB_CONNECTED_ACCOUNT_ID || null,
    },
  },
  whatsapp: {
    // Direct Meta Graph API - bypasses Composio entirely.
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || null,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null,
  },
  business: loadBusinessContext(),
  scheduler: {
    // 0/unset = disabled (default). Set to auto-run inbox triage on a timer
    // instead of only when manually asked in chat.
    gmailTriageIntervalMinutes: Number(process.env.GMAIL_TRIAGE_INTERVAL_MINUTES) || 0,
  },
};

