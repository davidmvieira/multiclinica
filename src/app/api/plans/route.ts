import { NextResponse } from 'next/server';

import { PLANS, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PlanDefinition } from '@/types/supabase';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      plans: PLANS,
      source: 'default',
      migrationPending: true,
    });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('plans')
      .select(
        'slug, name, description, max_professionals, max_patients, is_on_demand, sort_order'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error || !data || data.length === 0) {
      return NextResponse.json({
        plans: PLANS,
        source: 'default',
        migrationPending: true,
      });
    }

    const normalized: PlanDefinition[] = data
      .filter((row) => isValidPlanSlug(row.slug))
      .map((row) => ({
        slug: row.slug,
        name: String(row.name),
        description: String(row.description),
        max_professionals:
          typeof row.max_professionals === 'number'
            ? row.max_professionals
            : null,
        max_patients:
          typeof row.max_patients === 'number' ? row.max_patients : null,
        is_on_demand: Boolean(row.is_on_demand),
        sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
      }));

    return NextResponse.json({
      plans: normalized.length > 0 ? normalized : PLANS,
      source: normalized.length > 0 ? 'database' : 'default',
      migrationPending: normalized.length === 0,
    });
  } catch {
    return NextResponse.json({
      plans: PLANS,
      source: 'default',
      migrationPending: true,
    });
  }
}
