'use client';

import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Copy,
  Database,
  ExternalLink,
  FilePlus2,
  FileText,
  History,
  Lock,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import CorrectiveNoteModal from '@/components/patients/corrective-note-modal';
import PatientFormModal from '@/components/patients/patient-form-modal';
import PatientRecordModal from '@/components/patients/patient-record-modal';
import { APPOINTMENT_STATUS_META } from '@/lib/agenda/constants';
import {
  MEDICAL_RECORD_CATEGORIES,
  MEDICAL_RECORD_CATEGORY_META,
  PATIENT_STATUS_META,
  formatCpf,
  getRecordSubtypeLabel,
  isSafeHttpUrl,
} from '@/lib/patients/constants';
import type { AppointmentStatus } from '@/types/agenda';
import type {
  MedicalRecordCategory,
  MedicalRecordEntry,
  PatientDetailPayload,
} from '@/types/patients';

type DetailTab = 'timeline' | 'profile' | 'audit' | 'appointments';

export default function PatientDetailWorkspace({
  patientId,
}: {
  patientId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<PatientDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<DetailTab>('timeline');
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | MedicalRecordCategory
  >('all');
  const [timelineSearch, setTimelineSearch] = useState('');

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [recordModalState, setRecordModalState] = useState<{
    open: boolean;
    draft: MedicalRecordEntry | null;
    initialCategory?: MedicalRecordCategory;
  }>({ open: false, draft: null });
  const [addendumTarget, setAddendumTarget] =
    useState<MedicalRecordEntry | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/patients/${patientId}`, {
        cache: 'no-store',
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível carregar o prontuário.');
        return;
      }
      setPayload(data as PatientDetailPayload);
    } catch {
      setError('Falha de conexão ao carregar o prontuário.');
    } finally {
      setLoading(false);
    }
  }, [patientId, router]);

  useEffect(() => {
    void loadDetail();
    const handleOrgChanged = () => {
      router.push('/pacientes');
    };
    window.addEventListener('iatris:org-changed', handleOrgChanged);
    return () => {
      window.removeEventListener('iatris:org-changed', handleOrgChanged);
    };
  }, [loadDetail, router]);

  const filteredRecords = useMemo(() => {
    const records = payload?.records ?? [];
    const q = timelineSearch.trim().toLowerCase();
    return records.filter((rec) => {
      if (categoryFilter !== 'all' && rec.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        rec.title.toLowerCase().includes(q) ||
        rec.content.toLowerCase().includes(q) ||
        rec.author_name.toLowerCase().includes(q) ||
        rec.addenda.some(
          (ad) =>
            ad.content.toLowerCase().includes(q) ||
            ad.justification.toLowerCase().includes(q)
        )
      );
    });
  }, [payload?.records, categoryFilter, timelineSearch]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MedicalRecordCategory, number> = {
      clinical: 0,
      administrative: 0,
      document: 0,
    };
    for (const r of payload?.records ?? []) {
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    }
    return counts;
  }, [payload?.records]);

  async function handleCopySection7Sql() {
    try {
      const res = await fetch('/api/settings/sql?section=7');
      const data = await res.json();
      if (!res.ok || !data.sql) return;
      await navigator.clipboard.writeText(data.sql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      setError('Não foi possível copiar o script SQL da Seção 7.');
    }
  }

  async function handleDeleteDraft(recordId: string) {
    setDeletingDraftId(recordId);
    setError(null);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/records?recordId=${encodeURIComponent(recordId)}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível excluir o rascunho.');
        return;
      }
      setNotice('Rascunho excluído.');
      await loadDetail();
    } catch {
      setError('Falha de conexão ao excluir rascunho.');
    } finally {
      setDeletingDraftId(null);
    }
  }

  if (loading && !payload) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          href="/pacientes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para Pacientes
        </Link>
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        >
          {error ?? 'Paciente não encontrado.'}
        </div>
      </div>
    );
  }

  const { patient } = payload;
  const statusMeta = PATIENT_STATUS_META[patient.status];
  const cpfFormatted = patient.cpf
    ? formatCpf(patient.cpf)
    : patient.cpf_digits
      ? formatCpf(patient.cpf_digits)
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Breadcrumb Back Link */}
      <div>
        <Link
          href="/pacientes"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar para Pacientes
        </Link>
      </div>

      {/* Patient Summary Header */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span
                className={`inline-flex items-center gap-1.5 font-semibold ${statusMeta.textClass}`}
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {statusMeta.label}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {cpfFormatted
                  ? `CPF ${cpfFormatted}`
                  : patient.alt_identifier_value
                    ? `Sem CPF · ${patient.alt_identifier_type || 'Doc.'} ${patient.alt_identifier_value}`
                    : 'Cadastro sem CPF'}
              </span>
              {patient.birth_date && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Nasc.{' '}
                    {new Date(
                      `${patient.birth_date}T12:00:00`
                    ).toLocaleDateString('pt-BR')}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {patient.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              {patient.social_name && (
                <span>Nome social: {patient.social_name}</span>
              )}
              {patient.phone && (
                <span className="font-mono tabular-nums">
                  Tel.: {patient.phone}
                </span>
              )}
              {patient.email && <span>{patient.email}</span>}
              {patient.emergency_contact_name && (
                <span className="inline-flex items-center gap-1 text-slate-700">
                  <Phone className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  Emergência: {patient.emergency_contact_name}
                  {patient.emergency_contact_relationship
                    ? ` (${patient.emergency_contact_relationship})`
                    : ''}
                  {patient.emergency_contact_phone
                    ? ` · ${patient.emergency_contact_phone}`
                    : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar cadastro
            </button>

            <button
              type="button"
              disabled={payload.migrationPending}
              onClick={() =>
                setRecordModalState({
                  open: true,
                  draft: null,
                  initialCategory: payload.canAuthorClinical
                    ? 'clinical'
                    : 'administrative',
                })
              }
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo registro
            </button>
          </div>
        </div>
      </section>

      {payload.migrationPending && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm text-amber-950">
            <Database
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Atualização SQL necessária para gravar prontuário e auditoria
                (Seção 7)
              </p>
              <p className="mt-0.5 text-xs text-amber-900">
                Execute a Seção 7 do arquivo sql.md no Supabase SQL Editor para
                ativar os registros clínicos imutáveis e notas corretivas.
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

      {/* Primary Workspace Tabs */}
      <div
        role="tablist"
        aria-label="Seções do prontuário do paciente"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'timeline'}
          onClick={() => setActiveTab('timeline')}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'timeline'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          <span>Prontuário longitudinal</span>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {payload.records.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          onClick={() => setActiveTab('profile')}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'profile'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="h-4 w-4" aria-hidden="true" />
          <span>Dados cadastrais e emergência</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'audit'}
          onClick={() => setActiveTab('audit')}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'audit'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span>Histórico de alterações</span>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {payload.auditLogs.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'appointments'}
          onClick={() => setActiveTab('appointments')}
          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'appointments'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          <span>Agendamentos</span>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {payload.appointments.length}
          </span>
        </button>
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* TAB 1: LONGITUDINAL TIMELINE */}
        {activeTab === 'timeline' && (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>Todos</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {payload.records.length}
                  </span>
                </button>

                {MEDICAL_RECORD_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      categoryFilter === cat
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>{MEDICAL_RECORD_CATEGORY_META[cat].label}</span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {categoryCounts[cat]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:max-w-xs">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={timelineSearch}
                  onChange={(e) => setTimelineSearch(e.target.value)}
                  placeholder="Filtrar histórico ou notas..."
                  aria-label="Filtrar prontuário"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <Stethoscope
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhum registro encontrado nesta categoria
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Adicione avaliações fisioterapêuticas, evoluções, registros
                  administrativos ou documentos anexados para compor o prontuário
                  cronológico.
                </p>
                {!payload.migrationPending && (
                  <button
                    type="button"
                    onClick={() =>
                      setRecordModalState({
                        open: true,
                        draft: null,
                        initialCategory:
                          categoryFilter === 'all'
                            ? payload.canAuthorClinical
                              ? 'clinical'
                              : 'administrative'
                            : categoryFilter === 'clinical' &&
                                !payload.canAuthorClinical
                              ? 'administrative'
                              : categoryFilter,
                      })
                    }
                    className="mt-4 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Criar registro
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredRecords.map((rec) => {
                  const catMeta = MEDICAL_RECORD_CATEGORY_META[rec.category];
                  const subtypeLabel = getRecordSubtypeLabel(
                    rec.category,
                    rec.record_type
                  );
                  const canEditDraft =
                    !rec.is_finalized &&
                    (rec.author_user_id === payload.currentUserId ||
                      payload.isAdmin);
                  const canDeleteNonClinicalDraft =
                    !rec.is_finalized &&
                    rec.category !== 'clinical' &&
                    canEditDraft;

                  const safeExternalUrl =
                    rec.document_url && isSafeHttpUrl(rec.document_url)
                      ? rec.document_url
                      : null;

                  return (
                    <article
                      key={rec.id}
                      className="rounded-xl border border-slate-200 bg-white p-5"
                    >
                      {/* Clean zero-pill metadata header */}
                      <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${catMeta.accentClass}`}
                            >
                              {rec.category === 'clinical' ? (
                                <Stethoscope
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              ) : rec.category === 'document' ? (
                                <Paperclip
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              ) : (
                                <FileText
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              )}
                              {catMeta.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{subtypeLabel}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {new Date(rec.occurred_at).toLocaleString(
                                'pt-BR',
                                {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                }
                              )}
                            </span>
                            <span aria-hidden="true">·</span>
                            {rec.is_finalized ? (
                              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                                <Lock className="h-3 w-3" aria-hidden="true" />
                                Concluído e imutável
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                Rascunho editável
                              </span>
                            )}
                          </div>

                          <h2 className="text-base font-bold text-slate-900">
                            {rec.title}
                          </h2>
                          <p className="text-xs text-slate-500">
                            Registrado por{' '}
                            <span className="font-medium text-slate-700">
                              {rec.author_name}
                            </span>
                            {rec.author_email ? ` (${rec.author_email})` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {rec.is_finalized &&
                            rec.category === 'clinical' &&
                            payload.canAuthorClinical && (
                              <button
                                type="button"
                                onClick={() => setAddendumTarget(rec)}
                                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                              >
                                <FilePlus2
                                  className="h-3.5 w-3.5 text-emerald-700"
                                  aria-hidden="true"
                                />
                                Nota corretiva
                              </button>
                            )}

                          {canEditDraft && (
                            <button
                              type="button"
                              onClick={() =>
                                setRecordModalState({
                                  open: true,
                                  draft: rec,
                                })
                              }
                              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 whitespace-nowrap"
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              Editar / Concluir
                            </button>
                          )}

                          {canDeleteNonClinicalDraft && (
                            <button
                              type="button"
                              disabled={deletingDraftId === rec.id}
                              onClick={() => void handleDeleteDraft(rec.id)}
                              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Excluir rascunho
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                        {rec.content}
                      </div>

                      {/* Attached document links */}
                      {(rec.document_data_url || safeExternalUrl) && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
                          {rec.document_data_url && (
                            <a
                              href={rec.document_data_url}
                              download={rec.document_name || 'documento'}
                              className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"
                            >
                              <Paperclip
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Baixar anexo:{' '}
                              {rec.document_name || 'arquivo anexado'}
                              {rec.document_size_bytes
                                ? ` (${Math.max(1, Math.round(rec.document_size_bytes / 1024))} KB)`
                                : ''}
                            </a>
                          )}

                          {safeExternalUrl && (
                            <a
                              href={safeExternalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"
                            >
                              <ExternalLink
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Abrir documento externo
                            </a>
                          )}
                        </div>
                      )}

                      {/* Corrective Notes (Addenda) */}
                      {rec.addenda.length > 0 && (
                        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Notas corretivas ({rec.addenda.length})
                          </p>
                          {rec.addenda.map((ad) => (
                            <div
                              key={ad.id}
                              className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 text-xs text-slate-800"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                                <span className="font-semibold text-slate-900">
                                  Nota corretiva · {ad.author_name}
                                  {ad.author_email
                                    ? ` (${ad.author_email})`
                                    : ''}
                                </span>
                                <span className="font-mono tabular-nums">
                                  {new Date(ad.created_at).toLocaleString(
                                    'pt-BR',
                                    {
                                      dateStyle: 'short',
                                      timeStyle: 'short',
                                    }
                                  )}
                                </span>
                              </div>
                              <p className="mt-1.5 font-medium text-amber-950">
                                Justificativa: {ad.justification}
                              </p>
                              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-800">
                                {ad.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: REGISTRATION & EMERGENCY PROFILE */}
        {activeTab === 'profile' && (
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">
                Dados pessoais e identificação
              </h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Nome completo</dt>
                  <dd className="font-medium text-slate-900">{patient.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Nome social</dt>
                  <dd className="text-slate-700">
                    {patient.social_name || 'Não informado'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">CPF</dt>
                  <dd className="font-mono text-slate-900 tabular-nums">
                    {cpfFormatted || 'Paciente sem CPF'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">
                    Identificador alternativo
                  </dt>
                  <dd className="font-mono text-slate-700 tabular-nums">
                    {patient.alt_identifier_value
                      ? `${patient.alt_identifier_type || 'Doc.'}: ${patient.alt_identifier_value}`
                      : 'Não informado'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Data de nascimento</dt>
                  <dd className="font-mono text-slate-700 tabular-nums">
                    {patient.birth_date
                      ? new Date(
                          `${patient.birth_date}T12:00:00`
                        ).toLocaleDateString('pt-BR')
                      : 'Não informada'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Sexo / Gênero</dt>
                  <dd className="text-slate-700">
                    {patient.gender || 'Não informado'}
                  </dd>
                </div>
              </dl>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Responsável legal
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Nome</dt>
                    <dd className="text-slate-800">
                      {patient.legal_guardian_name || 'Não aplicável'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      Vínculo / Telefone
                    </dt>
                    <dd className="text-slate-700">
                      {patient.legal_guardian_relationship || '—'}
                      {patient.legal_guardian_phone
                        ? ` · ${patient.legal_guardian_phone}`
                        : ''}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-base font-bold text-slate-900">
                Contatos, endereço e emergência
              </h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Telefone principal</dt>
                  <dd className="font-mono text-slate-900 tabular-nums">
                    {patient.phone || 'Não informado'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">
                    Telefone secundário
                  </dt>
                  <dd className="font-mono text-slate-700 tabular-nums">
                    {patient.secondary_phone || 'Não informado'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">E-mail</dt>
                  <dd className="text-slate-700">
                    {patient.email || 'Não informado'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Endereço</dt>
                  <dd className="text-slate-700">
                    {patient.address_street
                      ? `${patient.address_street}${
                          patient.address_number
                            ? `, ${patient.address_number}`
                            : ''
                        }${
                          patient.address_complement
                            ? ` (${patient.address_complement})`
                            : ''
                        }${
                          patient.address_neighborhood
                            ? ` · ${patient.address_neighborhood}`
                            : ''
                        }${
                          patient.address_city
                            ? ` · ${patient.address_city}/${patient.address_state || ''}`
                            : ''
                        }${patient.address_zip ? ` · CEP ${patient.address_zip}` : ''}`
                      : 'Endereço não cadastrado'}
                  </dd>
                </div>
              </dl>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Contato de emergência
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Nome e vínculo</dt>
                    <dd className="font-medium text-slate-900">
                      {patient.emergency_contact_name
                        ? `${patient.emergency_contact_name}${
                            patient.emergency_contact_relationship
                              ? ` (${patient.emergency_contact_relationship})`
                              : ''
                          }`
                        : 'Não informado'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">
                      Telefone de emergência
                    </dt>
                    <dd className="font-mono text-slate-800 tabular-nums">
                      {patient.emergency_contact_phone || 'Não informado'}
                    </dd>
                  </div>
                </dl>
              </div>

              {patient.notes && (
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Observações administrativas
                  </h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {patient.notes}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <section className="rounded-xl border border-slate-200 bg-white">
            {payload.auditLogs.length === 0 ? (
              <div className="p-10 text-center">
                <History
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhuma alteração cadastral registrada ainda
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Alterações futuras no cadastro ou situação operacional do
                  paciente aparecerão aqui com usuário, data/hora e valores
                  anteriores.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {payload.auditLogs.map((log) => (
                  <div key={log.id} className="p-5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">
                        {log.action === 'created'
                          ? 'Cadastro criado'
                          : log.action === 'status_changed'
                            ? 'Situação operacional alterada'
                            : 'Dados cadastrais alterados'}{' '}
                        · {log.actor_name || log.actor_email || 'Sistema'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {new Date(log.created_at).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </div>

                    {log.reason && (
                      <p className="text-xs text-slate-600">
                        Motivo: {log.reason}
                      </p>
                    )}

                    {Array.isArray(log.changed_fields) &&
                      log.changed_fields.length > 0 && (
                        <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                          {log.changed_fields.map((cf, idx) => (
                            <div
                              key={`${log.id}-${cf.field}-${idx}`}
                              className="flex flex-wrap items-baseline gap-1.5"
                            >
                              <span className="font-semibold text-slate-800">
                                {cf.label}:
                              </span>
                              <span className="text-slate-500 line-through">
                                {cf.before ?? 'Vazio'}
                              </span>
                              <span aria-hidden="true">→</span>
                              <span className="font-medium text-emerald-800">
                                {cf.after ?? 'Vazio'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 4: LINKED APPOINTMENTS */}
        {activeTab === 'appointments' && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            {payload.appointments.length === 0 ? (
              <div className="p-10 text-center">
                <Calendar
                  className="mx-auto h-8 w-8 text-slate-300"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Nenhum agendamento vinculado
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Agende consultas e sessões na aba Agenda para acompanhar a
                  frequência deste paciente aqui.
                </p>
                <Link
                  href="/agenda"
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Abrir Agenda
                </Link>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                    <th className="px-4 py-3">Data e horário</th>
                    <th className="px-4 py-3">Profissional</th>
                    <th className="px-4 py-3">Especialidade</th>
                    <th className="px-4 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payload.appointments.map((appt) => {
                    const stMeta =
                      APPOINTMENT_STATUS_META[
                        appt.status as AppointmentStatus
                      ];
                    return (
                      <tr key={appt.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                          {new Date(appt.starts_at).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          {appt.professional_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {appt.specialty_name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-slate-700 whitespace-nowrap">
                          {stMeta?.label ?? appt.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </motion.div>

      {/* Modals */}
      {editModalOpen && (
        <PatientFormModal
          patient={patient}
          existingPatients={[patient]}
          onClose={() => setEditModalOpen(false)}
          onSaved={() => {
            setEditModalOpen(false);
            setNotice('Dados cadastrais atualizados com registro de auditoria.');
            void loadDetail();
          }}
          onOpenExistingPatient={(existingId) => {
            setEditModalOpen(false);
            if (existingId !== patient.id) {
              router.push(`/pacientes/${existingId}`);
            }
          }}
        />
      )}

      {recordModalState.open && (
        <PatientRecordModal
          patientId={patient.id}
          patientName={patient.name}
          canAuthorClinical={payload.canAuthorClinical}
          professionals={payload.professionals}
          draftRecord={recordModalState.draft}
          initialCategory={recordModalState.initialCategory}
          onClose={() => setRecordModalState({ open: false, draft: null })}
          onSaved={() => {
            setRecordModalState({ open: false, draft: null });
            setNotice('Registro salvo no prontuário longitudinal.');
            void loadDetail();
          }}
        />
      )}

      {addendumTarget && (
        <CorrectiveNoteModal
          patientId={patient.id}
          record={addendumTarget}
          onClose={() => setAddendumTarget(null)}
          onSaved={() => {
            setAddendumTarget(null);
            setNotice('Nota corretiva adicionada com rastreabilidade.');
            void loadDetail();
          }}
        />
      )}
    </div>
  );
}
