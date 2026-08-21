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
    youtubeKey: process.env.YOUTUBE_API_KEY || null,
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
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || null,
    authToken: process.env.TWILIO_AUTH_TOKEN || null,
    // Twilio's shared Sandbox number - works immediately with zero business
    // verification, as long as the recipient has texted "join <keyword>" to
    // it first. Override once you have your own approved Twilio sender.
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
  },
  business: loadBusinessContext(),
  browserExtension: {
    // Shared secret the extension must send on every request. Deliberately
    // has no default - an unset token means the endpoint stays closed, not
    // open, so a malicious page's own JS can't just POST fake visits in.
    token: process.env.BROWSER_EXTENSION_TOKEN || null,
  },
  scheduler: {
    // 0/unset = disabled (default). Set to auto-run inbox triage on a timer
    // instead of only when manually asked in chat.
    gmailTriageIntervalMinutes: Number(process.env.GMAIL_TRIAGE_INTERVAL_MINUTES) || 0,
  },
};

