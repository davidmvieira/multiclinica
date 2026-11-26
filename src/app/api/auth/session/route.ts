import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  clearSessionCookies,
  getAuthenticatedSession,
  setSessionCookies,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AgendaOrganization } from '@/types/agenda';

export async function GET(req: NextRequest) {
  const configured = isSupabaseConfigured();

  if (!configured) {
    return NextResponse.json({
      configured: false,
      authenticated: false,
      user: null,
      organizations: [],
      activeOrganizationId: null,
    });
  }

  const session = await getAuthenticatedSession(req);
  if (!session) {
    const response = NextResponse.json({
      configured: true,
      authenticated: false,
      user: null,
      organizations: [],
      activeOrganizationId: null,
    });
    if (req.cookies.has('iatris_sb_access_token')) {
      clearSessionCookies(response, req);
    }
    return response;
  }

  let organizations: AgendaOrganization[] = [];
  let activeOrganizationId: string | null = null;

  try {
    const supabase = createSupabaseServerClient(session.accessToken);
    const { context } = await resolveAgendaAccessContext(
      supabase,
      session.user.id,
      session.user.email,
      session.activeOrganizationId
    );
    if (context) {
      organizations = context.organizations;
      activeOrganizationId = context.organization.id;
    }
  } catch {
    // Non-blocking if agenda tables are not yet provisioned
  }

  const response = NextResponse.json({
    configured: true,
    authenticated: true,
    user: session.user,
    organizations,
    activeOrganizationId,
  });

  if (session.refreshed) {
    setSessionCookies(
      response,
      req,
      session.accessToken,
      session.refreshToken
    );
  }

  return response;
}
