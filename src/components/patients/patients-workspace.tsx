'use client';

import {
  AlertCircle,
  Check,
  Copy,
  Database,
  FileText,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import AgendaSqlSetup from '@/components/agenda/agenda-sql-setup';
import PatientFormModal from '@/components/patients/patient-form-modal';
import {
  PATIENT_STATUS_LIST,
  PATIENT_STATUS_META,
  formatCpf,
  normalizeCpfDigits,
} from '@/lib/patients/constants';
import type {
  PatientOperationalStatus,
  PatientRecord,
  PatientWorkspacePayload,
} from '@/types/patients';

export default function PatientsWorkspace() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tableNotFound, setTableNotFound] = useState(false);
  const [payload, setPayload] = useState<PatientWorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PatientOperationalStatus>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientRecord | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/patients', { cache: 'no-store' });
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
        setError(data.error ?? 'Não foi possível carregar os pacientes.');
        return;
      }

      setTableNotFound(false);
      setPayload(data as PatientWorkspacePayload);
    } catch {
      setError('Falha de conexão ao carregar pacientes.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadPatients();
    const handleOrgChanged = () => {
      void loadPatients();
    };
    window.addEventListener('iatris:org-changed', handleOrgChanged);
    return () => {
      window.removeEventListener('iatris:org-changed', handleOrgChanged);
    };
  }, [loadPatients]);

  const filteredPatients = useMemo(() => {
    const list = payload?.patients ?? [];
    const q = search.trim().toLowerCase();
    const qDigits = normalizeCpfDigits(search);

    return list.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) {
        return false;
      }
      if (!q) return true;

      const cpfMatch =
        qDigits.length >= 3 &&
        normalizeCpfDigits(p.cpf_digits ?? p.cpf).includes(qDigits);

      return (
        p.name.toLowerCase().includes(q) ||
        (p.social_name ?? '').toLowerCase().includes(q) ||
        (p.phone ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.alt_identifier_value ?? '').toLowerCase().includes(q) ||
        (p.legal_guardian_name ?? '').toLowerCase().includes(q) ||
        cpfMatch
      );
    });
  }, [payload?.patients, search, statusFilter]);

  async function handleCopySection7Sql() {
    try {
      const res = await fetch('/api/settings/sql?section=7');
      const data = await res.json();
      if (!res.ok || !data.sql) {
        setError('Consulte a Seção 7 do arquivo sql.md no repositório.');
        return;
      }
      await navigator.clipboard.writeText(data.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      setError('Não foi possível copiar o script SQL da Seção 7.');
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
        onReload={loadPatients}
      />
    );
  }

  if (payload?.needsBootstrap) {
    return (
      <AgendaSqlSetup
        mode="needs_bootstrap"
        planLimits={payload.planLimits}
        onReload={loadPatients}
      />
    );
  }

  const totalPatients = payload?.patients.length ?? 0;
  const activeCareCount =
    (payload?.countsByStatus.em_avaliacao ?? 0) +
    (payload?.countsByStatus.em_tratamento ?? 0) +
    (payload?.countsByStatus.em_acompanhamento ?? 0);
  const completedCount = payload?.countsByStatus.alta ?? 0;
  const maxPatients = payload?.planLimits.maxPatients ?? null;
  const limitReached = maxPatients !== null && totalPatients >= maxPatients;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Cadastro único e prontuário longitudinal
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Pacientes
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Registro centralizado da{' '}
            <span className="font-medium text-slate-800">
              {payload?.organization?.name ?? 'clínica'}
            </span>{' '}
            com prevenção de duplicidade por CPF e histórico clínico imutável.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadPatients()}
            disabled={loading}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Atualizar
          </button>

          <button
            type="button"
            disabled={limitReached}
            onClick={() => {
              setEditingPatient(null);
              setModalOpen(true);
            }}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo paciente
          </button>
        </div>
      </div>

      {/* Summary Bar (single hairline container, tabular-nums) */}
      <section
        aria-label="Resumo operacional de pacientes"
        className="grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Pacientes cadastrados
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {totalPatients}
            <span className="text-sm font-normal text-slate-500">
              {maxPatients === null ? ' · Sob medida' : ` / ${maxPatients}`}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Plano {payload?.planLimits.planName ?? 'Free'}
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Em atendimento ativo
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {activeCareCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Avaliação, tratamento ou acompanhamento
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500">
            Altas registradas
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
            {completedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prontuário longitudinal preservado
          </p>
        </div>
      </section>

      {/* Optional Migration Section 7 Alert */}
      {payload?.migrationPending && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm text-amber-950">
            <Database
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Atualização SQL necessária no Supabase (Seção 7 do sql.md)
              </p>
              <p className="mt-0.5 text-xs text-amber-900">
                Execute a Seção 7 para habilitar verificação única de CPF,
                contato de emergência, auditoria cadastral e prontuário
                longitudinal imutável.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCopySection7Sql()}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-950 hover:bg-amber-50 whitespace-nowrap shrink-0"
          >
            {copiedSql ? (
              <>
                <Check
                  className="h-3.5 w-3.5 text-emerald-600"
                  aria-hidden="true"
                />
                SQL copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copiar SQL da Seção 7
              </>
            )}
          </button>
        </div>
      )}

      {limitReached && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <span>
            O limite de {maxPatients} pacientes do plano{' '}
            <strong>{payload?.planLimits.planName}</strong> foi atingido.
          </span>
          <Link
            href="/configuracoes"
            className="font-semibold text-emerald-700 hover:underline whitespace-nowrap"
          >
            Gerenciar plano em Configurações
          </Link>
        </div>
      )}

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
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold text-emerald-800 hover:underline whitespace-nowrap"
          >
            Ok
          </button>
        </div>
      )}

      {/* Search & Operational Status Filter */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, CPF, telefone, documento ou responsável..."
              aria-label="Buscar pacientes"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredPatients.length}{' '}
            {filteredPatients.length === 1 ? 'registro exibido' : 'registros exibidos'}
          </span>
        </div>

        <div
          role="tablist"
          aria-label="Filtrar por situação operacional"
          className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Todos</span>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {totalPatients}
            </span>
          </button>

          {PATIENT_STATUS_LIST.map((st) => (
            <button
              key={st}
              type="button"
              role="tab"
              aria-selected={statusFilter === st}
              onClick={() => setStatusFilter(st)}
              className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{PATIENT_STATUS_META[st].label}</span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {payload?.countsByStatus[st] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Directory Table */}
      {filteredPatients.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <Users
            className="mx-auto h-8 w-8 text-slate-300"
            aria-hidden="true"
          />
          <h2 className="mt-3 text-base font-semibold text-slate-900">
            {totalPatients === 0
              ? 'Nenhum paciente cadastrado nesta clínica'
              : 'Nenhum paciente encontrado com os filtros atuais'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {totalPatients === 0
              ? 'Cadastre o primeiro paciente para iniciar o histórico longitudinal e o controle de atendimentos.'
              : 'Tente buscar por outro nome, CPF ou altere o filtro de situação operacional.'}
          </p>
          {totalPatients === 0 && !limitReached && (
            <button
              type="button"
              onClick={() => {
                setEditingPatient(null);
                setModalOpen(true);
              }}
              className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Cadastrar primeiro paciente
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3">Paciente</th>
                <th className="px-4 py-3">Identificação</th>
                <th className="px-4 py-3">Contatos e emergência</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPatients.map((patient) => {
                const statusMeta = PATIENT_STATUS_META[patient.status];
                const cpfDisplay = patient.cpf
                  ? formatCpf(patient.cpf)
                  : patient.cpf_digits
                    ? formatCpf(patient.cpf_digits)
                    : null;

                return (
                  <tr
                    key={patient.id}
                    className="transition-colors hover:bg-slate-50/70"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/pacientes/${patient.id}`}
                        className="font-semibold text-slate-900 hover:text-emerald-700 hover:underline"
                      >
                        {patient.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {patient.social_name
                          ? `Nome social: ${patient.social_name}`
                          : patient.birth_date
                            ? `Nasc.: ${new Date(
                                `${patient.birth_date}T12:00:00`
                              ).toLocaleDateString('pt-BR')}`
                            : 'Cadastro clínico'}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-700">
                      {cpfDisplay ? (
                        <div className="font-mono tabular-nums">
                          CPF {cpfDisplay}
                        </div>
                      ) : (
                        <div className="text-slate-600">
                          Sem CPF
                          {patient.alt_identifier_value
                            ? ` · ${patient.alt_identifier_type || 'Doc.'} ${patient.alt_identifier_value}`
                            : ''}
                        </div>
                      )}
                      {patient.legal_guardian_name && (
                        <div className="mt-0.5 text-slate-500">
                          Resp.: {patient.legal_guardian_name}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="font-mono text-slate-700 tabular-nums">
                        {patient.phone || 'Sem telefone'}
                      </div>
                      <div className="mt-0.5 text-slate-500">
                        {patient.emergency_contact_name ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3 text-slate-400" aria-hidden="true" />
                            Emerg.: {patient.emergency_contact_name}
                            {patient.emergency_contact_phone
                              ? ` (${patient.emergency_contact_phone})`
                              : ''}
                          </span>
                        ) : (
                          patient.email || 'Sem contato de emergência'
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusMeta.textClass}`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {statusMeta.label}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <Link
                          href={`/pacientes/${patient.id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          Prontuário
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPatient(patient);
                            setModalOpen(true);
                          }}
                          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <PatientFormModal
          patient={editingPatient}
          existingPatients={payload?.patients ?? []}
          onClose={() => {
            setModalOpen(false);
            setEditingPatient(null);
          }}
          onSaved={(saved, isNew) => {
            setModalOpen(false);
            setEditingPatient(null);
            setNotice(
              isNew
                ? `Paciente ${saved.name} cadastrado com sucesso.`
                : `Dados de ${saved.name} atualizados e registrados na auditoria.`
            );
            void loadPatients();
          }}
          onOpenExistingPatient={(existingId) => {
            setModalOpen(false);
            router.push(`/pacientes/${existingId}`);
          }}
        />
      )}
    </div>
  );
}
