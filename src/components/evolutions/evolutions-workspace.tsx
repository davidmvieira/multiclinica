'use client';

import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  Eye,
  FileOutput,
  FilePlus2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import AgendaSqlSetup from '@/components/agenda/agenda-sql-setup';
import OfficialDossierModal from '@/components/clinical/official-dossier-modal';
import EvolutionFormModal from '@/components/evolutions/evolution-form-modal';
import { CLINICAL_EVOLUTION_AUDIT_LABELS } from '@/lib/evolutions/server';
import type {
  ClinicalEvolutionAuditAction,
  ClinicalEvolutionAuditEvent,
  ClinicalEvolutionRecord,
  ClinicalEvolutionStatus,
  EvolutionPendencyRecord,
  EvolutionsWorkspacePayload,
} from '@/types/evolutions';

type WorkspaceTab = 'pendencies' | 'evolutions' | 'audit';

interface ModalState {
  mode: 'create' | 'view_edit';
  pendency: EvolutionPendencyRecord | null;
  evolution: ClinicalEvolutionRecord | null;
  auditEvents: ClinicalEvolutionAuditEvent[];
}

function formatLocalSession(iso: string | null | undefined, tz = 'America/Sao_Paulo') {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function EvolutionsWorkspace() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tableNotFound, setTableNotFound] = useState(false);
  const [payload, setPayload] = useState<EvolutionsWorkspacePayload | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('pendencies');

  // Pendency queue filters (US04.2: default own queue for clinicians, clinic-wide option for managers)
  const [showAllClinicPendencies, setShowAllClinicPendencies] = useState(false);
  const [pendencyProfFilter, setPendencyProfFilter] = useState('all');

  // Evolutions filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClinicalEvolutionStatus>(
    'all'
  );
  const [patientFilter, setPatientFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState<
    'all' | ClinicalEvolutionAuditAction
  >('all');

  // Modals
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [dossierTarget, setDossierTarget] = useState<{
    patientId: string;
    patientName: string;
  } | null>(null);
  const [exportPickerOpen, setExportPickerOpen] = useState(false);
  const [exportSelectedPatientId, setExportSelectedPatientId] = useState('');

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/evolutions', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (res.status === 404 && data.code === 'TABLE_NOT_FOUND') {
        setTableNotFound(true);
        setPayload(null);
        return;
      }

      if (!res.ok) {
        setError(data.error ?? 'Não foi possível carregar as evoluções.');
        return;
      }

      const typed = data as EvolutionsWorkspacePayload;
      setTableNotFound(false);
      setPayload(typed);
      setShowAllClinicPendencies((prev) =>
        typed.isAdmin && !typed.currentProfessionalId ? true : prev
      );
      setExportSelectedPatientId(
        (prev) => prev || typed.patients[0]?.id || ''
      );
    } catch {
      setError('Falha de conexão ao carregar o módulo de evoluções.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadWorkspace();
    const handleOrgChanged = () => {
      setModalState(null);
      setDossierTarget(null);
      void loadWorkspace();
    };
    window.addEventListener('iatris:org-changed', handleOrgChanged);
    return () => {
      window.removeEventListener('iatris:org-changed', handleOrgChanged);
    };
  }, [loadWorkspace]);

  const openPendenciesAll = useMemo(
    () => (payload?.pendencies ?? []).filter((p) => p.status === 'pending'),
    [payload?.pendencies]
  );

  const visiblePendencies = useMemo(() => {
    if (!payload) return [];
    let list = openPendenciesAll;

    if (!payload.isAdmin || !showAllClinicPendencies) {
      if (payload.currentProfessionalId) {
        list = list.filter(
          (p) => p.professional_id === payload.currentProfessionalId
        );
      } else if (!payload.isAdmin) {
        list = list.filter(
          (p) => p.professional_user_id === payload.currentUserId
        );
      }
    } else if (pendencyProfFilter !== 'all') {
      list = list.filter((p) => p.professional_id === pendencyProfFilter);
    }

    return list;
  }, [
    payload,
    openPendenciesAll,
    showAllClinicPendencies,
    pendencyProfFilter,
  ]);

  const filteredEvolutions = useMemo(() => {
    const list = payload?.evolutions ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((ev) => {
      if (statusFilter !== 'all' && ev.status !== statusFilter) return false;
      if (patientFilter !== 'all' && ev.patient_id !== patientFilter)
        return false;
      if (!q) return true;
      return (
        (ev.patient_name ?? '').toLowerCase().includes(q) ||
        ev.shared_clinical_note.toLowerCase().includes(q) ||
        ev.author_name.toLowerCase().includes(q) ||
        (ev.procedures_performed ?? '').toLowerCase().includes(q)
      );
    });
  }, [payload?.evolutions, search, statusFilter, patientFilter]);

  const filteredAuditEvents = useMemo(() => {
    const list = payload?.auditEvents ?? [];
    if (auditFilter === 'all') return list;
    return list.filter((ev) => ev.action_executed === auditFilter);
  }, [payload?.auditEvents, auditFilter]);

  async function handleCopySection9Sql() {
    try {
      const res = await fetch('/api/settings/sql?section=9');
      const data = await res.json();
      if (!res.ok || !data.sql) {
        setError('Consulte a Seção 9 do arquivo sql.md no repositório.');
        return;
      }
      await navigator.clipboard.writeText(data.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      setError('Não foi possível copiar o script SQL da Seção 9.');
    }
  }

  async function handleOpenEvolutionById(
    evolutionId: string,
    pendency: EvolutionPendencyRecord | null = null
  ) {
    setOpeningId(evolutionId);
    setError(null);
    try {
      const res = await fetch(`/api/evolutions/${evolutionId}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível abrir a evolução clínica.');
        return;
      }
      setModalState({
        mode: 'view_edit',
        pendency,
        evolution: data.evolution as ClinicalEvolutionRecord,
        auditEvents: (data.auditEvents ?? []) as ClinicalEvolutionAuditEvent[],
      });
    } catch {
      setError('Falha de conexão ao abrir a evolução.');
    } finally {
      setOpeningId(null);
    }
  }

  function handleOpenPendencyAction(p: EvolutionPendencyRecord) {
    if (p.draft_evolution_id) {
      void handleOpenEvolutionById(p.draft_evolution_id, p);
      return;
    }
    setModalState({
      mode: 'create',
      pendency: p,
      evolution: null,
      auditEvents: [],
    });
  }

  if (loading && !payload && !tableNotFound) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-14 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      </div>
    );
  }

  if (tableNotFound) {
    return (
      <AgendaSqlSetup
        mode="table_not_found"
        planLimits={{
          planName: 'Free',
          maxProfessionals: 1,
          maxPatients: 5,
        }}
        onReload={loadWorkspace}
      />
    );
  }

  if (payload?.needsBootstrap) {
    return (
      <AgendaSqlSetup
        mode="needs_bootstrap"
        planLimits={payload.planLimits}
        onReload={loadWorkspace}
      />
    );
  }

  const tz = payload?.organization?.timezone || 'America/Sao_Paulo';
  const finalizedCount =
    payload?.evolutions.filter((e) => e.status === 'finalized').length ?? 0;
  const draftCount =
    payload?.evolutions.filter((e) => e.status === 'draft').length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Atendimentos realizados, autoria inalterável e sigilo LGPD
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Atendimentos e Evoluções Clínicas
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Fila automática de pendências da{' '}
            <span className="font-medium text-slate-800">
              {payload?.organization?.name ?? 'clínica'}
            </span>
            , evoluções vinculadas à sessão realizada, retificações rastreáveis e exportação oficial normatizada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            disabled={loading}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Atualizar
          </button>

          {payload && payload.patients.length > 0 && (
            <button
              type="button"
              onClick={() => setExportPickerOpen(true)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
            >
              <FileOutput className="h-4 w-4" aria-hidden="true" />
              Exportar Prontuário Oficial
            </button>
          )}
        </div>
      </div>

      {/* Section 9 SQL Pending Banner */}
      {payload?.migrationPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Atualização de banco de dados necessária (Seção 9)
                </h2>
                <p className="mt-1 text-xs text-amber-900">
                  Execute a <strong>Seção 9</strong> do arquivo{' '}
                  <code className="font-mono">sql.md</code> no SQL Editor do Supabase para habilitar a fila automática de pendências, evoluções compartimentalizadas, notas de retificação imutáveis e auditoria LGPD.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySection9Sql()}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 whitespace-nowrap"
            >
              {copiedSql ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedSql ? 'SQL Copiado' : 'Copiar SQL (Seção 9)'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {/* KPI Summary Strip */}
      <section className="grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Pendências na fila
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {visiblePendencies.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {openPendenciesAll.length} em toda a clínica
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Evoluções concluídas
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {finalizedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Imutáveis após assinatura
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Rascunhos em andamento
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {draftCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Exclusivos ao autor
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Eventos AuditEvent LGPD
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {payload?.auditEvents.length ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            UTC + IP de origem
          </p>
        </div>
      </section>

      {/* Segmented Tabs */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(
          [
            {
              id: 'pendencies',
              label: 'Fila de Pendências',
              count: visiblePendencies.length,
            },
            {
              id: 'evolutions',
              label: 'Evoluções Registradas',
              count: payload?.evolutions.length ?? 0,
            },
            {
              id: 'audit',
              label: 'Auditoria LGPD',
              count: payload?.auditEvents.length ?? 0,
            },
          ] as const
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                  active
                    ? 'bg-emerald-700 text-emerald-50'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Pending Queue */}
      {activeTab === 'pendencies' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Atendimentos &ldquo;Realizados&rdquo; aguardando evolução clínica
              </h2>
              <p className="text-xs text-slate-500">
                Gerados automaticamente ao concluir um atendimento na agenda e baixados assim que a evolução é assinada pelo autor.
              </p>
            </div>

            {payload?.isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setShowAllClinicPendencies((prev) => !prev)
                  }
                  className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                    showAllClinicPendencies
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {showAllClinicPendencies
                    ? 'Painel Geral da Clínica'
                    : 'Minha Fila Individual'}
                </button>

                {showAllClinicPendencies && (
                  <select
                    value={pendencyProfFilter}
                    onChange={(e) => setPendencyProfFilter(e.target.value)}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800"
                  >
                    <option value="all">Todos os profissionais</option>
                    {payload.professionals.map((prof) => (
                      <option key={prof.id} value={prof.id}>
                        {prof.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {visiblePendencies.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Nenhuma pendência de evolução em aberto
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Sempre que um agendamento na{' '}
                <Link
                  href="/agenda"
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  Agenda
                </Link>{' '}
                for marcado como &ldquo;Realizado&rdquo;, ele aparecerá aqui automaticamente.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Sessão Realizada</th>
                      <th className="px-4 py-3">Paciente</th>
                      <th className="px-4 py-3">Profissional Responsável</th>
                      <th className="px-4 py-3">Serviço / Unidade</th>
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visiblePendencies.map((p) => {
                      const canAuthorThisSession =
                        payload?.canAuthorClinical &&
                        (!p.professional_user_id ||
                          p.professional_user_id === payload.currentUserId);

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3.5 align-top">
                            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
                              {formatLocalSession(p.session_starts_at, tz)}
                            </span>
                            {p.draft_evolution_id && (
                              <p className="mt-1 text-[11px] font-medium text-amber-700">
                                Rascunho salvo
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 align-top">
                            <p className="font-semibold text-slate-900">
                              {p.patient_name}
                            </p>
                            {p.patient_cpf && (
                              <p className="font-mono text-xs text-slate-500 tabular-nums">
                                {p.patient_cpf}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 align-top text-xs text-slate-700">
                            <p className="font-medium text-slate-900">
                              {p.professional_name}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 align-top text-xs text-slate-600">
                            <p>{p.service_name || p.specialty_name || 'Atendimento clínico'}</p>
                            {p.unit_name && (
                              <p className="text-[11px] text-slate-400">
                                {p.unit_name}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right align-top">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setDossierTarget({
                                    patientId: p.patient_id,
                                    patientName: p.patient_name,
                                  })
                                }
                                className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <FileOutput className="h-3.5 w-3.5" />
                                Oficial
                              </button>
                              {canAuthorThisSession ? (
                                <button
                                  type="button"
                                  disabled={
                                    openingId === p.draft_evolution_id
                                  }
                                  onClick={() => handleOpenPendencyAction(p)}
                                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  <FilePlus2 className="h-3.5 w-3.5" />
                                  {p.draft_evolution_id
                                    ? 'Continuar rascunho'
                                    : 'Registrar evolução'}
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                                  <Lock className="h-3 w-3" />
                                  Exclusivo ao autor
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Evolutions List */}
      {activeTab === 'evolutions' && (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por paciente, conduta, evolução ou profissional..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <select
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
            >
              <option value="all">Todos os pacientes</option>
              {(payload?.patients ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | ClinicalEvolutionStatus)
              }
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
            >
              <option value="all">Todos os estados</option>
              <option value="finalized">Concluídas (imutáveis)</option>
              <option value="draft">Rascunhos (meus)</option>
            </select>
          </div>

          {filteredEvolutions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <ClipboardCheck className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Nenhuma evolução clínica registrada
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Selecione uma sessão realizada na aba &ldquo;Fila de Pendências&rdquo; para registrar a evolução diária.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Paciente &amp; Sessão</th>
                      <th className="px-4 py-3">SharedClinicalNote</th>
                      <th className="px-4 py-3">Autoria &amp; Registro</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvolutions.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3.5 align-top">
                          <p className="font-semibold text-slate-900">
                            {ev.patient_name ?? 'Paciente'}
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                            Sessão:{' '}
                            {formatLocalSession(
                              ev.appointment_starts_at ?? ev.created_at,
                              tz
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <p className="line-clamp-2 max-w-md text-xs text-slate-700">
                            {ev.shared_clinical_note || 'Rascunho sem texto'}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                            {(ev.eva_before !== null || ev.eva_after !== null) && (
                              <span className="font-mono text-slate-500 tabular-nums">
                                EVA {ev.eva_before ?? '—'} → {ev.eva_after ?? '—'}
                              </span>
                            )}
                            {(ev.rectifications?.length ?? 0) > 0 && (
                              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900">
                                {ev.rectifications?.length} retificação(ões)
                              </span>
                            )}
                            {ev.restrictedRecordHidden && (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <Lock className="h-3 w-3" />
                                Nota restrita protegida
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 align-top text-xs">
                          <p className="font-medium text-slate-900">
                            {ev.author_name}
                          </p>
                          <p className="font-mono text-slate-500">
                            {ev.author_council_number || 'Registro pendente'}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                            {(ev.finalized_at_utc ?? ev.created_at).slice(
                              0,
                              19
                            )}{' '}
                            UTC
                          </p>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          {ev.status === 'finalized' ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              <Lock className="h-3 w-3" />
                              Concluída
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              Rascunho
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right align-top">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setDossierTarget({
                                  patientId: ev.patient_id,
                                  patientName: ev.patient_name ?? 'Paciente',
                                })
                              }
                              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <FileOutput className="h-3.5 w-3.5" />
                              Oficial
                            </button>
                            <button
                              type="button"
                              disabled={openingId === ev.id}
                              onClick={() => void handleOpenEvolutionById(ev.id)}
                              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {openingId === ev.id
                                ? 'Abrindo...'
                                : ev.status === 'draft'
                                  ? 'Continuar'
                                  : 'Consultar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Audit Events */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Auditoria Contínua de Evoluções e Exportações Oficiais (LGPD)
              </h2>
              <p className="text-xs text-slate-500">
                Registros imutáveis de leitura, conclusão, retificações, PDFs e emissões oficiais do prontuário.
              </p>
            </div>
            <select
              value={auditFilter}
              onChange={(e) =>
                setAuditFilter(
                  e.target.value as 'all' | ClinicalEvolutionAuditAction
                )
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800"
            >
              <option value="all">Todas as ações</option>
              {(
                Object.keys(
                  CLINICAL_EVOLUTION_AUDIT_LABELS
                ) as ClinicalEvolutionAuditAction[]
              ).map((act) => (
                <option key={act} value={act}>
                  {CLINICAL_EVOLUTION_AUDIT_LABELS[act]}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredAuditEvents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhum evento de auditoria registrado nesta clínica.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <th className="px-4 py-3">Timestamp_UTC</th>
                      <th className="px-4 py-3">Acao_Executada</th>
                      <th className="px-4 py-3">ID_User / Profissional</th>
                      <th className="px-4 py-3">IP_Origem</th>
                      <th className="px-4 py-3">ID_Organization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAuditEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td className="px-4 py-3 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                          {ev.timestamp_utc}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                            {ev.action_executed}
                          </span>
                          <p className="mt-0.5 text-slate-600">
                            {CLINICAL_EVOLUTION_AUDIT_LABELS[
                              ev.action_executed
                            ] ?? ev.action_executed}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">
                            {ev.user_name || ev.user_email || 'Usuário'}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500">
                            {ev.user_id}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700 tabular-nums">
                          {ev.source_ip}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                          {ev.organization_id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Patient Picker Modal for Official Export */}
      {exportPickerOpen && payload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Exportar Prontuário Oficial
                </h2>
                <p className="text-xs text-slate-500">
                  Compila atendimentos, avaliações (CBDF) e evoluções com retificações conforme COFFITO e LGPD.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportPickerOpen(false)}
                className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Selecione o Paciente
              </label>
              <select
                value={exportSelectedPatientId}
                onChange={(e) => setExportSelectedPatientId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
              >
                {payload.patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.cpf ? ` (${p.cpf})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setExportPickerOpen(false)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const patient = payload.patients.find(
                    (p) => p.id === exportSelectedPatientId
                  );
                  if (!patient) return;
                  setExportPickerOpen(false);
                  setDossierTarget({
                    patientId: patient.id,
                    patientName: patient.name,
                  });
                }}
                className="h-9 cursor-pointer rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Gerar Documento Oficial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evolution Modal */}
      {modalState && payload?.organization && (
        <EvolutionFormModal
          mode={modalState.mode}
          organizationName={payload.organization.name}
          timeZone={tz}
          pendency={modalState.pendency}
          initialEvolution={modalState.evolution}
          defaultAuthorName={payload.currentUserName}
          defaultCouncilNumber={payload.currentUserCouncilNumber}
          canAuthorClinical={payload.canAuthorClinical}
          auditEvents={modalState.auditEvents}
          onClose={() => setModalState(null)}
          onSaved={(_saved, msg) => {
            setModalState(null);
            setNotice(msg);
            void loadWorkspace();
          }}
          onDeleted={() => {
            setModalState(null);
            setNotice('Rascunho excluído.');
            void loadWorkspace();
          }}
          onOpenOfficialDossier={(pid, pname) => {
            setModalState(null);
            setDossierTarget({ patientId: pid, patientName: pname });
          }}
          onAuditUpdated={(events) => {
            setModalState((prev) =>
              prev ? { ...prev, auditEvents: events } : null
            );
          }}
        />
      )}

      {/* Official Normative Dossier Modal */}
      {dossierTarget && (
        <OfficialDossierModal
          patientId={dossierTarget.patientId}
          patientName={dossierTarget.patientName}
          onClose={() => {
            setDossierTarget(null);
            void loadWorkspace();
          }}
        />
      )}
    </div>
  );
}
