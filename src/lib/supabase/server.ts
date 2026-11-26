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

export function hasSupabaseServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRoleKey) {
    return null;
  }

  return createClient(config.url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
