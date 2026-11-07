// Outreach fixes:
//  - WhatsApp both ways: a first message you approved or typed may go to someone
//    who never messaged you; automatic ones (lead follow-ups) still can't; STOP always wins.
//  - Email: a broken address ("shopname.com") never reaches Gmail.
//  - Leads: a business whose website is only in its Instagram bio is found to HAVE a website.
// Nothing real is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_OUTREACH_REQUIRE_CONSENT;

const assert = require('assert');
const store = require('../core/whatsapp/store');
const outbox = require('../core/whatsapp/outbox');
const composio = require('../core/composio');
const finder = require('../core/leads/websiteFinder');

const SESSION = 'default';
const WS = 'aaaaaaaa-0000-0000-0000-0000000000e1';

(async () => {
  // 1. WhatsApp: first contact only when you approved / typed it; STOP always blocks.
  {
    const base = { sessionName: SESSION, userId: 'u1', workspaceId: WS };
    const auto = await outbox.enqueue({ ...base, recipients: [{ number: '233244842464', text: 'Hello from CodeCraft' }] });
    assert.strictEqual(auto.queued, 0, 'automatic outreach still needs them to have messaged first');
    assert(/messaged your WhatsApp first/.test(auto.rejected[0].reason));

    const approved = await outbox.enqueue({ ...base, recipients: [{ number: '233244842464', text: 'Hello from CodeCraft' }], allowFirstContact: true });
    assert.strictEqual(approved.queued, 1, 'a message you approved can be the first one');

    await store.addOptOut(SESSION, '233200000077');
    const stopped = await outbox.enqueue({ ...base, recipients: [{ number: '233200000077', text: 'Hi' }], allowFirstContact: true });
    assert.strictEqual(stopped.queued, 0);
    assert.strictEqual(stopped.rejected[0].reason, 'replied STOP');
    console.log('✓ WhatsApp: approved/typed first messages go to new people; automatic ones do not; STOP always wins');
  }

  // 2. The approved Sales task path passes "you approved it".
  {
    const sendMessage = require('../plugins/whatsapp/actions/sendMessage');
    const original = outbox.enqueue;
    let seen = null;
    outbox.enqueue = async (args) => { seen = args; return { queued: 1, rejected: [] }; };
    store.listWorkingSessions = async () => [{ session_name: SESSION, user_id: 'u1', workspace_id: WS }];
    await sendMessage.run({ to: '233244842464', body: 'Hello', outreach: true }, { workspaceId: WS, approvedTaskId: 'task-1' });
    assert.strictEqual(seen.allowFirstContact, true);
    await sendMessage.run({ to: '233244842464', body: 'Hello', outreach: true }, { workspaceId: WS });
    assert.strictEqual(seen.allowFirstContact, false, 'no approval = no first contact');
    outbox.enqueue = original;
    console.log('✓ an approved WhatsApp task may message someone new; an unapproved call may not');
  }

  // 3. Email: a broken address is refused before anything reaches Gmail.
  {
    const sendEmail = require('../plugins/gmail/actions/sendEmail');
    let called = false;
    const original = composio.execute;
    composio.execute = async () => { called = true; return {}; };
    for (const bad of ['westportrestaurant059.com', 'info@wagcol', 'two@a.com, three@b.com', 'name @shop.com']) {
      await assert.rejects(() => sendEmail.run({ to: bad, subject: 'Hi', body: 'x' }, { approvedTaskId: 't' }), /not a valid email address - nothing was sent/, bad);
    }
    assert.strictEqual(called, false, 'Gmail was never called');
    composio.execute = original;
    console.log('✓ email: "westportrestaurant059.com" and other broken addresses are refused - nothing is sent');
  }

  // 4. Leads: the website in an Instagram bio is found.
  {
    const html = '<html><head><meta property="og:description" content="Big-B Restaurant. Order: www.bigbrestaurant.com.gh"></head>'
      + '<script>{"user":{"external_url":"https:\\/\\/l.instagram.com\\/?u=https%3A%2F%2Fbigbrestaurant.com.gh%2Fmenu&e=1","bio_links":[{"url":"https://wa.me/233244842464"}]}}</script>'
      + '<a href="https://www.facebook.com/bigb">fb</a></html>';
    const links = finder.linksInProfile(html);
    const own = links.find(finder.isOwnSiteCandidate);
    assert(/^https:\/\/bigbrestaurant\.com\.gh/.test(own), `found ${own}`);
    for (const notOwn of ['https://wa.me/233244842464', 'https://www.facebook.com/bigb', 'https://linktr.ee/bigb', 'https://www.instagram.com/bigb', 'https://maps.google.com/x']) {
      assert.strictEqual(finder.isOwnSiteCandidate(notOwn), false, notOwn);
    }
    assert.strictEqual(finder.matchesName('https://westportrestaurant.com', 'Westport Restaurant & Rest Stop'), true);
    assert.strictEqual(finder.matchesName('https://tripguide.com/westport', 'Westport Restaurant & Rest Stop'), false);

    // Search fallback: only a result that matches the business's name counts.
    const found = await finder.findWebsite({ name: 'Westport Restaurant & Rest Stop', platforms: [] }, {
      search: async () => [{ url: 'https://www.tripadvisor.com/westport' }, { url: 'https://randomblog.com/post' }, { url: 'https://westportgh.com/' }],
    });
    assert.strictEqual(found.website, 'https://westportgh.com');
    const none = await finder.findWebsite({ name: 'Westport Restaurant', platforms: [] }, { search: async () => [{ url: 'https://randomblog.com/post' }] });
    assert.strictEqual(none, null, 'an unrelated site is never taken as theirs');
    console.log("✓ leads: a website in an Instagram bio (or a name-matching search result) is found; unrelated sites aren't");
  }

  console.log('\nAll outreach-fix tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
