import { NextRequest, NextResponse } from 'next/server';

import {
  clearSessionCookies,
  getAuthenticatedSession,
  setSessionCookies,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export async function GET(req: NextRequest) {
  const configured = isSupabaseConfigured();

  if (!configured) {
    return NextResponse.json({
      configured: false,
      authenticated: false,
      user: null,
    });
  }

  const session = await getAuthenticatedSession(req);
  if (!session) {
    const response = NextResponse.json({
      configured: true,
      authenticated: false,
      user: null,
    });
    if (req.cookies.has('iatris_sb_access_token')) {
      clearSessionCookies(response, req);
    }
    return response;
  }

  const response = NextResponse.json({
    configured: true,
    authenticated: true,
    user: session.user,
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
