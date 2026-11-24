import type { NextRequest, NextResponse } from 'next/server';

import { isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AuthUser } from '@/types/supabase';

export const ACCESS_TOKEN_COOKIE = 'iatris_sb_access_token';
export const REFRESH_TOKEN_COOKIE = 'iatris_sb_refresh_token';

function isHttpsRequest(req: NextRequest): boolean {
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return req.nextUrl.protocol === 'https:';
}

export function verifySameOrigin(req: NextRequest): boolean {
  const secFetchSite = req.headers.get('sec-fetch-site')?.toLowerCase();
  if (secFetchSite === 'same-origin') {
    return true;
  }

  const origin = req.headers.get('origin');
  if (!origin) {
    if (secFetchSite && secFetchSite !== 'none') {
      return false;
    }
    return true;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const candidateHosts = [
    req.headers.get('x-forwarded-host'),
    req.headers.get('host'),
    req.nextUrl.host,
  ]
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (candidateHosts.length === 0) {
    return true;
  }

  return candidateHosts.includes(originHost);
}

export function setSessionCookies(
  res: NextResponse,
  req: NextRequest,
  accessToken: string,
  refreshToken?: string
): void {
  const secure = isHttpsRequest(req);
  const sameSite = secure ? ('none' as const) : ('lax' as const);

  res.cookies.set({
    name: ACCESS_TOKEN_COOKIE,
    value: accessToken,
    httpOnly: true,
    secure,
    sameSite,
    ...(secure ? { partitioned: true } : {}),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  if (refreshToken) {
    res.cookies.set({
      name: REFRESH_TOKEN_COOKIE,
      value: refreshToken,
      httpOnly: true,
      secure,
      sameSite,
      ...(secure ? { partitioned: true } : {}),
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export function clearSessionCookies(res: NextResponse, req: NextRequest): void {
  const secure = isHttpsRequest(req);
  const sameSite = secure ? ('none' as const) : ('lax' as const);

  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
    res.cookies.set({
      name,
      value: '',
      httpOnly: true,
      secure,
      sameSite,
      ...(secure ? { partitioned: true } : {}),
      path: '/',
      maxAge: 0,
    });
  }
}

export interface AuthenticatedSession {
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  refreshed: boolean;
}

export async function getAuthenticatedSession(
  req: NextRequest
): Promise<AuthenticatedSession | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const accessToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessToken && !refreshToken) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (!error && data.user) {
      const metadataName =
        typeof data.user.user_metadata?.full_name === 'string'
          ? data.user.user_metadata.full_name
          : null;
      const metadataPlan = isValidPlanSlug(data.user.user_metadata?.plan_slug)
        ? data.user.user_metadata.plan_slug
        : null;

      return {
        user: {
          id: data.user.id,
          email: data.user.email ?? '',
          name: metadataName,
          plan_slug: metadataPlan,
        },
        accessToken,
        refreshToken,
        refreshed: false,
      };
    }
  }

  if (refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (!error && data.session && data.user) {
      const metadataName =
        typeof data.user.user_metadata?.full_name === 'string'
          ? data.user.user_metadata.full_name
          : null;
      const metadataPlan = isValidPlanSlug(data.user.user_metadata?.plan_slug)
        ? data.user.user_metadata.plan_slug
        : null;

      return {
        user: {
          id: data.user.id,
          email: data.user.email ?? '',
          name: metadataName,
          plan_slug: metadataPlan,
        },
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        refreshed: true,
      };
    }
  }

  return null;
}
