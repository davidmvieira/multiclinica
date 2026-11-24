import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';

export function createSupabaseServerClient(accessToken?: string): SupabaseClient {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente.'
    );
  }

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : {}),
  });
}
