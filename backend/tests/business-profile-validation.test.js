// Business Profile form rules: Business name and Your name are required;
// everything else is optional and never blocks saving when left empty, but
// if filled in it must look right (email, phone, website). The route answers
// with a message per field.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';

const assert = require('assert');
const { validateProfile, fieldError } = require('../core/businessProfileRules');

const full = {
  business_name: 'Ama Bakery', display_name: 'Ama', title: '', business_email: '', phone: '', whatsapp: '',
  website: '', location: '', offers: '', signature: '', extra_email_addresses: [],
};

(() => {
  // 1. Only the required fields filled in: saves; empty optional fields become null.
  {
    const r = validateProfile(full);
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.patch.business_name, 'Ama Bakery');
    assert.strictEqual(r.patch.phone, null);
    assert.strictEqual(r.patch.website, null);
    console.log('✓ empty optional fields never block saving');
  }

  // 2. A required field left empty (or only spaces) is refused with a clear message.
  {
    const r = validateProfile({ ...full, business_name: '   ', display_name: '' });
    assert.strictEqual(r.fieldErrors.business_name, 'Business name is required.');
    assert.strictEqual(r.fieldErrors.display_name, 'Your name is required.');
    assert.strictEqual(r.patch.business_name, undefined, 'nothing is saved for it');
    console.log('✓ Business name and Your name are required');
  }

  // 3. A partial update that leaves a required field out keeps the saved value.
  {
    const r = validateProfile({ phone: '+233 20 123 4567' });
    assert.deepStrictEqual(r.errors, []);
    assert.deepStrictEqual(Object.keys(r.patch), ['phone']);
    console.log('✓ a partial update without the required fields is fine');
  }

  // 4. Optional fields, when filled in, must look right.
  {
    const r = validateProfile({ ...full, business_email: 'ama@', phone: '12', whatsapp: 'call me', website: 'not a site', extra_email_addresses: ['ok@x.com', 'bad'] });
    assert(/email address/.test(r.fieldErrors.business_email));
    assert(/phone number/.test(r.fieldErrors.phone));
    assert(/phone number/.test(r.fieldErrors.whatsapp));
    assert(/web address/.test(r.fieldErrors.website));
    assert(/"bad"/.test(r.fieldErrors.extra_email_addresses));
    for (const ok of [['business_email', 'hello@ama.com.gh'], ['phone', '+233 20 123 4567'], ['whatsapp', '0201234567'],
      ['website', 'ama.com'], ['website', 'https://www.ama.com.gh/menu'], ['phone', '(020) 123-4567']]) {
      assert.strictEqual(fieldError(ok[0], ok[1]), null, `${ok[0]} "${ok[1]}" is fine`);
    }
    console.log('✓ a filled-in email, phone, WhatsApp, website or extra email must be valid');
  }

  // 5. Too long, and not text.
  {
    const r = validateProfile({ ...full, business_name: 'x'.repeat(121), location: 42 });
    assert(/too long/.test(r.fieldErrors.business_name));
    assert(/must be text/.test(r.fieldErrors.location));
    console.log('✓ over-long or non-text values are refused');
  }

  console.log('\nAll business profile validation tests passed.');
})();
