/**
 * Single source of truth for agent sections (departments), agent descriptions,
 * and background job metadata. To add a new section or reassign an agent,
 * edit ONLY this file.
 *
 * Section labels deliberately match the workflow template categories where
 * they overlap (Sales, Marketing, Customer Support, Development) so the UI
 * stays consistent across both pages.
 */

const sections = [
  { key: 'sales',       label: 'Sales Manager',                       icon: 'TrendingUp'    },
  { key: 'marketing',   label: 'Marketing & Content',                  icon: 'Megaphone'     },
  { key: 'support',     label: 'Customer Support & Communication',     icon: 'Headphones'    },
  { key: 'strategy',    label: 'Strategy & Research',                  icon: 'Compass'       },
  { key: 'development', label: 'Development & Operations',             icon: 'Code2'         },
  { key: 'other',       label: 'Other',                                icon: 'MoreHorizontal'},
];

// One entry per registry key. Any key not listed here defaults to section='other'.
const agentMeta = {
  sales: {
    section: 'sales',
    description: 'Finds job leads, drafts personalised outreach emails, and manages the end-to-end application pipeline.',
  },
  'job-verification': {
    section: 'sales',
    description: 'Verifies each opportunity is real and current before any outreach is drafted or sent.',
  },
  'response-detection': {
    section: 'sales',
    description: 'Scans the inbox for replies to sent outreach and classifies each one as genuine, automated, or a scheduling request.',
  },
  'job-application': {
    section: 'sales',
    description: 'Drafts tailored job application emails and queues them for your review before anything is sent.',
  },
  marketing: {
    section: 'marketing',
    description: 'Drafts individual pieces of marketing content — emails, social posts, taglines, and ads.',
  },
  'content-studio': {
    section: 'marketing',
    description: 'Turns one idea into a full content package: research, campaign strategy, video scripts, captions, and hashtags.',
  },
  support: {
    section: 'support',
    description: 'Drafts replies to individual customer questions, complaints, and issues.',
  },
  'personal-assistant': {
    section: 'support',
    description: 'Triages the Gmail inbox and drafts replies to messages that need a response.',
  },
  whatsapp: {
    section: 'support',
    description: 'Sends WhatsApp messages to contacts on your behalf.',
  },
  telegram: {
    section: 'support',
    description: 'Sends Telegram messages via your connected bot.',
  },
  scheduling: {
    section: 'support',
    description: 'Books calendar events and proposes available time slots to contacts.',
  },
  ceo: {
    section: 'strategy',
    description: 'Gives real recommendations on business strategy, priorities, and tradeoffs.',
  },
  research: {
    section: 'strategy',
    description: 'Looks up information and answers questions through a focused web search.',
  },
  briefing: {
    section: 'strategy',
    description: 'Combines multiple sources and topics into one merged brief or roundup.',
  },
  coding: {
    section: 'development',
    description: 'Builds websites, apps, and systems by writing real files into a workspace.',
  },
  'computer-operator': {
    section: 'development',
    description: 'Searches, opens, and manages files and folders on this computer.',
  },
  browser: {
    section: 'development',
    description: 'Navigates to a specific URL, reads the page, and takes screenshots.',
  },
};

// Background jobs that run on a schedule and should be shown on the relevant agent card.
// configKey is a dot-path into the config object from backend/config/index.js.
// An intervalMinutes of 0 means the job is disabled (the default for all automation).
const backgroundJobs = [
  {
    agentKey: 'response-detection',
    name: 'Checks for replies to outreach emails',
    configKey: 'automation.responseCheckIntervalMinutes',
  },
  {
    agentKey: 'sales',
    name: 'Queues follow-up emails (Day 4, 10 and 21)',
    configKey: 'automation.followUpCheckIntervalMinutes',
  },
];

module.exports = { sections, agentMeta, backgroundJobs };
