const ResearchAgent = require('./research/ResearchAgent');
const PersonalAssistantAgent = require('./personal-assistant/PersonalAssistantAgent');
const SalesAgent = require('./sales/SalesAgent');
const WhatsAppAgent = require('./whatsapp/WhatsAppAgent');
const SupportAgent = require('./support/SupportAgent');
const MarketingAgent = require('./marketing/MarketingAgent');
const CEOAgent = require('./ceo/CEOAgent');
const CodingAgent = require('./coding/CodingAgent');
const ContentStudioAgent = require('./content-studio/ContentStudioAgent');
const JobVerificationAgent = require('./job-verification/JobVerificationAgent');
const ResponseDetectionAgent = require('./response-detection/ResponseDetectionAgent');
const SchedulingAgent = require('./scheduling/SchedulingAgent');
const TelegramAgent = require('./telegram/TelegramAgent');
const ComputerOperatorAgent = require('./computer-operator/ComputerOperatorAgent');
const BrowserAgent = require('./browser/BrowserAgent');
const BriefingAgent = require('./briefing/BriefingAgent');

const agents = {
  research: new ResearchAgent(),
  'personal-assistant': new PersonalAssistantAgent(),
  sales: new SalesAgent(),
  whatsapp: new WhatsAppAgent(),
  support: new SupportAgent(),
  marketing: new MarketingAgent(),
  ceo: new CEOAgent(),
  coding: new CodingAgent(),
  'content-studio': new ContentStudioAgent(),
  'job-verification': new JobVerificationAgent(),
  'response-detection': new ResponseDetectionAgent(),
  scheduling: new SchedulingAgent(),
  telegram: new TelegramAgent(),
  'computer-operator': new ComputerOperatorAgent(),
  browser: new BrowserAgent(),
  briefing: new BriefingAgent(),
};

function getAgent(name) {
  const agent = agents[name];
  if (!agent) throw new Error(`Unknown agent: "${name}". Available: ${Object.keys(agents).join(', ')}`);
  return agent;
}

/**
 * Registers an agent instance at runtime - used by the Skill Installer's
 * Activator so an installed skill's agent becomes immediately usable
 * without restarting the server. `instance` should extend BaseAgent.
 */
function registerAgent(key, instance) {
  agents[key] = instance;
}

function unregisterAgent(key) {
  delete agents[key];
}

module.exports = { agents, getAgent, registerAgent, unregisterAgent };