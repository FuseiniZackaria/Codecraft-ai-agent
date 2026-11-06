import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

/**
 * The guided tour (driver.js). Each stop can open a page first; the tour waits
 * for the highlighted element to appear before showing its tooltip. A stop
 * whose element can't be found is shown in the middle of the screen instead.
 */
const isPhone = () => !window.matchMedia('(min-width: 768px)').matches;

function stops() {
  const phone = isPhone();
  return [
    {
      route: '/home',
      element: phone ? '[data-tour="menu"]' : '[data-tour="sidebar"]',
      title: 'Your menu',
      description: phone
        ? 'Tap here to open the menu: your dashboard, chat, work (tasks, inbox, leads), departments, connections and settings.'
        : 'Everything lives here: your dashboard, chat, work (tasks, inbox, leads), departments, connections and settings.',
    },
    {
      route: '/settings',
      element: '[data-tour="tab-profile"]',
      title: 'Business Profile',
      description: 'Tell your assistant about your business - name, what you sell, how to reach you. It uses this in every answer.',
    },
    {
      route: '/settings?tab=products',
      element: '[data-tour="tab-products"]',
      title: 'Products',
      description: 'Import your products from your website or a spreadsheet, so your assistant can answer "do you have…?" and send photos.',
    },
    {
      route: '/work/leads',
      element: '[data-tour="leads-header"]',
      title: 'Leads',
      description: 'Everyone who messages you on WhatsApp shows up here, with what they need. You can add notes, change their status and export a list.',
    },
    {
      route: '/settings?tab=test',
      element: '[data-tour="tab-test"]',
      title: 'Test chat',
      description: 'Chat with your assistant the way a customer would, and correct any answer. Nothing is sent to anyone.',
    },
    {
      route: '/work',
      element: '[data-tour="tasks-header"]',
      title: 'Approvals',
      description: 'Anything sensitive - prices, payments, follow-ups - waits here for you. Approve, edit or reject it before it is sent.',
    },
    {
      route: null,
      element: '[data-tour="help"]',
      title: "That's it!",
      description: 'Take the tour again or open your setup checklist any time from this Help button.',
    },
  ];
}

function waitFor(selector, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 0) return resolve(el);
      if (Date.now() - started > timeoutMs) return resolve(null);
      return setTimeout(check, 100);
    };
    check();
  });
}

/** Start the tour. navigate: react-router's navigate. onEnd: called once when it ends (finished, skipped or closed). */
export function runTour({ navigate, onEnd }) {
  const list = stops();
  let ended = false;
  let d;

  const go = async (index) => {
    const stop = list[index];
    const here = window.location.pathname + window.location.search;
    if (stop.route && here !== stop.route) navigate(stop.route);
    await waitFor(stop.element);
    if (d.isActive()) d.moveTo(index);
    else d.drive(index);
  };

  d = driver({
    popoverClass: 'cc-tour',
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    allowClose: true,
    overlayOpacity: 0.5,
    stagePadding: 6,
    stageRadius: 8,
    smoothScroll: true,
    steps: list.map((s) => ({
      element: s.element,
      popover: { title: s.title, description: s.description },
    })),
    onNextClick: () => {
      const i = d.getActiveIndex() ?? 0;
      if (i >= list.length - 1) d.destroy();
      else go(i + 1);
    },
    onPrevClick: () => {
      const i = d.getActiveIndex() ?? 0;
      if (i > 0) go(i - 1);
    },
    // A "Skip tour" button next to Back / Next.
    onPopoverRender: (popover, { state }) => {
      if (state.activeIndex >= list.length - 1) return;
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'cc-tour-skip';
      skip.textContent = 'Skip tour';
      skip.addEventListener('click', () => d.destroy());
      popover.footer.insertBefore(skip, popover.footer.firstChild);
    },
    onDestroyed: () => {
      if (ended) return;
      ended = true;
      onEnd?.();
    },
  });

  go(0);
  return d;
}
