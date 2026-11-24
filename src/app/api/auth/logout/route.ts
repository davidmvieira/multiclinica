import { NextRequest, NextResponse } from 'next/server';

import {
  ACCESS_TOKEN_COOKIE,
  clearSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json(
      { error: 'Origem da requisição não autorizada.' },
      { status: 403 }
    );
  }

  const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken && isSupabaseConfigured()) {
    try {
      const supabase = createSupabaseServerClient(accessToken);
      await supabase.auth.signOut();
    } catch {
      // Clear local cookies regardless of remote signOut response
    }
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response, req);
  return response;
}
