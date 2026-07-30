const { createClient } = require('@supabase/supabase-js');

/**
 * SupabaseTokenStore - persists OAuth tokens in Supabase so the Gmail
 * connection survives across deploys, not just local restarts.
 * Requires an `oauth_tokens` table - see database/schema.sql.
 */
class SupabaseTokenStore {
  constructor({ url, serviceKey }) {
    this.client = createClient(url, serviceKey);
  }

  async get(provider) {
    const { data, error } = await this.client
      .from('oauth_tokens')
      .select('tokens')
      .eq('provider', provider)
      .maybeSingle();
    if (error) throw new Error(`SupabaseTokenStore.get: ${error.message}`);
    return data ? data.tokens : null;
  }

  async save(provider, tokens) {
    const { error } = await this.client
      .from('oauth_tokens')
      .upsert({ provider, tokens, updated_at: new Date().toISOString() });
    if (error) throw new Error(`SupabaseTokenStore.save: ${error.message}`);
  }
}

module.exports = SupabaseTokenStore;
