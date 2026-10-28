import {
  TrendingUp, Megaphone, Headphones, Compass, Code2, MoreHorizontal,
} from 'lucide-react';

const DEPARTMENTS = [
  {
    key: 'sales',
    label: 'Sales Manager',
    icon: TrendingUp,
    iconName: 'TrendingUp',
    description: 'Find leads, send outreach, track replies, and schedule calls.',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'outreach', label: 'Outreach' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'e.g. "Find 10 restaurants in Accra that need a website and draft outreach"',
    quickActions: [
      'Find 10 leads that need websites in Accra',
      'Draft follow-up emails for open leads',
      'Check inbox for replies to outreach',
    ],
    fields: [
      { key: 'selling', label: "What you're selling", placeholder: 'e.g. website development' },
      { key: 'target', label: 'Target customer', placeholder: 'e.g. restaurants, hotels' },
      { key: 'location', label: 'Location', placeholder: 'e.g. Accra, Ghana' },
      { key: 'count', label: 'How many leads', placeholder: 'e.g. 10' },
      {
        key: 'platforms', label: 'Search platforms', type: 'checkboxes', span: 2,
        options: [
          { value: 'google_maps', label: 'Google Maps' },
          { value: 'instagram', label: 'Instagram' },
          { value: 'facebook', label: 'Facebook' },
          { value: 'tiktok', label: 'TikTok' },
          { value: 'x', label: 'X (Twitter)' },
          { value: 'linkedin', label: 'LinkedIn' },
        ],
      },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing & Content',
    icon: Megaphone,
    iconName: 'Megaphone',
    description: 'Draft campaigns, social posts, and full content packages.',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'e.g. "Create a social media campaign for our new product launch"',
    quickActions: [
      'Create a social media campaign',
      'Write a marketing email announcement',
      'Build a full content package for a product',
    ],
    fields: [
      { key: 'platform', label: 'Platform', placeholder: 'e.g. Instagram, Twitter, email' },
      { key: 'tone', label: 'Tone', placeholder: 'e.g. professional, playful, urgent' },
      { key: 'campaignGoal', label: 'Goal of the campaign', placeholder: 'e.g. drive sign-ups, brand awareness' },
    ],
  },
  {
    key: 'support',
    label: 'Customer Support & Communication',
    icon: Headphones,
    iconName: 'Headphones',
    description: 'Reply to customers, triage the inbox, and message contacts.',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'e.g. "Triage my inbox and draft replies to urgent messages"',
    quickActions: [
      'Triage my inbox and draft replies',
      'Draft a reply to a customer complaint',
      'Send a WhatsApp message',
    ],
  },
  {
    key: 'strategy',
    label: 'Strategy & Research',
    icon: Compass,
    iconName: 'Compass',
    description: 'Research topics, monitor intelligence, and advise on strategy.',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'research', label: 'Research' },
      { key: 'intelligence', label: 'Intelligence' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'e.g. "Research our top 5 competitors in AI automation"',
    quickActions: [
      'Research competitors in our space',
      'Give strategic advice on priorities',
      'Create a daily news briefing',
    ],
  },
  {
    key: 'development',
    label: 'Development & Operations',
    icon: Code2,
    iconName: 'Code2',
    description: 'Build apps, browse the web, and manage files on this machine.',
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'e.g. "Build a landing page for a bakery with a contact form"',
    quickActions: [
      'Build a landing page',
      'Take a screenshot of my website',
      'Find files on my computer',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    icon: MoreHorizontal,
    iconName: 'MoreHorizontal',
    description: "Agents that don't belong to a specific department.",
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'approvals', label: 'Approvals' },
    ],
    placeholder: 'What should this team do?',
    quickActions: [],
  },
];

export function getDepartment(key) {
  return DEPARTMENTS.find((d) => d.key === key);
}

export default DEPARTMENTS;
