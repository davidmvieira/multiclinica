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

  const section = req.nextUrl.searchParams.get('section')?.trim();
  const fileName =
    section === '7'
      ? '202611260001_patients_and_medical_records.sql'
      : section === '6'
        ? '202611250003_multiclinic_direct_reset.sql'
        : '202611250002_admin_settings_users_units.sql';

  const fallbackSection =
    section === '7' ? '7' : section === '6' ? '6' : '5';

  try {
    const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', fileName);
    const sql = await readFile(sqlPath, 'utf8');
    return NextResponse.json({ sql });
  } catch {
    return NextResponse.json(
      {
        error: `Consulte a Seção ${fallbackSection} do arquivo sql.md na raiz do projeto para obter o script SQL.`,
      },
      { status: 404 }
    );
  }
}
