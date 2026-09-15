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
  telegram: {
    // Get this from @BotFather on Telegram ("/newbot") - no OAuth, no
    // business verification, works in minutes.
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    // Optional but recommended: an arbitrary string you choose, set via
    // setWebhook's secret_token param (see .env.example for the exact
    // command). Telegram echoes it back in the X-Telegram-Bot-Api-Secret-Token
    // header on every webhook call, so we can verify a request genuinely
    // came from Telegram - similar spirit to Meta's WHATSAPP_WEBHOOK_VERIFY_TOKEN.
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
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
  outreach: {
    // manual | semi_automatic | automatic - default is the most conservative.
    mode: process.env.OUTREACH_MODE || 'manual',
    // Automatic mode additionally requires this explicit opt-in, even if
    // OUTREACH_MODE=automatic is set - two separate switches on purpose, so
    // a single misconfigured env var can't silently turn on auto-sending.
    automaticEnabled: process.env.OUTREACH_AUTOMATIC_ENABLED === 'true',
    // Minimum opportunity score (0-100) required before outreach can be
    // drafted at all, regardless of mode.
    verificationThreshold: Number(process.env.OUTREACH_VERIFICATION_THRESHOLD) || 75,
    // Whether LIKELY_CURRENT-tier jobs (not just fully VERIFIED) may proceed
    // to outreach. Off by default per spec: "Only VERIFIED and, if I
    // explicitly allow it, LIKELY_CURRENT jobs may proceed."
    allowLikelyCurrent: process.env.OUTREACH_ALLOW_LIKELY_CURRENT === 'true',
    // Hard cap on total outreach sends per day, checked before Automatic
    // mode is allowed to auto-send anything.
    dailySendLimit: Number(process.env.OUTREACH_DAILY_SEND_LIMIT) || 10,
    // Follow-up sequence, in days-since-sent. Default matches spec section
    // 13's worked example (Day 4 / Day 10 / Day 21). Comma-separated env
    // override, e.g. "3,7,14".
    followUpDays: process.env.OUTREACH_FOLLOWUP_DAYS
      ? process.env.OUTREACH_FOLLOWUP_DAYS.split(',').map((n) => Number(n.trim())).filter((n) => !isNaN(n))
      : [4, 10, 21],
    // Caps how many of the followUpDays entries actually get used - lets a
    // user keep the day spacing above but only send e.g. the first 2,
    // matching section 22's separate "Maximum follow-ups" control.
    maxFollowUps: Number(process.env.OUTREACH_MAX_FOLLOWUPS) || 3,
  },
  scheduling: {
    // Working days as JS Date.getDay() numbers (0=Sun..6=Sat). Default Mon-Fri.
    workingDays: process.env.SCHEDULING_WORKING_DAYS
      ? process.env.SCHEDULING_WORKING_DAYS.split(',').map((n) => Number(n.trim())).filter((n) => !isNaN(n))
      : [1, 2, 3, 4, 5],
    startHour: Number(process.env.SCHEDULING_START_HOUR) || 9,
    endHour: Number(process.env.SCHEDULING_END_HOUR) || 17,
    slotMinutes: Number(process.env.SCHEDULING_SLOT_MINUTES) || 30,
    daysAhead: Number(process.env.SCHEDULING_DAYS_AHEAD) || 7,
    // IANA timezone name (e.g. "America/New_York"). Passed through to the
    // calendar event; slot math itself runs in server-local time.
    timezone: process.env.SCHEDULING_TIMEZONE || null,
    // Minutes before the event to remind - defaults match spec section 12:
    // 24h / 1h / 15m before.
    reminderMinutesBefore: process.env.SCHEDULING_REMINDER_MINUTES
      ? process.env.SCHEDULING_REMINDER_MINUTES.split(',').map((n) => Number(n.trim())).filter((n) => !isNaN(n))
      : [1440, 60, 15],
    // How many free slots to propose in a single reply.
    slotsToPropose: Number(process.env.SCHEDULING_SLOTS_TO_PROPOSE) || 3,
  },
  automation: {
    // 0/unset = disabled (default, same pattern as gmailTriageIntervalMinutes).
    // How often (in minutes) to automatically check the inbox for replies
    // to sent job outreach.
    responseCheckIntervalMinutes: Number(process.env.OUTREACH_RESPONSE_CHECK_INTERVAL_MINUTES) || 0,
    // How often (in minutes) to automatically check for and queue due
    // follow-ups. 1440 = once a day is a sensible value if you enable this.
    followUpCheckIntervalMinutes: Number(process.env.OUTREACH_FOLLOWUP_CHECK_INTERVAL_MINUTES) || 0,
  },
  autoReply: {
    // Off by default for both channels, same as everywhere else - an
    // explicit opt-in per channel, not a single global switch, so turning
    // one channel on never silently affects the other.
    telegram: { enabled: process.env.TELEGRAM_AUTO_REPLY_ENABLED === 'true' },
    whatsapp: { enabled: process.env.WHATSAPP_AUTO_REPLY_ENABLED === 'true' },
    // A reply longer than this never auto-sends, regardless of how "safe"
    // the classifier thinks it is - longer replies are more likely to
    // contain commitments or nuance that deserve a human's eyes first.
    maxDraftLength: Number(process.env.AUTO_REPLY_MAX_LENGTH) || 300,
    // Hard cap on total auto-sends per day, PER CHANNEL - checked before
    // anything is allowed to auto-send, same spirit as the outreach
    // pipeline's dailySendLimit.
    dailyLimitPerChannel: Number(process.env.AUTO_REPLY_DAILY_LIMIT) || 20,
  },
  notifications: {
    // Your OWN Telegram chat id and/or WhatsApp number - where you get
    // pinged the moment a customer message needs your approval (i.e. it
    // did NOT auto-send). Either or both can be set independently. Leave
    // unset to skip that channel's alert entirely - no error, just silence.
    ownerTelegramChatId: process.env.OWNER_TELEGRAM_CHAT_ID || null,
    ownerWhatsappNumber: process.env.OWNER_WHATSAPP_NUMBER || null,
  },
  computerOperator: {
    // DEFAULT-DENY: empty unless explicitly set. Comma-separated list of
    // absolute folder paths this agent is allowed to search/read/open -
    // e.g. "C:\Users\Dell\Documents,C:\Users\Dell\Desktop". Nothing outside
    // these folders is ever touched, no matter what a user or the AI asks
    // for. Adding "C:\" itself is possible but strongly discouraged - scope
    // this to only the folders you actually want an AI agent reaching.
    allowedRoots: process.env.COMPUTER_ALLOWED_ROOTS
      ? process.env.COMPUTER_ALLOWED_ROOTS.split(',').map((p) => p.trim()).filter(Boolean)
      : [],
    // DEFAULT-DENY, same spirit as allowedRoots but a SEPARATE allowlist -
    // being inside an allowed root never implies launch permission.
    // Format: "Name1|C:\path\to\app1.exe,Name2|C:\path\to\app2.exe"
    // e.g. "Telegram Desktop|C:\Users\Dell\AppData\Roaming\Telegram Desktop\Telegram.exe,Notepad|C:\Windows\notepad.exe"
    allowedApps: process.env.COMPUTER_ALLOWED_APPS
      ? Object.fromEntries(
          process.env.COMPUTER_ALLOWED_APPS.split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => entry.split('|').map((s) => s.trim()))
            .filter(([name, exePath]) => name && exePath)
        )
      : {},
    // Hard cap on how many results a single search/listing returns - keeps
    // a huge folder from generating an unusably large response.
    maxSearchResults: Number(process.env.COMPUTER_MAX_SEARCH_RESULTS) || 200,
    // Hard cap on how many files/folders can be moved to the Recycle Bin
    // in a single approval - a single "yes" click must never be able to
    // wipe out an unbounded number of items, even from a legitimate scan.
    maxDeleteBatch: Number(process.env.COMPUTER_MAX_DELETE_BATCH) || 20,
  },
  browserAutomation: {
    // A dedicated Chromium profile directory - isolated from any real
    // browser on this machine, so it starts with zero saved logins,
    // cookies, or autofill data. Playwright creates this folder itself on
    // first launch if it doesn't exist.
    userDataDir: process.env.BROWSER_PROFILE_DIR || path.join(__dirname, '..', 'data', 'browser-profile'),
    // true = no visible window (default, safer/faster for unattended use).
    // Set to 'false' in .env if you want to watch it work in real time.
    headless: process.env.BROWSER_HEADLESS !== 'false',
  },
};