'use client';

import {
  AlertCircle,
  Check,
  ClipboardCheck,
  Copy,
  Database,
  Eye,
  FilePlus2,
  GitBranch,
  Lock,
  Plus,
  Printer,
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
import EvaluationFormRenderer from '@/components/evaluations/evaluation-form-renderer';
import TemplateVersionModal from '@/components/evaluations/template-version-modal';
import { EVALUATION_AUDIT_ACTION_LABELS } from '@/lib/evaluations/templates-catalog';
import type {
  EvaluationAuditAction,
  EvaluationAuditEvent,
  EvaluationPatientOption,
  EvaluationRecord,
  EvaluationStatus,
  EvaluationTemplateRecord,
  EvaluationTemplateVersionRecord,
  EvaluationsWorkspacePayload,
} from '@/types/evaluations';

type WorkspaceTab = 'evaluations' | 'templates' | 'audit';

interface ActiveFormSession {
  mode: 'create' | 'view_edit';
  patient: EvaluationPatientOption;
  templateId: string;
  templateName: string;
  templateVersion: EvaluationTemplateVersionRecord;
  evaluation: EvaluationRecord | null;
  auditEvents: EvaluationAuditEvent[];
}

export default function EvaluationsWorkspace() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tableNotFound, setTableNotFound] = useState(false);
  const [payload, setPayload] = useState<EvaluationsWorkspacePayload | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('evaluations');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EvaluationStatus>(
    'all'
  );
  const [patientFilter, setPatientFilter] = useState<string>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | EvaluationAuditAction>(
    'all'
  );

  // Launcher modal for new evaluation
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Template versioning modal
  const [versioningTemplate, setVersioningTemplate] =
    useState<EvaluationTemplateRecord | null>(null);

  // Active opened/created evaluation
  const [activeSession, setActiveSession] = useState<ActiveFormSession | null>(
    null
  );
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [officialExportPatient, setOfficialExportPatient] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/evaluations', { cache: 'no-store' });
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
        setError(data.error ?? 'Não foi possível carregar as avaliações.');
        return;
      }

      setTableNotFound(false);
      const typed = data as EvaluationsWorkspacePayload;
      setPayload(typed);
      setSelectedPatientId((prev) => prev || typed.patients[0]?.id || '');
      setSelectedTemplateId((prev) => prev || typed.templates[0]?.id || '');
    } catch {
      setError('Falha de conexão ao carregar o módulo de avaliações.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadWorkspace();
    const handleOrgChanged = () => {
      setActiveSession(null);
      void loadWorkspace();
    };
    window.addEventListener('iatris:org-changed', handleOrgChanged);
    return () => {
      window.removeEventListener('iatris:org-changed', handleOrgChanged);
    };
  }, [loadWorkspace]);

  const versionsById = useMemo(() => {
    const map = new Map<string, EvaluationTemplateVersionRecord>();
    for (const v of payload?.versions ?? []) {
      map.set(v.id, v);
    }
    return map;
  }, [payload?.versions]);

  const filteredEvaluations = useMemo(() => {
    const list = payload?.evaluations ?? [];
    const q = search.trim().toLowerCase();

    return list.filter((ev) => {
      if (statusFilter !== 'all' && ev.status !== statusFilter) return false;
      if (patientFilter !== 'all' && ev.patient_id !== patientFilter)
        return false;
      if (!q) return true;
      return (
        (ev.patient_name ?? '').toLowerCase().includes(q) ||
        ev.template_name.toLowerCase().includes(q) ||
        (ev.cbdf_code ?? '').toLowerCase().includes(q) ||
        (ev.functional_diagnosis ?? '').toLowerCase().includes(q) ||
        ev.author_name.toLowerCase().includes(q)
      );
    });
  }, [payload?.evaluations, search, statusFilter, patientFilter]);

  const filteredAuditEvents = useMemo(() => {
    const list = payload?.auditEvents ?? [];
    if (auditFilter === 'all') return list;
    return list.filter((ev) => ev.action_executed === auditFilter);
  }, [payload?.auditEvents, auditFilter]);

  async function handleCopySection8Sql() {
    try {
      const res = await fetch('/api/settings/sql?section=8');
      const data = await res.json();
      if (!res.ok || !data.sql) {
        setError('Consulte a Seção 8 do arquivo sql.md no repositório.');
        return;
      }
      await navigator.clipboard.writeText(data.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      setError('Não foi possível copiar o script SQL da Seção 8.');
    }
  }

  function handleLaunchNewEvaluation(preselectedTemplateId?: string) {
    if (!payload) return;
    if (preselectedTemplateId) {
      setSelectedTemplateId(preselectedTemplateId);
    } else if (!selectedTemplateId && payload.templates[0]) {
      setSelectedTemplateId(payload.templates[0].id);
    }
    if (!selectedPatientId && payload.patients[0]) {
      setSelectedPatientId(payload.patients[0].id);
    }
    setLauncherOpen(true);
  }

  function handleConfirmLauncher() {
    if (!payload) return;
    const patient = payload.patients.find((p) => p.id === selectedPatientId);
    const template = payload.templates.find((t) => t.id === selectedTemplateId);
    if (!patient || !template) {
      setError('Selecione um paciente e um modelo de avaliação.');
      return;
    }

    const version =
      (template.current_version_id
        ? versionsById.get(template.current_version_id)
        : undefined) ??
      payload.versions.find(
        (v) =>
          v.template_id === template.id &&
          v.version_number === template.current_version_number
      );

    if (!version) {
      setError('Versão estrutural vigente do modelo não encontrada.');
      return;
    }

    setLauncherOpen(false);
    setError(null);
    setActiveSession({
      mode: 'create',
      patient,
      templateId: template.id,
      templateName: template.name,
      templateVersion: version,
      evaluation: null,
      auditEvents: [],
    });
  }

  async function handleOpenEvaluation(ev: EvaluationRecord) {
    setOpeningId(ev.id);
    setError(null);
    try {
      const res = await fetch(`/api/evaluations/${ev.id}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível abrir a avaliação.');
        return;
      }

      const loadedEval = data.evaluation as EvaluationRecord;
      const loadedVersion =
        (data.templateVersion as EvaluationTemplateVersionRecord | null) ??
        versionsById.get(loadedEval.template_version_id);

      if (!loadedVersion) {
        setError(
          'Versão estrutural histórica desta avaliação não foi localizada.'
        );
        return;
      }

      const patientObj: EvaluationPatientOption = {
        id: loadedEval.patient_id,
        name: loadedEval.patient_name ?? ev.patient_name ?? 'Paciente',
        cpf: loadedEval.patient_cpf ?? ev.patient_cpf ?? null,
        status: '',
      };

      setActiveSession({
        mode: 'view_edit',
        patient: patientObj,
        templateId: loadedEval.template_id,
        templateName: loadedEval.template_name,
        templateVersion: loadedVersion,
        evaluation: loadedEval,
        auditEvents: (data.auditEvents ?? []) as EvaluationAuditEvent[],
      });
    } catch {
      setError('Erro de conexão ao abrir a avaliação.');
    } finally {
      setOpeningId(null);
    }
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

  if (activeSession && payload?.organization) {
    return (
      <div className="mx-auto max-w-5xl">
        <EvaluationFormRenderer
          mode={activeSession.mode}
          organizationName={payload.organization.name}
          patient={activeSession.patient}
          templateId={activeSession.templateId}
          templateName={activeSession.templateName}
          templateVersion={activeSession.templateVersion}
          initialEvaluation={activeSession.evaluation}
          defaultAuthorName={payload.currentUserName}
          defaultCouncilNumber={payload.currentUserCouncilNumber}
          canAuthorClinical={payload.canAuthorClinical}
          auditEvents={activeSession.auditEvents}
          onBack={() => {
            setActiveSession(null);
            void loadWorkspace();
          }}
          onSaved={(savedEval, savedVer, msg) => {
            setNotice(msg);
            setActiveSession((prev) =>
              prev
                ? {
                    ...prev,
                    mode: 'view_edit',
                    evaluation: savedEval,
                    templateVersion: savedVer,
                  }
                : null
            );
            void loadWorkspace();
          }}
          onDeleted={() => {
            setActiveSession(null);
            setNotice('Rascunho clínico excluído.');
            void loadWorkspace();
          }}
          onAuditUpdated={(events) => {
            setActiveSession((prev) =>
              prev ? { ...prev, auditEvents: events } : null
            );
          }}
        />
      </div>
    );
  }

  const totalEvaluations = payload?.evaluations.length ?? 0;
  const finalizedCount =
    payload?.evaluations.filter((e) => e.status === 'finalized').length ?? 0;
  const draftCount =
    payload?.evaluations.filter((e) => e.status === 'draft').length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Fidelidade clínica, CBDF e governança LGPD
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Avaliações Fisioterapêuticas
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Modelos homologados versionados da{' '}
            <span className="font-medium text-slate-800">
              {payload?.organization?.name ?? 'clínica'}
            </span>
            , diagnóstico funcional (CBDF), imutabilidade após conclusão e auditoria de acessos.
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

          {payload?.canAuthorClinical && !payload.migrationPending && (
            <button
              type="button"
              onClick={() => handleLaunchNewEvaluation()}
              disabled={payload.patients.length === 0}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova avaliação
            </button>
          )}
        </div>
      </div>

      {/* Section 8 SQL Pending Banner */}
      {payload?.migrationPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Atualização de banco de dados necessária (Seção 8)
                </h2>
                <p className="mt-1 text-xs text-amber-900">
                  Execute a <strong>Seção 8</strong> do arquivo{' '}
                  <code className="font-mono">sql.md</code> no SQL Editor do Supabase para habilitar os modelos versionados, diagnósticos CBDF, imutabilidade das avaliações e logs de auditoria LGPD.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySection8Sql()}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 whitespace-nowrap"
            >
              {copiedSql ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedSql ? 'SQL Copiado' : 'Copiar SQL (Seção 8)'}
            </button>
          </div>
        </div>
      )}

      {/* Alerts */}
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

      {/* KPI Strip */}
      <section className="grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Avaliações visíveis
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {totalEvaluations}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {finalizedCount} concluídas · {draftCount} rascunhos próprios
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Modelos homologados ativos
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {payload?.templates.length ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Versionamento estrutural preservado
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Eventos de auditoria LGPD
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {payload?.auditEvents.length ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Rastreabilidade com IP e timestamp UTC
          </p>
        </div>
      </section>

      {/* Segmented Workspace Tabs */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(
          [
            {
              id: 'evaluations',
              label: 'Avaliações Clínicas',
              count: totalEvaluations,
            },
            {
              id: 'templates',
              label: 'Modelos e Versões',
              count: payload?.templates.length ?? 0,
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

      {/* TAB 1: Evaluations List */}
      {activeTab === 'evaluations' && (
        <div className="space-y-4">
          {payload && payload.patients.length === 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Cadastre o primeiro paciente para iniciar avaliações
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  Toda avaliação clínica fica vinculada ao prontuário único do paciente na organização.
                </p>
              </div>
              <Link
                href="/pacientes"
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Ir para Pacientes
              </Link>
            </div>
          )}

          {/* Filters */}
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por paciente, modelo, CBDF ou fisioterapeuta..."
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <select
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
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
                setStatusFilter(e.target.value as 'all' | EvaluationStatus)
              }
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">Todos os estados</option>
              <option value="finalized">Concluídas (imutáveis)</option>
              <option value="draft">Rascunhos (meus)</option>
            </select>
          </div>

          {/* Evaluations Table */}
          {filteredEvaluations.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
              <ClipboardCheck className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Nenhuma avaliação encontrada
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Clique em &ldquo;Nova avaliação&rdquo; para preencher um modelo homologado em rascunho ou concluir com CBDF.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Paciente</th>
                      <th className="px-4 py-3">Modelo &amp; Versão</th>
                      <th className="px-4 py-3">CBDF &amp; Diagnóstico</th>
                      <th className="px-4 py-3">Autor &amp; Registro</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvaluations.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3.5 align-top">
                          <p className="font-semibold text-slate-900">
                            {ev.patient_name ?? 'Paciente'}
                          </p>
                          {ev.patient_cpf && (
                            <p className="font-mono text-xs text-slate-500 tabular-nums">
                              {ev.patient_cpf}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <p className="font-medium text-slate-900">
                            {ev.template_name}
                          </p>
                          <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                            Versão v{ev.template_version_number}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          {ev.cbdf_code ? (
                            <span className="inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800">
                              {ev.cbdf_code}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">
                              CBDF pendente
                            </span>
                          )}
                          {ev.functional_diagnosis && (
                            <p className="mt-1 line-clamp-2 max-w-xs text-xs text-slate-600">
                              {ev.functional_diagnosis}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <p className="text-xs font-medium text-slate-900">
                            {ev.author_name}
                          </p>
                          <p className="font-mono text-xs text-slate-500">
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
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setOfficialExportPatient({
                                  id: ev.patient_id,
                                  name: ev.patient_name ?? 'Paciente',
                                })
                              }
                              title="Exportar Prontuário Oficial"
                              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Printer className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                              Prontuário
                            </button>
                            <button
                              type="button"
                              disabled={openingId === ev.id}
                              onClick={() => void handleOpenEvaluation(ev)}
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

      {/* TAB 2: Templates & Structural Versioning */}
      {activeTab === 'templates' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(payload?.templates ?? []).map((tpl) => {
            const tplVersions = (payload?.versions ?? []).filter(
              (v) => v.template_id === tpl.id
            );
            const currentVer =
              (tpl.current_version_id
                ? versionsById.get(tpl.current_version_id)
                : undefined) ?? tplVersions[0];
            const restrictedCount =
              currentVer?.schema_json.sections.filter(
                (s) => s.is_restricted_to_author
              ).length ?? 0;

            return (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {tpl.category_label}
                    </span>
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-xs font-semibold text-emerald-800 tabular-nums">
                      v{tpl.current_version_number}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">
                    {tpl.name}
                  </h3>
                  <p className="text-xs leading-relaxed text-slate-600">
                    {tpl.description}
                  </p>
                  <div className="pt-1 text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      {currentVer?.schema_json.sections.length ?? 0} seções
                    </span>{' '}
                    ·{' '}
                    <span className="font-mono tabular-nums">
                      {tplVersions.length} versão(ões)
                    </span>
                    {restrictedCount > 0 && (
                      <span> · {restrictedCount} sigilosa(s) LGPD</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  {payload?.canAuthorClinical && (
                    <button
                      type="button"
                      disabled={payload.patients.length === 0}
                      onClick={() => handleLaunchNewEvaluation(tpl.id)}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <FilePlus2 className="h-3.5 w-3.5" />
                      Aplicar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setVersioningTemplate(tpl)}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    Versões
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 3: LGPD Audit Log */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Registro Imutável de Auditoria Clínica (AuditEvent — LGPD)
              </h2>
              <p className="text-xs text-slate-500">
                Cada abertura, conclusão, exportação em PDF ou compartilhamento grava usuário, clínica, timestamp UTC, ação e IP de origem.
              </p>
            </div>
            <select
              value={auditFilter}
              onChange={(e) =>
                setAuditFilter(e.target.value as 'all' | EvaluationAuditAction)
              }
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800"
            >
              <option value="all">Todas as ações</option>
              {(
                Object.keys(
                  EVALUATION_AUDIT_ACTION_LABELS
                ) as EvaluationAuditAction[]
              ).map((act) => (
                <option key={act} value={act}>
                  {EVALUATION_AUDIT_ACTION_LABELS[act]}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filteredAuditEvents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhum evento de auditoria registrado ainda nesta organização.
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
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                            {ev.action_executed}
                          </span>
                          <p className="mt-0.5 font-normal text-slate-600">
                            {EVALUATION_AUDIT_ACTION_LABELS[
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

      {/* New Evaluation Launcher Modal */}
      {launcherOpen && payload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-eval-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2
                  id="new-eval-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Iniciar Nova Avaliação Fisioterapêutica
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  A avaliação será vinculada à versão estrutural vigente do modelo escolhido.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLauncherOpen(false)}
                className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Paciente <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  {payload.patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.cpf ? ` (${p.cpf})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Modelo de Avaliação Homologado{' '}
                  <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                >
                  {payload.templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} (v{tpl.current_version_number})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setLauncherOpen(false)}
                className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmLauncher}
                className="h-9 cursor-pointer rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Abrir formulário
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Structural Versioning Modal */}
      {versioningTemplate && payload && (
        <TemplateVersionModal
          template={versioningTemplate}
          versions={payload.versions.filter(
            (v) => v.template_id === versioningTemplate.id
          )}
          canPublishVersion={payload.canAuthorClinical}
          onClose={() => setVersioningTemplate(null)}
          onVersionPublished={(updatedTpl, newVer) => {
            setVersioningTemplate(null);
            setNotice(
              `Nova versão v${newVer.version_number} publicada para "${updatedTpl.name}". Avaliações antigas permanecem inalteradas.`
            );
            void loadWorkspace();
          }}
        />
      )}

      {officialExportPatient && (
        <OfficialDossierModal
          patientId={officialExportPatient.id}
          patientName={officialExportPatient.name}
          onClose={() => setOfficialExportPatient(null)}
        />
      )}
    </div>
  );
}
