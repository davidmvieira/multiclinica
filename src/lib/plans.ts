import type { PlanDefinition, PlanSlug } from '@/types/supabase';

export const PLAN_SLUGS: readonly PlanSlug[] = [
  'free',
  'inicial',
  'pro',
  'on_demand',
] as const;

export const PLANS: readonly PlanDefinition[] = [
  {
    slug: 'free',
    name: 'Free',
    description: 'Para começar no consultório individual com gestão essencial.',
    max_professionals: 1,
    max_patients: 5,
    is_on_demand: false,
    sort_order: 1,
  },
  {
    slug: 'inicial',
    name: 'Inicial',
    description: 'Para pequenas clínicas em crescimento com equipe reduzida.',
    max_professionals: 3,
    max_patients: 15,
    is_on_demand: false,
    sort_order: 2,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Para clínicas estruturadas com maior volume de atendimentos.',
    max_professionals: 5,
    max_patients: 50,
    is_on_demand: false,
    sort_order: 3,
  },
  {
    slug: 'on_demand',
    name: 'On Demand',
    description: 'Capacidade sob medida acima de 5 profissionais e 50 pacientes.',
    max_professionals: null,
    max_patients: null,
    is_on_demand: true,
    sort_order: 4,
  },
] as const;

export function isValidPlanSlug(value: unknown): value is PlanSlug {
  return (
    typeof value === 'string' &&
    (PLAN_SLUGS as readonly string[]).includes(value)
  );
}

export function getPlanBySlug(slug: unknown): PlanDefinition {
  if (isValidPlanSlug(slug)) {
    const found = PLANS.find((plan) => plan.slug === slug);
    if (found) return found;
  }
  return PLANS[0];
}

export function formatPlanCapacity(plan: PlanDefinition): string {
  if (plan.is_on_demand || plan.max_professionals === null || plan.max_patients === null) {
    return 'Profissionais e pacientes sob medida';
  }
  const profLabel =
    plan.max_professionals === 1
      ? '1 profissional'
      : `${plan.max_professionals} profissionais`;
  const patientLabel =
    plan.max_patients === 1
      ? '1 paciente'
      : `${plan.max_patients} pacientes`;
  return `${profLabel} · ${patientLabel}`;
}
