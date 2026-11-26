import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedSession } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Autenticação necessária.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
    const sqlPath = path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '202611250002_admin_settings_users_units.sql'
    );
    const sql = await readFile(sqlPath, 'utf8');
    return NextResponse.json({ sql });
  } catch {
    return NextResponse.json(
      {
        error:
          'Consulte a Seção 5 do arquivo sql.md na raiz do projeto para obter o script SQL.',
      },
      { status: 404 }
    );
  }
}
