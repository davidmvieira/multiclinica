'use client';

import { FilePlus2, Lock, X } from 'lucide-react';
import { useState } from 'react';

import type { MedicalRecordEntry } from '@/types/patients';

interface CorrectiveNoteModalProps {
  patientId: string;
  record: MedicalRecordEntry;
  onClose: () => void;
  onSaved: () => void;
}

export default function CorrectiveNoteModal({
  patientId,
  record,
  onClose,
  onSaved,
}: CorrectiveNoteModalProps) {
  const [justification, setJustification] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (justification.trim().length < 5) {
      setError('Informe a justificativa da correção (mínimo 5 caracteres).');
      return;
    }

    if (content.trim().length < 3) {
      setError('Informe o conteúdo da nota corretiva (mínimo 3 caracteres).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/records/${record.id}/addenda`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            justification: justification.trim(),
            content: content.trim(),
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível registrar a nota corretiva.');
        return;
      }

      onSaved();
    } catch {
      setError('Falha de conexão ao salvar nota corretiva.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="corrective-note-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <FilePlus2
              className="h-5 w-5 text-emerald-700"
              aria-hidden="true"
            />
            <div>
              <h2
                id="corrective-note-title"
                className="text-lg font-bold text-slate-900"
              >
                Adicionar nota corretiva
              </h2>
              <p className="text-xs text-slate-500">
                O registro original permanece preservado integralmente.
              </p>
            </div>
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
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          {/* Original read-only record reference */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <div className="flex items-center justify-between gap-2 text-slate-500">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                {record.title}
              </span>
              <span className="font-mono tabular-nums">
                {new Date(record.occurred_at).toLocaleString('pt-BR')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Autor original: {record.author_name}
            </p>
            <p className="mt-2 whitespace-pre-line text-slate-700">
              {record.content}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="addendum-justification"
              className="block text-sm font-medium text-slate-700"
            >
              Justificativa da correção / adendo *
            </label>
            <input
              id="addendum-justification"
              type="text"
              required
              maxLength={500}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Ex.: Retificação de lado acometido ou complemento de exame físico"
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label
              htmlFor="addendum-content"
              className="block text-sm font-medium text-slate-700"
            >
              Texto da nota corretiva *
            </label>
            <textarea
              id="addendum-content"
              rows={4}
              required
              maxLength={6000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Descreva a retificação ou complemento clínico rastreável..."
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-900 outline-none focus:border-emerald-600"
            />
          </div>

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
              {submitting ? 'Registrando...' : 'Registrar nota corretiva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
