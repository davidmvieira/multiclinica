'use client';

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCopy,
  FileCheck2,
  FileText,
  Lock,
  Printer,
  Save,
  Share2,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import OfficialDossierModal from '@/components/clinical/official-dossier-modal';

import {
  CBDF_CATALOG,
  EVALUATION_AUDIT_ACTION_LABELS,
  PROCEDURE_CODE_SUGGESTIONS,
} from '@/lib/evaluations/templates-catalog';
import type {
  EvaluationAnswerValue,
  EvaluationAuditEvent,
  EvaluationPatientOption,
  EvaluationRecord,
  EvaluationSectionDefinition,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

interface EvaluationFormRendererProps {
  mode: 'create' | 'view_edit';
  organizationName: string;
  patient: EvaluationPatientOption;
  templateId: string;
  templateName: string;
  templateVersion: EvaluationTemplateVersionRecord;
  initialEvaluation: EvaluationRecord | null;
  defaultAuthorName: string;
  defaultCouncilNumber: string | null;
  canAuthorClinical: boolean;
  auditEvents: EvaluationAuditEvent[];
  onBack: () => void;
  onSaved: (
    evaluation: EvaluationRecord,
    version: EvaluationTemplateVersionRecord,
    message: string
  ) => void;
  onDeleted: (evaluationId: string) => void;
  onAuditUpdated: (events: EvaluationAuditEvent[]) => void;
}

const EVA_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MRC_SCALE = [
  { value: 0, label: '0 — Sem contração' },
  { value: 1, label: '1 — Esboço' },
  { value: 2, label: '2 — Sem gravidade' },
  { value: 3, label: '3 — Contra gravidade' },
  { value: 4, label: '4 — Resistência mod.' },
  { value: 5, label: '5 — Normal' },
];

export default function EvaluationFormRenderer({
  mode,
  organizationName,
  patient,
  templateId,
  templateName,
  templateVersion,
  initialEvaluation,
  defaultAuthorName,
  defaultCouncilNumber,
  canAuthorClinical,
  auditEvents,
  onBack,
  onSaved,
  onDeleted,
  onAuditUpdated,
}: EvaluationFormRendererProps) {
  const isFinalized = initialEvaluation?.status === 'finalized';
  const viewerIsAuthor =
    mode === 'create'
      ? true
      : initialEvaluation?.viewerIsAuthor ?? true;
  const canEdit = !isFinalized && viewerIsAuthor && canAuthorClinical;

  const [answers, setAnswers] = useState<Record<string, EvaluationAnswerValue>>(
    () => initialEvaluation?.answers ?? {}
  );
  const [sharedSummary, setSharedSummary] = useState(
    initialEvaluation?.shared_summary ?? ''
  );
  const [functionalDiagnosis, setFunctionalDiagnosis] = useState(
    initialEvaluation?.functional_diagnosis ?? ''
  );
  const [cbdfCode, setCbdfCode] = useState(
    initialEvaluation?.cbdf_code ?? ''
  );
  const [cbdfDescription, setCbdfDescription] = useState(
    initialEvaluation?.cbdf_description ?? ''
  );
  const [procedureCode, setProcedureCode] = useState(
    initialEvaluation?.procedure_code ?? ''
  );
  const [procedureDescription, setProcedureDescription] = useState(
    initialEvaluation?.procedure_description ?? ''
  );
  const [authorCouncilNumber, setAuthorCouncilNumber] = useState(
    initialEvaluation?.author_council_number ?? defaultCouncilNumber ?? ''
  );

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<string | null>(null);
  const [officialExportOpen, setOfficialExportOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  const orderedSections = useMemo<EvaluationSectionDefinition[]>(() => {
    const sections = templateVersion.schema_json?.sections ?? [];
    return [...sections].sort((a, b) => a.order - b.order);
  }, [templateVersion.schema_json]);

  const restrictedSet = useMemo(
    () => new Set(initialEvaluation?.restrictedSectionIds ?? []),
    [initialEvaluation?.restrictedSectionIds]
  );

  function setFieldValue(fieldId: string, value: EvaluationAnswerValue) {
    if (!canEdit) return;
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  function toggleMultiselectOption(fieldId: string, option: string) {
    if (!canEdit) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[fieldId]) ? (prev[fieldId] as string[]) : [];
      const exists = current.includes(option);
      const next = exists
        ? current.filter((item) => item !== option)
        : [...current, option];
      return { ...prev, [fieldId]: next };
    });
  }

  async function handleSave(finalize: boolean) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setMissingFields([]);
    setNotice(null);

    const payload = {
      patientId: patient.id,
      templateId,
      templateVersionId: templateVersion.id,
      answers,
      sharedSummary,
      functionalDiagnosis,
      cbdfCode,
      cbdfDescription,
      procedureCode,
      procedureDescription,
      authorCouncilNumber,
      finalize,
    };

    try {
      const url =
        mode === 'create' || !initialEvaluation
          ? '/api/evaluations'
          : `/api/evaluations/${initialEvaluation.id}`;
      const method = mode === 'create' || !initialEvaluation ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar a avaliação.');
        if (Array.isArray(data.missingFields)) {
          setMissingFields(data.missingFields);
        }
        return;
      }

      const savedEval = data.evaluation as EvaluationRecord;
      const savedVer = (data.templateVersion ??
        templateVersion) as EvaluationTemplateVersionRecord;

      const message = finalize
        ? 'Avaliação concluída, assinada e bloqueada para edição no prontuário.'
        : 'Rascunho clínico salvo com sucesso.';

      setNotice(message);
      onSaved(savedEval, savedVer, message);
    } catch {
      setError('Falha de comunicação ao salvar a avaliação clínica.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDraft() {
    if (!initialEvaluation || isFinalized || !viewerIsAuthor) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/evaluations/${initialEvaluation.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível excluir o rascunho.');
        return;
      }
      onDeleted(initialEvaluation.id);
    } catch {
      setError('Erro de conexão ao excluir o rascunho.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleTrackedAction(action: 'EXPORT_PDF' | 'SHARE_SUMMARY') {
    if (!initialEvaluation || !isFinalized) return;
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/evaluations/${initialEvaluation.id}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível registrar o evento LGPD.');
        return;
      }

      if (Array.isArray(data.auditEvents)) {
        onAuditUpdated(data.auditEvents as EvaluationAuditEvent[]);
      }

      if (action === 'EXPORT_PDF') {
        setNotice(
          'Evento EXPORT_PDF registrado na auditoria LGPD. Abrindo visualização de impressão.'
        );
        setTimeout(() => {
          window.print();
        }, 120);
      } else if (action === 'SHARE_SUMMARY' && typeof data.shareText === 'string') {
        setSharePreview(data.shareText);
        try {
          await navigator.clipboard.writeText(data.shareText);
          setCopiedShare(true);
          setTimeout(() => setCopiedShare(false), 3000);
        } catch {
          // Clipboard permission optional; inline preview remains visible
        }
        setNotice(
          'Resumo minimizado (LGPD) gerado e evento SHARE_SUMMARY registrado na auditoria.'
        );
      }
    } catch {
      setError('Falha ao registrar ação de governança LGPD.');
    }
  }

  const authorNameDisplay =
    initialEvaluation?.author_name ?? defaultAuthorName;

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between print:border-slate-300">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600 transition-colors hover:text-slate-900 print:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Voltar para lista de avaliações
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {templateName}
            </h2>
            <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-medium text-slate-700 tabular-nums">
              v{templateVersion.version_number}
            </span>
            {isFinalized ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Concluída e imutável
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                Rascunho (editável pelo autor)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600">
            Clínica: <span className="font-medium text-slate-800">{organizationName}</span> ·
            Paciente: <span className="font-semibold text-slate-900">{patient.name}</span>
            {patient.cpf ? (
              <span className="font-mono text-slate-500"> ({patient.cpf})</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {isFinalized ? (
            <>
              <button
                type="button"
                onClick={() => void handleTrackedAction('SHARE_SUMMARY')}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                Compartilhar resumo LGPD
              </button>
              <button
                type="button"
                onClick={() => void handleTrackedAction('EXPORT_PDF')}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Exportar PDF
              </button>
              <button
                type="button"
                onClick={() => setOfficialExportOpen(true)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 whitespace-nowrap"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Prontuário Oficial
              </button>
            </>
          ) : canEdit ? (
            <>
              {mode === 'view_edit' && initialEvaluation && (
                confirmDelete ? (
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1">
                    <span className="text-xs font-medium text-rose-800">
                      Excluir rascunho?
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteDraft()}
                      className="cursor-pointer rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Excluir rascunho
                  </button>
                )
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(false)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Salvar rascunho
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(true)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap"
              >
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                {saving ? 'Concluindo...' : 'Concluir avaliação'}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Notices & Validation Feedback */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 print:hidden"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div className="space-y-1.5">
              <p className="font-semibold">{error}</p>
              {missingFields.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-rose-800">
                  {missingFields.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 print:hidden">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {!viewerIsAuthor && isFinalized && (
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
          <div>
            <p className="font-semibold text-slate-900">
              Visualização Multiprofissional com Minimização de Exposição (LGPD)
            </p>
            <p className="mt-0.5 text-slate-600">
              Você está consultando o diagnóstico funcional, código CBDF e parâmetros objetivos desta avaliação. Seções de anamnese confidencial permanecem ocultas e exclusivas ao fisioterapeuta responsável ({authorNameDisplay}).
            </p>
          </div>
        </div>
      )}

      {sharePreview && (
        <div className="rounded-xl border border-emerald-200 bg-white p-4 space-y-2 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">
              Resumo clínico minimizado para compartilhamento (LGPD)
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(sharePreview);
                  setCopiedShare(true);
                  setTimeout(() => setCopiedShare(false), 3000);
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {copiedShare ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <ClipboardCopy className="h-3.5 w-3.5" />
                )}
                {copiedShare ? 'Copiado' : 'Copiar texto'}
              </button>
              <button
                type="button"
                onClick={() => setSharePreview(null)}
                className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
            {sharePreview}
          </pre>
        </div>
      )}

      {/* Template Homologation Note & Historical Binding */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">
          Fidelidade ao modelo v{templateVersion.version_number}:
        </span>{' '}
        {templateVersion.schema_json.homologationNote}
        {templateVersion.changelog ? ` · ${templateVersion.changelog}` : ''}
      </div>

      {/* Ordered Clinical Sections */}
      <div className="space-y-5">
        {orderedSections.map((section) => {
          const isRestrictedBlocked =
            section.is_restricted_to_author &&
            (!viewerIsAuthor || restrictedSet.has(section.id));

          return (
            <section
              key={section.id}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    {section.title}
                  </h3>
                  {section.description && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {section.description}
                    </p>
                  )}
                </div>
                {section.is_restricted_to_author && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                    <Lock className="h-3 w-3 text-slate-500" aria-hidden="true" />
                    Restrito ao autor (LGPD)
                  </span>
                )}
              </div>

              {isRestrictedBlocked ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
                  Seção protegida por sigilo clínico profissional (LGPD Art. 11). Visível apenas para o fisioterapeuta autor responsável pela avaliação.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {section.fields.map((field) => {
                    const value = answers[field.id];
                    const isWide =
                      field.type === 'textarea' ||
                      field.type === 'scale_eva' ||
                      field.type === 'scale_mrc' ||
                      field.type === 'multiselect';

                    return (
                      <div
                        key={field.id}
                        className={isWide ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}
                      >
                        <label className="block text-xs font-semibold text-slate-800">
                          {field.label}
                          {field.required && (
                            <span className="ml-1 text-rose-600">*</span>
                          )}
                          {field.unit && (
                            <span className="ml-1.5 font-mono font-normal text-slate-500">
                              ({field.unit})
                            </span>
                          )}
                        </label>

                        {field.type === 'textarea' && (
                          <textarea
                            rows={3}
                            disabled={!canEdit}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) =>
                              setFieldValue(field.id, e.target.value)
                            }
                            placeholder={field.placeholder}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-700"
                          />
                        )}

                        {field.type === 'text' && (
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) =>
                              setFieldValue(field.id, e.target.value)
                            }
                            placeholder={field.placeholder}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-700"
                          />
                        )}

                        {field.type === 'date' && (
                          <input
                            type="date"
                            disabled={!canEdit}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) =>
                              setFieldValue(field.id, e.target.value)
                            }
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-700"
                          />
                        )}

                        {field.type === 'number' && (
                          <input
                            type="number"
                            disabled={!canEdit}
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 'any'}
                            value={typeof value === 'number' ? value : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setFieldValue(
                                field.id,
                                raw === '' ? null : Number(raw)
                              );
                            }}
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-700"
                          />
                        )}

                        {field.type === 'select' && (
                          <select
                            disabled={!canEdit}
                            value={typeof value === 'string' ? value : ''}
                            onChange={(e) =>
                              setFieldValue(field.id, e.target.value)
                            }
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-700"
                          >
                            <option value="">Selecione...</option>
                            {(field.options ?? []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.type === 'boolean' && (
                          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                            {[
                              { label: 'Sim', val: true },
                              { label: 'Não', val: false },
                            ].map((opt) => {
                              const active = value === opt.val;
                              return (
                                <button
                                  key={opt.label}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() =>
                                    setFieldValue(field.id, opt.val)
                                  }
                                  className={`cursor-pointer rounded-md px-4 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default ${
                                    active
                                      ? 'bg-emerald-600 text-white'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {field.type === 'multiselect' && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(field.options ?? []).map((opt) => {
                              const selected =
                                Array.isArray(value) && value.includes(opt);
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() =>
                                    toggleMultiselectOption(field.id, opt)
                                  }
                                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors disabled:cursor-default ${
                                    selected
                                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                      selected
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : 'border-slate-300 bg-white'
                                    }`}
                                  >
                                    {selected && <Check className="h-3 w-3" />}
                                  </span>
                                  <span>{opt}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {field.type === 'scale_eva' && (
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap gap-1.5">
                              {EVA_SCALE.map((score) => {
                                const active = value === score;
                                const activeTone =
                                  score <= 3
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : score <= 6
                                      ? 'border-amber-500 bg-amber-500 text-white'
                                      : 'border-rose-600 bg-rose-600 text-white';
                                return (
                                  <button
                                    key={score}
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => setFieldValue(field.id, score)}
                                    className={`h-9 w-9 cursor-pointer rounded-lg border font-mono text-xs font-semibold tabular-nums transition-colors disabled:cursor-default ${
                                      active
                                        ? activeTone
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {score}
                                  </button>
                                );
                              })}
                              <span className="ml-2 inline-flex items-center font-mono text-xs font-medium text-slate-600 tabular-nums">
                                {typeof value === 'number'
                                  ? `Nota: ${value}/10`
                                  : 'Sem pontuação'}
                              </span>
                            </div>
                          </div>
                        )}

                        {field.type === 'scale_mrc' && (
                          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-6">
                            {MRC_SCALE.map((item) => {
                              const active = value === item.value;
                              return (
                                <button
                                  key={item.value}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() =>
                                    setFieldValue(field.id, item.value)
                                  }
                                  className={`cursor-pointer rounded-lg border px-2 py-2 text-left text-xs font-medium tabular-nums transition-colors disabled:cursor-default ${
                                    active
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {field.helpText && (
                          <p className="text-xs text-slate-500">
                            {field.helpText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Diagnóstico Fisioterapêutico & CBDF (strictly separated from Billing/Procedure) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">
            Diagnóstico Fisioterapêutico e Classificação CBDF
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            O diagnóstico clínico funcional (CBDF) é registrado de forma independente do código de procedimento/cobrança.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Catálogo rápido CBDF (COFFITO)
            </label>
            <select
              disabled={!canEdit}
              value={cbdfCode}
              onChange={(e) => {
                const selected = CBDF_CATALOG.find(
                  (c) => c.code === e.target.value
                );
                setCbdfCode(e.target.value);
                if (selected) {
                  setCbdfDescription(selected.description);
                }
              }}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            >
              <option value="">
                Selecione uma classificação CBDF ou preencha manualmente abaixo...
              </option>
              {CBDF_CATALOG.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} — {item.description}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Código CBDF <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              disabled={!canEdit}
              value={cbdfCode}
              onChange={(e) => setCbdfCode(e.target.value)}
              placeholder="Ex.: CBDF-S01.10"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Descrição CBDF <span className="text-rose-600">*</span>
            </label>
            <input
              type="text"
              disabled={!canEdit}
              value={cbdfDescription}
              onChange={(e) => setCbdfDescription(e.target.value)}
              placeholder="Descrição cinético-funcional CBDF"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Diagnóstico Fisioterapêutico Funcional{' '}
              <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              disabled={!canEdit}
              value={functionalDiagnosis}
              onChange={(e) => setFunctionalDiagnosis(e.target.value)}
              placeholder="Descreva as deficiências de função/estrutura, limitações de atividade e restrições de participação..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800">
              Síntese compartilhada com a equipe multiprofissional (visível pela clínica)
            </label>
            <textarea
              rows={2}
              disabled={!canEdit}
              value={sharedSummary}
              onChange={(e) => setSharedSummary(e.target.value)}
              placeholder="Orientações objetivas para equipe multiprofissional sem expor dados sigilosos da anamnese..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>
        </div>

        {/* Billing / Procedure Separation */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-800">
              Procedimento / Faturamento (Separado do Diagnóstico Clínico)
            </p>
            <p className="text-xs text-slate-500">
              Campo opcional exclusivo para referência administrativa de cobrança (TUSS / RNPF).
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              disabled={!canEdit}
              value={procedureCode}
              onChange={(e) => {
                const found = PROCEDURE_CODE_SUGGESTIONS.find(
                  (p) => p.code === e.target.value
                );
                setProcedureCode(e.target.value);
                if (found) setProcedureDescription(found.description);
              }}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-900 disabled:bg-slate-100"
            >
              <option value="">Selecionar TUSS / RNPF...</option>
              {PROCEDURE_CODE_SUGGESTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} — {item.description}
                </option>
              ))}
            </select>
            <input
              type="text"
              disabled={!canEdit}
              value={procedureCode}
              onChange={(e) => setProcedureCode(e.target.value)}
              placeholder="Código procedimento"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 disabled:bg-slate-100"
            />
            <input
              type="text"
              disabled={!canEdit}
              value={procedureDescription}
              onChange={(e) => setProcedureDescription(e.target.value)}
              placeholder="Descrição do procedimento"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 disabled:bg-slate-100"
            />
          </div>
        </div>
      </section>

      {/* Author Signature & Immutability Footer */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Autoria Clínica Inalterável e Carimbo Temporal (UTC)
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-slate-500">
              Profissional Responsável
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {authorNameDisplay}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">
              Registro no Conselho (CREFITO){' '}
              <span className="text-rose-600">*</span>
            </label>
            {canEdit ? (
              <input
                type="text"
                value={authorCouncilNumber}
                onChange={(e) => setAuthorCouncilNumber(e.target.value)}
                placeholder="Ex.: CREFITO-3/123456-F"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
              />
            ) : (
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                {authorCouncilNumber || 'Não informado'}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">
              Timestamp de Conclusão (UTC)
            </p>
            <p className="mt-1 font-mono text-xs font-medium text-slate-800 tabular-nums">
              {initialEvaluation?.finalized_at_utc
                ? initialEvaluation.finalized_at_utc
                : 'Aguardando conclusão'}
            </p>
          </div>
        </div>
      </section>

      {/* Per-Evaluation Audit Trail */}
      {initialEvaluation && auditEvents.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 print:hidden">
          <h3 className="text-sm font-semibold text-slate-900">
            Rastreabilidade de Acessos e Compartilhamentos (AuditEvent LGPD)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Timestamp (UTC)</th>
                  <th className="py-2 pr-3 font-medium">Ação Executada</th>
                  <th className="py-2 pr-3 font-medium">Usuário</th>
                  <th className="py-2 font-medium">IP de Origem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-2 pr-3 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                      {ev.timestamp_utc}
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {EVALUATION_AUDIT_ACTION_LABELS[ev.action_executed] ??
                        ev.action_executed}
                    </td>
                    <td className="py-2 pr-3 text-slate-700">
                      {ev.user_name || ev.user_email || ev.user_id}
                    </td>
                    <td className="py-2 font-mono text-slate-600 tabular-nums">
                      {ev.source_ip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {officialExportOpen && (
        <OfficialDossierModal
          patientId={patient.id}
          patientName={patient.name}
          onClose={() => setOfficialExportOpen(false)}
        />
      )}
    </div>
  );
}
