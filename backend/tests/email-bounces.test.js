// Email bounces and dead domains:
//  - an address whose domain can't receive email is never sent to;
//  - Gmail's "Address not found" notices mark that outreach address as bounced,
//    you get one alert, and it's never emailed again;
//  - other people's bounces (addresses we never emailed) are ignored.
// Nothing real is sent; DNS and Gmail are simulated.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_EMAIL_DNS_CHECK = '1';

const assert = require('assert');
const dns = require('dns').promises;
const memory = require('../memory');
const composio = require('../core/composio');
const notifications = require('../core/notifications');
const emailCheck = require('../core/emailCheck');
const bounces = require('../core/emailBounces');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000f1';
const notFound = () => Object.assign(new Error('not found'), { code: 'ENOTFOUND' });

(async () => {
  // 1. Domain check.
  {
    dns.resolveMx = async (d) => {
      if (d === 'wagcol.com') return [{ exchange: 'mx.wagcol.com', priority: 10 }];
      if (d === 'nomail.com') return [{ exchange: '.', priority: 0 }];
      if (d === 'slow.com') throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
      throw notFound();
    };
    dns.resolve = async (d) => { if (d === 'aonly.com') return ['1.2.3.4']; throw notFound(); };
    emailCheck._clearCache();
    assert.strictEqual((await emailCheck.canReceiveEmail('info@wagcol.com')).ok, true);
    assert.strictEqual((await emailCheck.canReceiveEmail('info@aonly.com')).ok, true, 'no MX but the domain exists: allowed');
    const dead = await emailCheck.canReceiveEmail('info@westportrestaurant059.com');
    assert.strictEqual(dead.ok, false);
    assert(/doesn't exist or can't receive email/.test(dead.reason));
    assert.strictEqual((await emailCheck.canReceiveEmail('a@nomail.com')).ok, false, 'a "no email" domain');
    assert.strictEqual((await emailCheck.canReceiveEmail('a@slow.com')).ok, true, 'our DNS trouble never blocks');
    console.log("✓ a domain that doesn't exist or takes no email is caught; DNS trouble on our side never blocks");
  }

  // 2. Reading a bounce notice.
  {
    const gmailBounce = {
      subject: 'Delivery Status Notification (Failure)',
      messageText: "Address not found\nYour message wasn't delivered to info@wagcol.com because the address couldn't be found, or is unable to receive mail.\nmailer-daemon@googlemail.com",
    };
    assert.deepStrictEqual(bounces.failedAddresses(gmailBounce), ['info@wagcol.com']);
    assert.deepStrictEqual(bounces.failedAddresses({ subject: 'Your order shipped', messageText: 'from shop@store.com' }), [], 'not a bounce');
    assert.deepStrictEqual(bounces.failedAddresses({ subject: 'Undeliverable', messageText: 'X-Failed-Recipients: bob@acme.com\n550 5.1.1 user unknown' }), ['bob@acme.com']);
    console.log('✓ "Address not found" notices give the failed address; other mail is ignored');
  }

  // 3. A bounce of OUR outreach: marked, one alert, never emailed again.
  {
    const sent = await memory.createOutreachThread({ recipientEmail: 'info@wagcol.com', companyName: 'Westport Restaurant', agentKey: 'sales', campaign: 'lead_gen', outreachStatus: 'sent', workspace_id: WS });
    const alerts = [];
    notifications.notifyOwner = async (a) => { alerts.push(a); return {}; };
    composio.execute = async (slug) => {
      assert.strictEqual(slug, 'GMAIL_FETCH_EMAILS');
      return { data: { messages: [
        { subject: 'Delivery Status Notification (Failure)', messageText: "Address not found. Your message wasn't delivered to info@wagcol.com because the address couldn't be found." },
        { subject: 'Undeliverable', messageText: 'Address not found: stranger@elsewhere.com does not exist' },
      ] } };
    };
    const marked = await bounces.checkWorkspace(WS, await memory.listOutreachThreads());
    assert.deepStrictEqual(marked.map((m) => m.email), ['info@wagcol.com'], 'only addresses we emailed');
    assert.strictEqual((await memory.listOutreachThreadsByRecipient('info@wagcol.com'))[0].outreachStatus, 'bounced');
    assert.strictEqual(alerts.length, 1);
    assert(/Westport Restaurant/.test(alerts[0].text) && /won't email it again/.test(alerts[0].text));
    const again = await bounces.checkWorkspace(WS, await memory.listOutreachThreads());
    assert.strictEqual(again.length, 0, 'not marked or alerted twice');
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(await bounces.hasBounced('INFO@wagcol.com', WS), true);
    assert(sent.id);
    console.log('✓ a bounced outreach address is marked once, you get one alert, other bounces are ignored');
  }

  // 4. Sending refuses a bounced address and a dead domain - Gmail is never called.
  {
    const sendEmail = require('../plugins/gmail/actions/sendEmail');
    let called = false;
    composio.execute = async () => { called = true; return {}; };
    await assert.rejects(() => sendEmail.run({ to: 'info@wagcol.com', subject: 'Hi', body: 'x' }, { approvedTaskId: 't', workspaceId: WS }), /bounced before/);
    await assert.rejects(() => sendEmail.run({ to: 'hello@westportrestaurant059.com', subject: 'Hi', body: 'x' }, { approvedTaskId: 't', workspaceId: WS }), /can't receive email/);
    assert.strictEqual(called, false);
    console.log('✓ no email goes to an address that bounced or a domain that takes no email');
  }

  console.log('\nAll email bounce tests passed.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
