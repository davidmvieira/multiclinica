'use client';

import {
  AlertCircle,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileCheck2,
  FileText,
  Lock,
  Plus,
  Printer,
  Save,
  Share2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import {
  ADHERENCE_LABELS,
  CLINICAL_EVOLUTION_AUDIT_LABELS,
} from '@/lib/evolutions/server';
import type {
  ClinicalEvolutionAdherence,
  ClinicalEvolutionAuditEvent,
  ClinicalEvolutionRecord,
  EvolutionPendencyRecord,
  EvolutionRectificationRecord,
} from '@/types/evolutions';

interface EvolutionFormModalProps {
  mode: 'create' | 'view_edit';
  organizationName: string;
  timeZone: string;
  pendency: EvolutionPendencyRecord | null;
  initialEvolution: ClinicalEvolutionRecord | null;
  defaultAuthorName: string;
  defaultCouncilNumber: string | null;
  canAuthorClinical: boolean;
  auditEvents: ClinicalEvolutionAuditEvent[];
  onClose: () => void;
  onSaved: (evolution: ClinicalEvolutionRecord, message: string) => void;
  onDeleted: (evolutionId: string) => void;
  onOpenOfficialDossier: (patientId: string, patientName: string) => void;
  onAuditUpdated: (events: ClinicalEvolutionAuditEvent[]) => void;
}

const EVA_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RESTRICTED_CATEGORIES = [
  'Autor (Sigilo Exclusivo)',
  'Fisioterapia',
  'Psicologia',
  'Nutrição',
  'Sigilo Estrito LGPD',
];

function formatDateTime(iso: string | null | undefined, tz: string) {
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

export default function EvolutionFormModal({
  mode,
  organizationName,
  timeZone,
  pendency,
  initialEvolution,
  defaultAuthorName,
  defaultCouncilNumber,
  canAuthorClinical,
  auditEvents,
  onClose,
  onSaved,
  onDeleted,
  onOpenOfficialDossier,
  onAuditUpdated,
}: EvolutionFormModalProps) {
  const isFinalized = initialEvolution?.status === 'finalized';
  const viewerIsAuthor =
    mode === 'create' ? true : initialEvolution?.viewerIsAuthor ?? true;
  const canEdit = !isFinalized && viewerIsAuthor && canAuthorClinical;

  const appointmentId =
    initialEvolution?.appointment_id ?? pendency?.appointment_id ?? '';
  const patientId = initialEvolution?.patient_id ?? pendency?.patient_id ?? '';
  const patientName =
    initialEvolution?.patient_name ?? pendency?.patient_name ?? 'Paciente';
  const patientCpf =
    initialEvolution?.patient_cpf ?? pendency?.patient_cpf ?? null;
  const sessionStartsAt =
    initialEvolution?.appointment_starts_at ??
    pendency?.session_starts_at ??
    null;

  const [sharedClinicalNote, setSharedClinicalNote] = useState(
    initialEvolution?.shared_clinical_note ?? ''
  );
  const [proceduresPerformed, setProceduresPerformed] = useState(
    initialEvolution?.procedures_performed ?? ''
  );
  const [patientResponse, setPatientResponse] = useState(
    initialEvolution?.patient_response ?? ''
  );
  const [evaBefore, setEvaBefore] = useState<number | null>(
    initialEvolution?.eva_before ?? null
  );
  const [evaAfter, setEvaAfter] = useState<number | null>(
    initialEvolution?.eva_after ?? null
  );
  const [adherenceLevel, setAdherenceLevel] =
    useState<ClinicalEvolutionAdherence | null>(
      initialEvolution?.adherence_level ?? 'total'
    );
  const [nextSessionPlan, setNextSessionPlan] = useState(
    initialEvolution?.next_session_plan ?? ''
  );
  const [restrictedClinicalRecord, setRestrictedClinicalRecord] = useState(
    initialEvolution?.restricted_clinical_record ?? ''
  );
  const [restrictedCategory, setRestrictedCategory] = useState(
    initialEvolution?.restricted_category ?? 'Autor (Sigilo Exclusivo)'
  );
  const [authorCouncilNumber, setAuthorCouncilNumber] = useState(
    initialEvolution?.author_council_number ?? defaultCouncilNumber ?? ''
  );

  // Rectification state
  const [rectifications, setRectifications] = useState<
    EvolutionRectificationRecord[]
  >(() => initialEvolution?.rectifications ?? []);
  const [rectFormOpen, setRectFormOpen] = useState(false);
  const [rectJustification, setRectJustification] = useState('');
  const [rectContent, setRectContent] = useState('');
  const [savingRect, setSavingRect] = useState(false);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

  async function handleSave(finalize: boolean) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const url =
        mode === 'create' || !initialEvolution
          ? '/api/evolutions'
          : `/api/evolutions/${initialEvolution.id}`;
      const method = mode === 'create' || !initialEvolution ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          sharedClinicalNote,
          proceduresPerformed,
          patientResponse,
          evaBefore,
          evaAfter,
          adherenceLevel,
          nextSessionPlan,
          restrictedClinicalRecord,
          restrictedCategory,
          authorCouncilNumber,
          finalize,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar a evolução.');
        return;
      }

      const saved = data.evolution as ClinicalEvolutionRecord;
      const msg = finalize
        ? 'Evolução concluída, assinada e pendência baixada da fila.'
        : 'Rascunho de evolução salvo com sucesso.';
      onSaved(saved, msg);
    } catch {
      setError('Falha de comunicação ao salvar a evolução.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft() {
    if (!initialEvolution || isFinalized || !viewerIsAuthor) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/evolutions/${initialEvolution.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível excluir o rascunho.');
        return;
      }
      onDeleted(initialEvolution.id);
    } catch {
      setError('Erro de conexão ao excluir rascunho.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleSubmitRectification() {
    if (!initialEvolution || !isFinalized) return;
    setSavingRect(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/evolutions/${initialEvolution.id}/rectifications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            justification: rectJustification,
            rectifiedContent: rectContent,
            authorCouncilNumber,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível adicionar Nota de Retificação.');
        return;
      }

      const created = data.rectification as EvolutionRectificationRecord;
      setRectifications((prev) => [...prev, created]);
      setRectFormOpen(false);
      setRectJustification('');
      setRectContent('');
      setNotice(
        'Nota de Retificação registrada de forma imutável mantendo o texto original intacto.'
      );
    } catch {
      setError('Falha de conexão ao salvar Nota de Retificação.');
    } finally {
      setSavingRect(false);
    }
  }

  async function handleTrackedAction(action: 'EXPORT_PDF' | 'SHARE_SUMMARY') {
    if (!initialEvolution || !isFinalized) return;
    setError(null);
    try {
      const res = await fetch(`/api/evolutions/${initialEvolution.id}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao registrar evento LGPD.');
        return;
      }
      if (Array.isArray(data.auditEvents)) {
        onAuditUpdated(data.auditEvents as ClinicalEvolutionAuditEvent[]);
      }
      if (action === 'EXPORT_PDF') {
        setNotice('Evento EXPORT_PDF registrado na auditoria LGPD.');
        setTimeout(() => window.print(), 120);
      } else if (action === 'SHARE_SUMMARY' && typeof data.shareText === 'string') {
        setSharePreview(data.shareText);
        try {
          await navigator.clipboard.writeText(data.shareText);
          setCopiedShare(true);
          setTimeout(() => setCopiedShare(false), 3000);
        } catch {
          // Preview remains visible
        }
        setNotice('Resumo SharedClinicalNote gerado e auditado.');
      }
    } catch {
      setError('Erro ao acionar auditoria LGPD.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:static print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evolution-modal-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white print:max-h-none print:overflow-visible print:rounded-none print:border-0">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="evolution-modal-title"
                className="text-base font-bold text-slate-900"
              >
                Evolução Clínica Diária — {patientName}
              </h2>
              {isFinalized ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  <Lock className="h-3 w-3" />
                  Concluída e imutável
                </span>
              ) : (
                <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  Rascunho do autor
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              {organizationName}
              {patientCpf ? ` · CPF ${patientCpf}` : ''} · Atendimento (Encounter):{' '}
              <span className="font-mono font-medium text-slate-800 tabular-nums">
                {formatDateTime(sessionStartsAt, timeZone)}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 print:hidden"
            aria-label="Fechar janela de evolução"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6 print:overflow-visible">
          {/* Encounter & Financial Independence Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck2 className="h-4 w-4 text-emerald-600" />
              Sessão vinculada com status <strong>Realizado</strong>
              {pendency?.service_name ? ` · ${pendency.service_name}` : ''}
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Registro clínico independente de pendências financeiras
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-900 print:hidden">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900 print:hidden">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{notice}</span>
            </div>
          )}

          {sharePreview && (
            <div className="rounded-lg border border-emerald-200 bg-white p-4 space-y-2 print:hidden">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">
                  Resumo compartilhável (SharedClinicalNote — sem dados restritos)
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(sharePreview);
                    setCopiedShare(true);
                    setTimeout(() => setCopiedShare(false), 3000);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {copiedShare ? (
                    <Check className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <ClipboardCopy className="h-3 w-3" />
                  )}
                  {copiedShare ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
                {sharePreview}
              </pre>
            </div>
          )}

          {/* SharedClinicalNote Section */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-bold text-slate-900">
                Linha do Tempo Compartilhada (SharedClinicalNote)
              </h3>
              <p className="text-xs text-slate-500">
                Visível aos profissionais da clínica que atendem o paciente (princípio da minimização LGPD).
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Evolução Clínica / Quadro Atual <span className="text-rose-600">*</span>
              </label>
              <textarea
                rows={4}
                disabled={!canEdit}
                value={sharedClinicalNote}
                onChange={(e) => setSharedClinicalNote(e.target.value)}
                placeholder="Descreva a evolução funcional na sessão, estado álgico, ganhos observados e intercorrências clínicas..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Condutas e Recursos Terapêuticos Aplicados
                </label>
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  value={proceduresPerformed}
                  onChange={(e) => setProceduresPerformed(e.target.value)}
                  placeholder="Cinesioterapia, terapia manual, eletrotermofototerapia, treino de marcha..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Resposta Clínica e Tolerância ao Esforço
                </label>
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  value={patientResponse}
                  onChange={(e) => setPatientResponse(e.target.value)}
                  placeholder="Boa tolerância, sem sinais de fadiga excessiva..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  EVA Pré-Sessão (0–10)
                </label>
                <select
                  disabled={!canEdit}
                  value={evaBefore === null ? '' : String(evaBefore)}
                  onChange={(e) =>
                    setEvaBefore(
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 disabled:bg-slate-50"
                >
                  <option value="">Não aferida</option>
                  {EVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}/10
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  EVA Pós-Sessão (0–10)
                </label>
                <select
                  disabled={!canEdit}
                  value={evaAfter === null ? '' : String(evaAfter)}
                  onChange={(e) =>
                    setEvaAfter(
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 disabled:bg-slate-50"
                >
                  <option value="">Não aferida</option>
                  {EVA_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}/10
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Adesão Terapêutica
                </label>
                <select
                  disabled={!canEdit}
                  value={adherenceLevel ?? ''}
                  onChange={(e) =>
                    setAdherenceLevel(
                      (e.target.value || null) as ClinicalEvolutionAdherence | null
                    )
                  }
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 disabled:bg-slate-50"
                >
                  <option value="">Não informada</option>
                  {(
                    Object.keys(ADHERENCE_LABELS) as ClinicalEvolutionAdherence[]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {ADHERENCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-800">
                Planejamento para Próxima Sessão
              </label>
              <input
                type="text"
                disabled={!canEdit}
                value={nextSessionPlan}
                onChange={(e) => setNextSessionPlan(e.target.value)}
                placeholder="Progredir carga excêntrica, reavaliar ADM..."
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
              />
            </div>
          </section>

          {/* RestrictedClinicalRecord Section */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Registro Restrito (RestrictedClinicalRecord — Sigilo LGPD)
                </h3>
                <p className="text-xs text-slate-600">
                  Ocultado no servidor para outros perfis; visível apenas ao autor ou categoria profissional habilitada.
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                <Lock className="h-3 w-3" />
                Sigilo Estrito
              </span>
            </div>

            {initialEvolution?.restrictedRecordHidden ? (
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
                Esta evolução contém anotações confidenciais em{' '}
                <strong>{initialEvolution.restricted_category || 'Sigilo Estrito'}</strong>, reservadas exclusivamente ao profissional autor responsável.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-800">
                    Escopo de Acesso do Registro Restrito
                  </label>
                  <select
                    disabled={!canEdit}
                    value={restrictedCategory}
                    onChange={(e) => setRestrictedCategory(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 disabled:bg-slate-100"
                  >
                    {RESTRICTED_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  rows={3}
                  disabled={!canEdit}
                  value={restrictedClinicalRecord}
                  onChange={(e) => setRestrictedClinicalRecord(e.target.value)}
                  placeholder="Observações sigilosas reservadas ao autor (opcional)..."
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-100"
                />
              </div>
            )}
          </section>

          {/* Author Signature Block */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[11px] font-medium text-slate-500">
                Profissional Autor
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-900">
                {initialEvolution?.author_name ?? defaultAuthorName}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                Conselho (CREFITO) <span className="text-rose-600">*</span>
              </label>
              {canEdit ? (
                <input
                  type="text"
                  value={authorCouncilNumber}
                  onChange={(e) => setAuthorCouncilNumber(e.target.value)}
                  placeholder="CREFITO-3/000000-F"
                  className="mt-1 h-8 w-full rounded border border-slate-200 px-2 font-mono text-xs text-slate-900"
                />
              ) : (
                <p className="mt-1 font-mono text-xs font-semibold text-slate-900">
                  {authorCouncilNumber || '—'}
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">
                Conclusão (UTC)
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-800 tabular-nums">
                {initialEvolution?.finalized_at_utc ?? 'Aguardando conclusão'}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500">
                IP de Autoria
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-700 tabular-nums">
                {initialEvolution?.source_ip ?? 'Capturado no servidor'}
              </p>
            </div>
          </section>

          {/* Traceable Rectification Notes (for finalized evolutions) */}
          {isFinalized && initialEvolution && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Notas de Retificação Rastreáveis (Adendos Imutáveis)
                  </h3>
                  <p className="text-xs text-slate-500">
                    O texto original permanece intocado; retificações registram novo conteúdo, justificativa, autor e timestamp UTC.
                  </p>
                </div>
                {canAuthorClinical && !rectFormOpen && (
                  <button
                    type="button"
                    onClick={() => setRectFormOpen(true)}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100 print:hidden"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar Nota de Retificação
                  </button>
                )}
              </div>

              {rectFormOpen && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 space-y-3 print:hidden">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-900">
                        Justificativa da Retificação{' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={rectJustification}
                        onChange={(e) => setRectJustification(e.target.value)}
                        placeholder="Ex.: Correção de parâmetro de EVA aferido em ficha..."
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-slate-900">
                        Conselho Profissional (CREFITO){' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={authorCouncilNumber}
                        onChange={(e) => setAuthorCouncilNumber(e.target.value)}
                        placeholder="CREFITO-3/000000-F"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-900">
                      Conteúdo Retificado / Adendo{' '}
                      <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={rectContent}
                      onChange={(e) => setRectContent(e.target.value)}
                      placeholder="Descreva a retificação complementar mantendo o contexto clínico..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setRectFormOpen(false)}
                      className="h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={savingRect}
                      onClick={() => void handleSubmitRectification()}
                      className="h-8 cursor-pointer rounded-lg bg-amber-600 px-3.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      {savingRect ? 'Assinando...' : 'Assinar Nota de Retificação'}
                    </button>
                  </div>
                </div>
              )}

              {rectifications.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Nenhuma Nota de Retificação registrada para esta evolução.
                </p>
              ) : (
                <div className="space-y-2">
                  {rectifications.map((rect) => (
                    <div
                      key={rect.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-amber-950">
                          {rect.author_name} ({rect.author_council_number || '—'})
                        </span>
                        <span className="font-mono text-[11px] text-amber-900 tabular-nums">
                          {rect.created_at_utc} UTC · IP {rect.source_ip}
                        </span>
                      </div>
                      <p className="text-amber-900">
                        <strong>Justificativa:</strong> {rect.justification}
                      </p>
                      <p className="whitespace-pre-line text-amber-950">
                        {rect.rectified_content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Per-Evolution Audit Trail */}
          {initialEvolution && auditEvents.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print:hidden">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Auditoria da Evolução (AuditEvent LGPD)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1.5 pr-3">Timestamp UTC</th>
                      <th className="py-1.5 pr-3">Ação</th>
                      <th className="py-1.5 pr-3">Usuário</th>
                      <th className="py-1.5">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td className="py-1.5 pr-3 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                          {ev.timestamp_utc}
                        </td>
                        <td className="py-1.5 pr-3 font-medium text-slate-900">
                          {CLINICAL_EVOLUTION_AUDIT_LABELS[ev.action_executed] ??
                            ev.action_executed}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-700">
                          {ev.user_name || ev.user_email}
                        </td>
                        <td className="py-1.5 font-mono text-slate-600 tabular-nums">
                          {ev.source_ip}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5 print:hidden">
          <button
            type="button"
            onClick={() => onOpenOfficialDossier(patientId, patientName)}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100"
          >
            <FileText className="h-3.5 w-3.5 text-emerald-600" />
            Exportar Prontuário Oficial do Paciente
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {isFinalized ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleTrackedAction('SHARE_SUMMARY')}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Compartilhar resumo LGPD
                </button>
                <button
                  type="button"
                  onClick={() => void handleTrackedAction('EXPORT_PDF')}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir PDF da Evolução
                </button>
              </>
            ) : canEdit ? (
              <>
                {mode === 'view_edit' && initialEvolution && (
                  confirmDelete ? (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1">
                      <span className="text-xs font-medium text-rose-800">
                        Excluir rascunho?
                      </span>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteDraft()}
                        className="cursor-pointer rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white"
                      >
                        Sim
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-slate-700"
                      >
                        Não
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir rascunho
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave(false)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave(true)}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  <FileCheck2 className="h-3.5 w-3.5" />
                  {saving ? 'Concluindo...' : 'Concluir e assinar evolução'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
