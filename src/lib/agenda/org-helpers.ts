import type { SupabaseClient } from '@supabase/supabase-js';

import type { AgendaOrganization } from '@/types/agenda';

export function buildOrganizationSlug(clinicName: string, userId: string): string {
  const base = clinicName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);

  const prefix = base || 'clinica';
  const userPart = userId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'usr';
  const randPart = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
  return `${prefix}-${userPart}-${randPart}`;
}

export async function insertOrganizationWithFallback(
  supabase: SupabaseClient,
  params: {
    ownerUserId: string;
    name: string;
    timezone?: string;
    displayName?: string | null;
    email?: string | null;
  }
): Promise<{
  organization: AgendaOrganization | null;
  error: { code?: string; message?: string } | null;
}> {
  const timezone = params.timezone || 'America/Sao_Paulo';
  const slug = buildOrganizationSlug(params.name, params.ownerUserId);

  let { data: createdOrg, error: orgError } = await supabase
    .from('organizations')
    .insert({
      owner_user_id: params.ownerUserId,
      name: params.name,
      slug,
      timezone,
    })
    .select('id, owner_user_id, name, timezone')
    .single();

  if (
    orgError &&
    (orgError.code === '42703' ||
      (orgError.message ?? '').toLowerCase().includes('slug'))
  ) {
    const fallback = await supabase
      .from('organizations')
      .insert({
        owner_user_id: params.ownerUserId,
        name: params.name,
        timezone,
      })
      .select('id, owner_user_id, name, timezone')
      .single();
    createdOrg = fallback.data;
    orgError = fallback.error;
  } else if (orgError && orgError.code === '23505') {
    const retrySlug = buildOrganizationSlug(
      params.name,
      `${params.ownerUserId}${Math.random().toString(36).slice(2, 6)}`
    );
    const retry = await supabase
      .from('organizations')
      .insert({
        owner_user_id: params.ownerUserId,
        name: params.name,
        slug: retrySlug,
        timezone,
      })
      .select('id, owner_user_id, name, timezone')
      .single();
    createdOrg = retry.data;
    orgError = retry.error;
  }

  if (orgError || !createdOrg) {
    return {
      organization: null,
      error: orgError ?? { code: 'ERR', message: 'Falha ao inserir clínica' },
    };
  }

  const org = createdOrg as AgendaOrganization;

  const baseMember = {
    organization_id: org.id,
    user_id: params.ownerUserId,
    role: 'admin',
    display_name: params.displayName || 'Administrador',
    email: params.email || null,
  };

  const { error: memberErr } = await supabase
    .from('organization_members')
    .upsert(
      {
        ...baseMember,
        is_active: true,
        invite_status: 'active',
      },
      { onConflict: 'organization_id,user_id' }
    );

  if (memberErr && memberErr.code === '42703') {
    await supabase
      .from('organization_members')
      .upsert(baseMember, { onConflict: 'organization_id,user_id' });
  }

  return { organization: org, error: null };
}
