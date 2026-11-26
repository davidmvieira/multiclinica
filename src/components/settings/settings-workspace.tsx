'use client';

import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Stethoscope,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import AgendaSqlSetup from '@/components/agenda/agenda-sql-setup';
import AdminProfessionalModal from '@/components/settings/admin-professional-modal';
import UnitModal from '@/components/settings/unit-modal';
import UserModal from '@/components/settings/user-modal';
import PlanSettingsPanel from '@/components/supabase/plan-settings-panel';
import { ROLE_LABELS } from '@/lib/agenda/constants';
import type { AgendaSpecialty, MemberRole } from '@/types/agenda';
import type {
  SettingsMember,
  SettingsPayload,
  SettingsProfessional,
  SettingsUnit,
} from '@/types/settings';

type SettingsTab = 'users' | 'professionals' | 'units' | 'clinic';

type ConfirmAction =
  | { type: 'remove_user'; member: SettingsMember }
  | { type: 'delete_unit'; unit: SettingsUnit };

const TIMEZONE_LABELS: Record<string, string> = {
  'America/Sao_Paulo': 'Brasília / São Paulo (UTC-3)',
  'America/Fortaleza': 'Nordeste / Fortaleza (UTC-3)',
  'America/Belem': 'Belém / Pará (UTC-3)',
  'America/Manaus': 'Manaus / Amazonas (UTC-4)',
  'America/Cuiaba': 'Cuiabá / Mato Grosso (UTC-4)',
  'America/Rio_Branco': 'Rio Branco / Acre (UTC-5)',
};

export default function SettingsWorkspace() {
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>('users');
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [setupMode, setSetupMode] = useState<
    'table_not_found' | 'needs_bootstrap' | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Directory filters
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [profSearch, setProfSearch] = useState('');
  const [profUnitFilter, setProfUnitFilter] = useState<string>('all');
  const [profStatusFilter, setProfStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all');
  const [unitSearch, setUnitSearch] = useState('');

  // Clinic profile form
  const [clinicName, setClinicName] = useState('');
  const [clinicTimezone, setClinicTimezone] = useState('America/Sao_Paulo');
  const [savingClinic, setSavingClinic] = useState(false);

  // Modals
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<SettingsMember | null>(
    null
  );
  const [profModalOpen, setProfModalOpen] = useState(false);
  const [editingProf, setEditingProf] = useState<SettingsProfessional | null>(
    null
  );
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<SettingsUnit | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
    null
  );
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedSettingsSql, setCopiedSettingsSql] = useState(false);

  const loadSettings = useCallback(
    async (customNotice?: string) => {
      setLoading(true);
      setError(null);
      if (customNotice) setNotice(customNotice);

      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (res.status === 401) {
          router.replace('/login');
          return;
        }

        const data = await res.json();
        if (res.status === 404 && data.code === 'TABLE_NOT_FOUND') {
          setSetupMode('table_not_found');
          setPayload(data);
          return;
        }

        if (!res.ok) {
          setError(data.error ?? 'Não foi possível carregar as configurações.');
          return;
        }

        if (data.needsBootstrap) {
          setSetupMode('needs_bootstrap');
          setPayload(data);
          return;
        }

        setSetupMode(null);
        setPayload(data as SettingsPayload);
        if (data.organization) {
          setClinicName(data.organization.name ?? '');
          setClinicTimezone(
            data.organization.timezone ?? 'America/Sao_Paulo'
          );
        }
        if (!data.isAdmin) {
          setTab('clinic');
        }
      } catch {
        setError('Falha de conexão ao carregar configurações.');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const unitMap = useMemo(() => {
    const map = new Map<string, SettingsUnit>();
    for (const u of payload?.units ?? []) {
      map.set(u.id, u);
    }
    return map;
  }, [payload?.units]);

  const specialtyMap = useMemo(() => {
    const map = new Map<string, AgendaSpecialty>();
    for (const sp of payload?.specialties ?? []) {
      map.set(sp.id, sp);
    }
    return map;
  }, [payload?.specialties]);

  const memberByUserId = useMemo(() => {
    const map = new Map<string, SettingsMember>();
    for (const m of payload?.members ?? []) {
      if (m.user_id) {
        map.set(m.user_id, m);
      }
    }
    return map;
  }, [payload?.members]);

  const filteredMembers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return (payload?.members ?? []).filter((m) => {
      if (userRoleFilter !== 'all' && m.role !== userRoleFilter) return false;
      if (!q) return true;
      return (
        (m.display_name ?? '').toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q) ||
        (ROLE_LABELS[m.role] ?? '').toLowerCase().includes(q)
      );
    });
  }, [payload?.members, userRoleFilter, userSearch]);

  const filteredProfessionals = useMemo(() => {
    const q = profSearch.trim().toLowerCase();
    return (payload?.professionals ?? []).filter((p) => {
      if (profUnitFilter !== 'all') {
        if (profUnitFilter === 'none' && p.unit_id !== null) return false;
        if (profUnitFilter !== 'none' && p.unit_id !== profUnitFilter) {
          return false;
        }
      }
      if (profStatusFilter === 'active' && !p.is_active) return false;
      if (profStatusFilter === 'inactive' && p.is_active) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.council_number ?? '').toLowerCase().includes(q)
      );
    });
  }, [payload?.professionals, profSearch, profStatusFilter, profUnitFilter]);

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    return (payload?.units ?? []).filter((u) => {
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.address ?? '').toLowerCase().includes(q)
      );
    });
  }, [payload?.units, unitSearch]);

  const activeProfCount = useMemo(
    () => (payload?.professionals ?? []).filter((p) => p.is_active).length,
    [payload?.professionals]
  );

  const activeUnitsCount = useMemo(
    () => (payload?.units ?? []).filter((u) => u.is_active).length,
    [payload?.units]
  );

  async function handleCopySettingsSql() {
    try {
      const res = await fetch('/api/settings/sql');
      const data = await res.json();
      if (!res.ok || !data.sql) {
        setError('Consulte a Seção 5 do arquivo sql.md no repositório.');
        return;
      }
      await navigator.clipboard.writeText(data.sql);
      setCopiedSettingsSql(true);
      setTimeout(() => setCopiedSettingsSql(false), 3000);
    } catch {
      setError('Não foi possível copiar o script SQL automaticamente.');
    }
  }

  async function handleToggleMemberStatus(member: SettingsMember) {
    setTogglingId(member.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: member.id,
          isActive: !member.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível alterar o status.');
        return;
      }
      await loadSettings(
        member.is_active ? 'Usuário desativado.' : 'Usuário reativado.'
      );
    } catch {
      setError('Falha de conexão ao atualizar usuário.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleToggleProfessionalStatus(prof: SettingsProfessional) {
    setTogglingId(prof.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/agenda/professionals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: prof.id,
          isActive: !prof.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível alterar o profissional.');
        return;
      }
      await loadSettings(
        prof.is_active
          ? `${prof.name} foi marcado como inativo.`
          : `${prof.name} foi reativado.`
      );
    } catch {
      setError('Falha de conexão ao atualizar profissional.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleToggleUnitStatus(unit: SettingsUnit) {
    setTogglingId(unit.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: unit.id,
          isActive: !unit.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível alterar o status da unidade.');
        return;
      }
      await loadSettings(
        unit.is_active
          ? `${unit.name} foi desativada.`
          : `${unit.name} foi ativada.`
      );
    } catch {
      setError('Falha de conexão ao atualizar unidade.');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleExecuteConfirm() {
    if (!confirmAction) return;
    setConfirmLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (confirmAction.type === 'remove_user') {
        const res = await fetch(
          `/api/settings/users?id=${encodeURIComponent(confirmAction.member.id)}`,
          { method: 'DELETE' }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível remover o usuário.');
          setConfirmAction(null);
          return;
        }
        setConfirmAction(null);
        await loadSettings('Usuário removido da clínica.');
      } else if (confirmAction.type === 'delete_unit') {
        const res = await fetch(
          `/api/settings/units?id=${encodeURIComponent(confirmAction.unit.id)}`,
          { method: 'DELETE' }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? 'Não foi possível excluir a unidade.');
          setConfirmAction(null);
          return;
        }
        setConfirmAction(null);
        await loadSettings('Unidade excluída com sucesso.');
      }
    } catch {
      setError('Falha de conexão ao executar a ação.');
      setConfirmAction(null);
    } finally {
      setConfirmLoading(false);
    }
  }

  async function handleSaveClinic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (clinicName.trim().length < 2) {
      setError('Informe o nome da clínica (pelo menos 2 caracteres).');
      return;
    }

    setSavingClinic(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clinicName.trim(),
          timezone: clinicTimezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar os dados da clínica.');
        return;
      }
      await loadSettings('Dados da clínica atualizados.');
    } catch {
      setError('Falha de conexão ao salvar dados da clínica.');
    } finally {
      setSavingClinic(false);
    }
  }

  function handlePrimaryAction() {
    if (tab === 'users') {
      setEditingMember(null);
      setUserModalOpen(true);
    } else if (tab === 'professionals') {
      setEditingProf(null);
      setProfModalOpen(true);
    } else if (tab === 'units') {
      setEditingUnit(null);
      setUnitModalOpen(true);
    }
  }

  if (loading && !payload && !setupMode) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      </div>
    );
  }

  if (setupMode) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <AgendaSqlSetup
          mode={setupMode}
          planLimits={
            payload?.planLimits ?? {
              planName: 'Free',
              maxProfessionals: 1,
              maxPatients: 5,
            }
          }
          onReload={() => loadSettings()}
        />
        <div className="border-t border-slate-200 pt-8">
          <PlanSettingsPanel embedded />
        </div>
      </div>
    );
  }

  const isAdmin = Boolean(payload?.isAdmin);
  const canManageAdmins =
    Boolean(payload?.isOwner) || payload?.role === 'admin';
  const planLimits = payload?.planLimits ?? {
    planSlug: 'free',
    planName: 'Free',
    maxProfessionals: 1,
    maxPatients: 5,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Administração da clínica
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Configurações
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cadastre usuários, gerencie profissionais e organize unidades de
            atendimento da{' '}
            <span className="font-medium text-slate-800">
              {payload?.organization?.name ?? 'clínica'}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadSettings()}
            disabled={loading}
            className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Atualizar
          </button>

          {isAdmin && tab !== 'clinic' && (
            <button
              type="button"
              onClick={handlePrimaryAction}
              className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {tab === 'users'
                ? 'Cadastrar usuário'
                : tab === 'professionals'
                  ? 'Novo profissional'
                  : 'Nova unidade'}
            </button>
          )}
        </div>
      </div>

      {/* Capacity Summary Bar (single hairline container, tabular numerals) */}
      {isAdmin && (
        <section
          aria-label="Resumo de capacidade e equipe"
          className="grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        >
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">
              Profissionais ativos
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {activeProfCount}
              <span className="text-sm font-normal text-slate-500">
                {planLimits.maxProfessionals === null
                  ? ' · Sob medida'
                  : ` / ${planLimits.maxProfessionals}`}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Plano {planLimits.planName}
            </p>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">
              Pacientes cadastrados
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {payload?.patientCount ?? 0}
              <span className="text-sm font-normal text-slate-500">
                {planLimits.maxPatients === null
                  ? ' · Sob medida'
                  : ` / ${planLimits.maxPatients}`}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Limite operacional da assinatura
            </p>
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">
              Equipe e estrutura
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {payload?.members.length ?? 0}
              <span className="font-sans text-sm font-normal text-slate-600">
                {' '}
                {payload?.members.length === 1 ? 'usuário' : 'usuários'}
              </span>
              <span className="mx-1.5 text-slate-300" aria-hidden="true">
                ·
              </span>
              {activeUnitsCount}
              <span className="font-sans text-sm font-normal text-slate-600">
                {' '}
                {activeUnitsCount === 1 ? 'unidade ativa' : 'unidades ativas'}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {payload?.specialties.length ?? 0} especialidades configuradas
            </p>
          </div>
        </section>
      )}

      {/* Optional Migration 5 notice */}
      {isAdmin && payload?.settingsMigrationPending && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm text-amber-950">
            <Database
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Atualização SQL recomendada (Seção 5 do sql.md)
              </p>
              <p className="mt-0.5 text-xs text-amber-900">
                Aplique a Seção 5 no Supabase para liberar pré-cadastro sem
                senha, vínculo automático por e-mail e campos de conselho e
                telefone.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCopySettingsSql()}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-50 whitespace-nowrap shrink-0"
          >
            {copiedSettingsSql ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                SQL copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copiar SQL da Seção 5
              </>
            )}
          </button>
        </div>
      )}

      {/* Feedback alerts */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold text-red-700 hover:underline whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-emerald-700"
              aria-hidden="true"
            />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold text-emerald-800 hover:underline whitespace-nowrap"
          >
            Ok
          </button>
        </div>
      )}

      {!isAdmin && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-700">
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
            aria-hidden="true"
          />
          <span>
            Seu perfil atual é{' '}
            <strong className="font-semibold text-slate-900">
              {ROLE_LABELS[payload?.role ?? 'delegated_manager']}
            </strong>
            . Apenas administradores e gestores podem cadastrar usuários,
            profissionais e unidades.
          </span>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Seções de configuração"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
      >
        {isAdmin && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'users'}
              onClick={() => setTab('users')}
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === 'users'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>Usuários</span>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {payload?.members.length ?? 0}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tab === 'professionals'}
              onClick={() => setTab('professionals')}
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === 'professionals'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Stethoscope className="h-4 w-4" aria-hidden="true" />
              <span>Profissionais</span>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {payload?.professionals.length ?? 0}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tab === 'units'}
              onClick={() => setTab('units')}
              className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                tab === 'units'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Building2 className="h-4 w-4" aria-hidden="true" />
              <span>Unidades</span>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {payload?.units.length ?? 0}
              </span>
            </button>
          </>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'clinic'}
          onClick={() => setTab('clinic')}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            tab === 'clinic'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>Clínica e plano</span>
        </button>
      </div>

      {/* Tab Content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* TAB 1: USERS */}
        {tab === 'users' && isAdmin && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Buscar por nome ou e-mail..."
                  aria-label="Buscar usuários"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  aria-label="Filtrar por perfil de acesso"
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-600"
                >
                  <option value="all">Todos os perfis</option>
                  {(Object.keys(ROLE_LABELS) as MemberRole[]).map((roleKey) => (
                    <option key={roleKey} value={roleKey}>
                      {ROLE_LABELS[roleKey]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <Users
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhum usuário encontrado
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {payload?.members.length === 0
                    ? 'Cadastre recepcionistas, gestores ou profissionais para acessar o sistema.'
                    : 'Ajuste os filtros de busca para localizar o usuário.'}
                </p>
                {payload?.members.length === 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMember(null);
                      setUserModalOpen(true);
                    }}
                    className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Cadastrar primeiro usuário
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Usuário</th>
                      <th className="px-4 py-3">Perfil</th>
                      <th className="px-4 py-3">Unidade</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMembers.map((member) => {
                      const unit = member.unit_id
                        ? unitMap.get(member.unit_id)
                        : null;
                      const isSelf =
                        Boolean(member.user_id) &&
                        member.user_id === payload?.currentUserId;
                      const statusLabel = !member.is_active
                        ? 'Inativo'
                        : member.user_id
                          ? 'Ativo'
                          : 'Aguardando acesso';

                      return (
                        <tr
                          key={member.id}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {member.display_name || 'Sem nome'}
                              {member.is_owner && (
                                <span className="ml-2 text-xs font-medium text-emerald-700">
                                  · Proprietário
                                </span>
                              )}
                              {isSelf && !member.is_owner && (
                                <span className="ml-2 text-xs font-medium text-slate-500">
                                  · Você
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {member.email || 'Sem e-mail'}
                              {member.phone ? ` · ${member.phone}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            {ROLE_LABELS[member.role] ?? member.role}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {unit ? unit.name : 'Todas as unidades'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {!member.is_active ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                <UserX className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                {statusLabel}
                              </span>
                            ) : member.user_id ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                {statusLabel}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                {statusLabel}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMember(member);
                                  setUserModalOpen(true);
                                }}
                                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                Editar
                              </button>

                              {!member.is_owner && !isSelf && (
                                <>
                                  <button
                                    type="button"
                                    disabled={togglingId === member.id}
                                    onClick={() =>
                                      void handleToggleMemberStatus(member)
                                    }
                                    className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    {member.is_active ? 'Desativar' : 'Ativar'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmAction({
                                        type: 'remove_user',
                                        member,
                                      })
                                    }
                                    aria-label={`Remover ${member.display_name || member.email}`}
                                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: PROFESSIONALS */}
        {tab === 'professionals' && isAdmin && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={profSearch}
                  onChange={(e) => setProfSearch(e.target.value)}
                  placeholder="Buscar profissional, e-mail ou registro..."
                  aria-label="Buscar profissionais"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filtrar por unidade"
                  value={profUnitFilter}
                  onChange={(e) => setProfUnitFilter(e.target.value)}
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-600"
                >
                  <option value="all">Todas as unidades</option>
                  {(payload?.units ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                  <option value="none">Sem unidade fixa</option>
                </select>

                <select
                  aria-label="Filtrar por situação"
                  value={profStatusFilter}
                  onChange={(e) =>
                    setProfStatusFilter(
                      e.target.value as 'all' | 'active' | 'inactive'
                    )
                  }
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-600"
                >
                  <option value="all">Todos os status</option>
                  <option value="active">Somente ativos</option>
                  <option value="inactive">Somente inativos</option>
                </select>
              </div>
            </div>

            {filteredProfessionals.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <Stethoscope
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhum profissional encontrado
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Cadastre profissionais para liberar agendas independentes e
                  escalas de atendimento.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProf(null);
                    setProfModalOpen(true);
                  }}
                  className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Novo profissional
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Profissional</th>
                      <th className="px-4 py-3">Especialidades</th>
                      <th className="px-4 py-3">Unidade</th>
                      <th className="px-4 py-3 text-right">Sessão</th>
                      <th className="px-4 py-3">Conta vinculada</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProfessionals.map((prof) => {
                      const unit = prof.unit_id
                        ? unitMap.get(prof.unit_id)
                        : null;
                      const linkedMember = prof.user_id
                        ? memberByUserId.get(prof.user_id)
                        : null;
                      const specNames = prof.specialty_ids
                        .map((id) => specialtyMap.get(id)?.name)
                        .filter(Boolean);

                      return (
                        <tr
                          key={prof.id}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="h-3 w-3 shrink-0 rounded-sm border border-slate-200"
                                style={{ backgroundColor: prof.color }}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900">
                                  {prof.name}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {prof.council_number
                                    ? `${prof.council_number}${prof.email ? ` · ${prof.email}` : ''}`
                                    : prof.email || 'Sem e-mail'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {specNames.length > 0
                              ? specNames.join(' · ')
                              : 'Não definida'}
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                            {unit ? unit.name : 'Sem unidade fixa'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {prof.schedule?.slot_duration_minutes ?? 60} min
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                            {linkedMember
                              ? linkedMember.email || linkedMember.display_name
                              : prof.user_id
                                ? 'Vinculada'
                                : 'Sem login'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
                                prof.is_active
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {prof.is_active ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProf(prof);
                                  setProfModalOpen(true);
                                }}
                                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                Editar
                              </button>

                              <button
                                type="button"
                                disabled={togglingId === prof.id}
                                onClick={() =>
                                  void handleToggleProfessionalStatus(prof)
                                }
                                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {prof.is_active ? 'Desativar' : 'Reativar'}
                              </button>

                              <Link
                                href="/agenda"
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              >
                                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                Agenda
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 3: UNITS */}
        {tab === 'units' && isAdmin && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                  placeholder="Buscar unidade por nome ou endereço..."
                  aria-label="Buscar unidades"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            {filteredUnits.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <Building2
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhuma unidade encontrada
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Cadastre suas unidades físicas ou polos de atendimento para
                  filtrar agendas e equipes.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingUnit(null);
                    setUnitModalOpen(true);
                  }}
                  className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Nova unidade
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Unidade</th>
                      <th className="px-4 py-3">Fuso horário</th>
                      <th className="px-4 py-3 text-right">Profissionais</th>
                      <th className="px-4 py-3 text-right">Usuários</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUnits.map((unit) => {
                      const profCount = (payload?.professionals ?? []).filter(
                        (p) => p.unit_id === unit.id
                      ).length;
                      const memberCount = (payload?.members ?? []).filter(
                        (m) => m.unit_id === unit.id
                      ).length;

                      return (
                        <tr
                          key={unit.id}
                          className="transition-colors hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">
                              {unit.name}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              {unit.address || 'Endereço não informado'}
                              {unit.phone ? ` · ${unit.phone}` : ''}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                            {TIMEZONE_LABELS[unit.timezone] ?? unit.timezone}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {profCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {memberCount}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`text-xs font-medium ${
                                unit.is_active
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              {unit.is_active ? 'Ativa' : 'Inativa'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingUnit(unit);
                                  setUnitModalOpen(true);
                                }}
                                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                Editar
                              </button>

                              <button
                                type="button"
                                disabled={togglingId === unit.id}
                                onClick={() => void handleToggleUnitStatus(unit)}
                                className="inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {unit.is_active ? 'Desativar' : 'Ativar'}
                              </button>

                              {(payload?.units.length ?? 0) > 1 &&
                                canManageAdmins && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirmAction({
                                        type: 'delete_unit',
                                        unit,
                                      })
                                    }
                                    aria-label={`Excluir ${unit.name}`}
                                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                                  >
                                    <Trash2
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 4: CLINIC & PLAN */}
        {tab === 'clinic' && (
          <div className="space-y-8">
            {isAdmin && payload?.organization && (
              <section className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-slate-900">
                    Dados gerais da clínica
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Nome exibido nos cabeçalhos e fuso horário padrão para
                    agendamentos.
                  </p>
                </div>

                <form
                  onSubmit={handleSaveClinic}
                  className="grid gap-4 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-5">
                    <label
                      htmlFor="clinic-org-name"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Nome da clínica
                    </label>
                    <input
                      id="clinic-org-name"
                      type="text"
                      required
                      maxLength={120}
                      disabled={!canManageAdmins}
                      value={clinicName}
                      onChange={(e) => setClinicName(e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label
                      htmlFor="clinic-org-tz"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Fuso horário padrão
                    </label>
                    <select
                      id="clinic-org-tz"
                      disabled={!canManageAdmins}
                      value={clinicTimezone}
                      onChange={(e) => setClinicTimezone(e.target.value)}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      {Object.entries(TIMEZONE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={!canManageAdmins || savingClinic}
                      className="inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      {savingClinic ? 'Salvando...' : 'Salvar dados'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <PlanSettingsPanel embedded />
          </div>
        )}
      </motion.div>

      {/* Modals */}
      {userModalOpen && payload && (
        <UserModal
          member={editingMember}
          units={payload.units}
          specialties={payload.specialties}
          hasServiceRole={payload.hasServiceRole}
          canManageAdmins={canManageAdmins}
          onClose={() => {
            setUserModalOpen(false);
            setEditingMember(null);
          }}
          onSaved={loadSettings}
        />
      )}

      {profModalOpen && payload && (
        <AdminProfessionalModal
          professional={editingProf}
          units={payload.units}
          specialties={payload.specialties}
          members={payload.members}
          onClose={() => {
            setProfModalOpen(false);
            setEditingProf(null);
          }}
          onSaved={loadSettings}
          onSpecialtyCreated={(spec) =>
            setPayload((prev) =>
              prev
                ? {
                    ...prev,
                    specialties: [...prev.specialties, spec].sort((a, b) =>
                      a.name.localeCompare(b.name)
                    ),
                  }
                : prev
            )
          }
        />
      )}

      {unitModalOpen && (
        <UnitModal
          unit={editingUnit}
          onClose={() => {
            setUnitModalOpen(false);
            setEditingUnit(null);
          }}
          onSaved={loadSettings}
        />
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-action-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2
              id="confirm-action-title"
              className="text-lg font-bold text-slate-900"
            >
              {confirmAction.type === 'remove_user'
                ? 'Remover usuário da clínica'
                : 'Excluir unidade'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {confirmAction.type === 'remove_user'
                ? `Tem certeza que deseja remover ${
                    confirmAction.member.display_name ||
                    confirmAction.member.email
                  } da organização? O usuário perderá o acesso à agenda e aos painéis da clínica.`
                : `Tem certeza que deseja excluir permanentemente a unidade "${confirmAction.unit.name}"?`}
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={confirmLoading}
                onClick={() => setConfirmAction(null)}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmLoading}
                onClick={() => void handleExecuteConfirm()}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap"
              >
                {confirmLoading
                  ? 'Processando...'
                  : confirmAction.type === 'remove_user'
                    ? 'Confirmar remoção'
                    : 'Excluir unidade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
