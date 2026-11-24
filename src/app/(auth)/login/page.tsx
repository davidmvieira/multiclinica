import LoginForm from '@/components/forms/login-form';
import { PLANS, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PlanDefinition } from '@/types/supabase';

export const dynamic = 'force-dynamic';

async function loadAvailablePlans(): Promise<readonly PlanDefinition[]> {
  if (!isSupabaseConfigured()) {
    return PLANS;
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
      return PLANS;
    }

    const mapped = data
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

    return mapped.length > 0 ? mapped : PLANS;
  } catch {
    return PLANS;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const supabaseConfigured = isSupabaseConfigured();
  const [plans, params] = await Promise.all([
    loadAvailablePlans(),
    searchParams,
  ]);

  const initialMode = params?.mode === 'register' ? 'register' : 'login';

  return (
    <LoginForm
      supabaseConfigured={supabaseConfigured}
      plans={plans}
      initialMode={initialMode}
    />
  );
}
