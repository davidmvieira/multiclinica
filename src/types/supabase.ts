export type PlanSlug = 'free' | 'inicial' | 'pro' | 'on_demand';

export interface PlanDefinition {
  slug: PlanSlug;
  name: string;
  description: string;
  max_professionals: number | null;
  max_patients: number | null;
  is_on_demand: boolean;
  sort_order: number;
}

export interface UserSubscription {
  plan_slug: PlanSlug;
  status: 'active' | 'pending_contact' | 'canceled';
  account_name: string | null;
  plan: PlanDefinition;
  source: 'database' | 'metadata';
  migration_pending: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  plan_slug?: PlanSlug | null;
}

export interface TodoItem {
  id: string | number;
  title: string;
  is_complete: boolean;
  created_at: string | null;
}

export interface SessionResponse {
  configured: boolean;
  authenticated: boolean;
  user: AuthUser | null;
}
