'use client';

import {
  FileText,
  Lock,
  Paperclip,
  ShieldAlert,
  Stethoscope,
  Upload,
  X,
} from 'lucide-react';
import { useState } from 'react';

import {
  MEDICAL_RECORD_CATEGORIES,
  MEDICAL_RECORD_CATEGORY_META,
  RECORD_SUBTYPES_BY_CATEGORY,
} from '@/lib/patients/constants';
import type {
  MedicalRecordCategory,
  MedicalRecordEntry,
} from '@/types/patients';

interface PatientRecordModalProps {
  patientId: string;
  patientName: string;
  canAuthorClinical: boolean;
  professionals: { id: string; name: string }[];
  draftRecord?: MedicalRecordEntry | null;
  initialCategory?: MedicalRecordCategory;
  onClose: () => void;
  onSaved: () => void;
}

export default function PatientRecordModal({
  patientId,
  patientName,
  canAuthorClinical,
  professionals,
  draftRecord,
  initialCategory,
  onClose,
  onSaved,
}: PatientRecordModalProps) {
  const isEditingDraft = Boolean(draftRecord);
  const defaultCategory: MedicalRecordCategory =
    draftRecord?.category ??
    initialCategory ??
    (canAuthorClinical ? 'clinical' : 'administrative');

  const [category, setCategory] =
    useState<MedicalRecordCategory>(defaultCategory);
  const [recordType, setRecordType] = useState(
    draftRecord?.record_type ??
      RECORD_SUBTYPES_BY_CATEGORY[defaultCategory][0].value
  );
  const [title, setTitle] = useState(draftRecord?.title ?? '');
  const [content, setContent] = useState(draftRecord?.content ?? '');
  const [professionalId, setProfessionalId] = useState(
    draftRecord?.professional_id ?? professionals[0]?.id ?? ''
  );
  const [occurredAtLocal, setOccurredAtLocal] = useState(() => {
    const dt = draftRecord?.occurred_at
      ? new Date(draftRecord.occurred_at)
      : new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  });
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  // Document attachment fields
  const [documentUrl, setDocumentUrl] = useState(
    draftRecord?.document_url ?? ''
  );
  const [documentName, setDocumentName] = useState(
    draftRecord?.document_name ?? ''
  );
  const [documentMime, setDocumentMime] = useState(
    draftRecord?.document_mime ?? ''
  );
  const [documentSizeBytes, setDocumentSizeBytes] = useState<number | null>(
    draftRecord?.document_size_bytes ?? null
  );
  const [documentDataUrl, setDocumentDataUrl] = useState(
    draftRecord?.document_data_url ?? ''
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCategoryChange(nextCat: MedicalRecordCategory) {
    if (nextCat === 'clinical' && !canAuthorClinical) return;
    setCategory(nextCat);
    setRecordType(RECORD_SUBTYPES_BY_CATEGORY[nextCat][0].value);
    if (nextCat !== 'clinical') {
      setSaveAsDraft(false);
    }
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMimes = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain',
    ];
    if (!allowedMimes.includes(file.type)) {
      setError('Envie arquivos PDF, PNG, JPG, WEBP ou TXT.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('O arquivo excede o limite de 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDocumentDataUrl(reader.result);
        setDocumentName(file.name);
        setDocumentMime(file.type);
        setDocumentSizeBytes(file.size);
        if (!title.trim()) {
          setTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      setError('Informe um título para o registro.');
      return;
    }

    if (category !== 'document' && content.trim().length < 3) {
      setError('Informe a descrição/conteúdo do registro.');
      return;
    }

    if (
      category === 'document' &&
      !documentUrl.trim() &&
      !documentDataUrl &&
      !content.trim()
    ) {
      setError(
        'Anexe um arquivo, informe o link externo do documento ou descreva o anexo.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/patients/${patientId}/records`, {
        method: isEditingDraft ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEditingDraft
            ? {
                recordId: draftRecord!.id,
                title: title.trim(),
                content: content.trim(),
                finalize: !saveAsDraft,
              }
            : {
                category,
                recordType,
                title: title.trim(),
                content: content.trim(),
                professionalId: professionalId || null,
                occurredAt: occurredAtLocal
                  ? new Date(occurredAtLocal).toISOString()
                  : new Date().toISOString(),
                isFinalized: category === 'clinical' ? !saveAsDraft : true,
                documentUrl:
                  category === 'document' ? documentUrl.trim() || null : null,
                documentName:
                  category === 'document' ? documentName.trim() || null : null,
                documentMime:
                  category === 'document' ? documentMime || null : null,
                documentSizeBytes:
                  category === 'document' ? documentSizeBytes : null,
                documentDataUrl:
                  category === 'document' ? documentDataUrl || null : null,
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o registro.');
        return;
      }

      onSaved();
    } catch {
      setError('Falha de conexão ao gravar no prontuário.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-modal-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2
              id="record-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditingDraft
                ? 'Editar rascunho clínico'
                : 'Novo registro no prontuário'}
            </h2>
            <p className="text-xs text-slate-500">Paciente: {patientName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
        >
          {!isEditingDraft && (
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Categoria do registro
              </span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {MEDICAL_RECORD_CATEGORIES.map((cat) => {
                  const meta = MEDICAL_RECORD_CATEGORY_META[cat];
                  const disabled = cat === 'clinical' && !canAuthorClinical;
                  const active = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleCategoryChange(cat)}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition ${
                        active
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {cat === 'clinical' ? (
                        <Stethoscope className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : cat === 'administrative' ? (
                        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              {!canAuthorClinical && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Registros clínicos são exclusivos de fisioterapeutas e
                  gestores clínicos.
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {!isEditingDraft && (
              <div>
                <label
                  htmlFor="record-subtype"
                  className="block text-sm font-medium text-slate-700"
                >
                  Tipo de registro
                </label>
                <select
                  id="record-subtype"
                  value={recordType}
                  onChange={(e) => setRecordType(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  {RECORD_SUBTYPES_BY_CATEGORY[category].map((sub) => (
                    <option key={sub.value} value={sub.value}>
                      {sub.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isEditingDraft && (
              <div>
                <label
                  htmlFor="record-occurred-at"
                  className="block text-sm font-medium text-slate-700"
                >
                  Data e hora do atendimento / evento
                </label>
                <input
                  id="record-occurred-at"
                  type="datetime-local"
                  value={occurredAtLocal}
                  onChange={(e) => setOccurredAtLocal(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-600 tabular-nums"
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-12">
            <div
              className={
                !isEditingDraft && professionals.length > 0
                  ? 'sm:col-span-7'
                  : 'sm:col-span-12'
              }
            >
              <label
                htmlFor="record-title"
                className="block text-sm font-medium text-slate-700"
              >
                Título *
              </label>
              <input
                id="record-title"
                type="text"
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  category === 'clinical'
                    ? 'Ex.: Evolução da 4ª sessão — mobilidade de ombro'
                    : category === 'document'
                      ? 'Ex.: Ressonância Magnética de Joelho Direito'
                      : 'Ex.: Confirmação de retorno e autorização de convênio'
                }
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            {!isEditingDraft && professionals.length > 0 && (
              <div className="sm:col-span-5">
                <label
                  htmlFor="record-professional"
                  className="block text-sm font-medium text-slate-700"
                >
                  Profissional responsável
                </label>
                <select
                  id="record-professional"
                  value={professionalId}
                  onChange={(e) => setProfessionalId(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  <option value="">Não vinculado</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {category === 'document' && !isEditingDraft && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Arquivo ou link do documento
                </span>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Selecionar arquivo (até 2 MB)
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
                    onChange={handleFilePick}
                    className="sr-only"
                  />
                </label>
              </div>

              {documentName && (
                <p className="text-xs text-emerald-700">
                  Arquivo selecionado: <strong>{documentName}</strong>
                  {documentSizeBytes
                    ? ` (${Math.max(1, Math.round(documentSizeBytes / 1024))} KB)`
                    : ''}
                </p>
              )}

              <div>
                <label
                  htmlFor="record-doc-url"
                  className="block text-xs font-medium text-slate-600"
                >
                  Ou link externo seguro (https://)
                </label>
                <input
                  id="record-doc-url"
                  type="url"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="record-content"
              className="block text-sm font-medium text-slate-700"
            >
              {category === 'clinical'
                ? 'Descrição clínica / conduta / evolução *'
                : category === 'document'
                  ? 'Resumo / observações do documento'
                  : 'Detalhamento administrativo *'}
            </label>
            <textarea
              id="record-content"
              rows={5}
              maxLength={12000}
              required={category !== 'document'}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                category === 'clinical'
                  ? 'Relato clínico, dor/amplitude de movimento, condutas aplicadas e resposta do paciente...'
                  : 'Descreva o registro com clareza para o histórico longitudinal...'
              }
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          {category === 'clinical' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                  <Lock
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700"
                    aria-hidden="true"
                  />
                  <span>
                    Ao concluir, o registro clínico torna-se{' '}
                    <strong className="font-semibold text-slate-900">
                      imutável no banco de dados
                    </strong>{' '}
                    e eventuais correções exigem uma nota corretiva rastreável.
                  </span>
                </div>
                <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 font-medium text-slate-800 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={saveAsDraft}
                    onChange={(e) => setSaveAsDraft(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  Salvar como rascunho
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {submitting
                ? 'Gravando...'
                : category === 'clinical' && saveAsDraft
                  ? 'Salvar rascunho'
                  : category === 'clinical'
                    ? 'Concluir registro clínico'
                    : 'Salvar registro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
