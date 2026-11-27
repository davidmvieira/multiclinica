'use client';

import { AlertCircle, GitBranch, Lock, Plus, X } from 'lucide-react';
import { useState } from 'react';

import type {
  EvaluationFieldType,
  EvaluationSectionDefinition,
  EvaluationTemplateRecord,
  EvaluationTemplateSchema,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

interface TemplateVersionModalProps {
  template: EvaluationTemplateRecord;
  versions: EvaluationTemplateVersionRecord[];
  canPublishVersion: boolean;
  onClose: () => void;
  onVersionPublished: (
    updatedTemplate: EvaluationTemplateRecord,
    newVersion: EvaluationTemplateVersionRecord
  ) => void;
}

const FIELD_TYPE_OPTIONS: { value: EvaluationFieldType; label: string }[] = [
  { value: 'textarea', label: 'Texto longo' },
  { value: 'text', label: 'Texto curto' },
  { value: 'number', label: 'Número' },
  { value: 'select', label: 'Lista suspensa' },
  { value: 'boolean', label: 'Sim / Não' },
  { value: 'scale_eva', label: 'Escala EVA (0–10)' },
  { value: 'scale_mrc', label: 'Força MRC (0–5)' },
  { value: 'date', label: 'Data' },
];

export default function TemplateVersionModal({
  template,
  versions,
  canPublishVersion,
  onClose,
  onVersionPublished,
}: TemplateVersionModalProps) {
  const orderedVersions = [...versions].sort(
    (a, b) => b.version_number - a.version_number
  );
  const latestVersion = orderedVersions[0];

  const [selectedInspectVersion, setSelectedInspectVersion] =
    useState<EvaluationTemplateVersionRecord | null>(latestVersion ?? null);

  const [draftSections, setDraftSections] = useState<
    EvaluationSectionDefinition[]
  >(() =>
    latestVersion
      ? JSON.parse(JSON.stringify(latestVersion.schema_json.sections))
      : []
  );
  const [changelog, setChangelog] = useState('');
  const [newFieldSectionId, setNewFieldSectionId] = useState(
    latestVersion?.schema_json.sections[0]?.id ?? ''
  );
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] =
    useState<EvaluationFieldType>('textarea');
  const [newFieldRequired, setNewFieldRequired] = useState(true);

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleFieldRequired(sectionId: string, fieldId: string) {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id !== sectionId
          ? sec
          : {
              ...sec,
              fields: sec.fields.map((f) =>
                f.id !== fieldId ? f : { ...f, required: !f.required }
              ),
            }
      )
    );
  }

  function toggleSectionRestricted(sectionId: string) {
    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id !== sectionId
          ? sec
          : {
              ...sec,
              is_restricted_to_author: !sec.is_restricted_to_author,
            }
      )
    );
  }

  function handleAddFieldToDraft() {
    if (!newFieldLabel.trim() || !newFieldSectionId) return;
    const cleanId =
      newFieldLabel
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 48) +
      '_' +
      Date.now().toString(36).slice(-4);

    setDraftSections((prev) =>
      prev.map((sec) =>
        sec.id !== newFieldSectionId
          ? sec
          : {
              ...sec,
              fields: [
                ...sec.fields,
                {
                  id: cleanId,
                  label: newFieldLabel.trim(),
                  type: newFieldType,
                  required: newFieldRequired,
                  min:
                    newFieldType === 'scale_eva'
                      ? 0
                      : newFieldType === 'scale_mrc'
                        ? 0
                        : undefined,
                  max:
                    newFieldType === 'scale_eva'
                      ? 10
                      : newFieldType === 'scale_mrc'
                        ? 5
                        : undefined,
                  options:
                    newFieldType === 'select'
                      ? ['Preservado', 'Alterado leve', 'Alterado grave']
                      : undefined,
                },
              ],
            }
      )
    );
    setNewFieldLabel('');
  }

  async function handlePublishNewVersion() {
    setError(null);
    if (changelog.trim().length < 4) {
      setError(
        'Descreva o motivo/alteração desta nova versão (mínimo 4 caracteres).'
      );
      return;
    }

    const nextSchema: EvaluationTemplateSchema = {
      homologationNote: `Versão v${template.current_version_number + 1} publicada sem sobrescrever versões anteriores.`,
      sections: draftSections,
    };

    setPublishing(true);
    try {
      const res = await fetch('/api/evaluations/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          changelog: changelog.trim(),
          schema: nextSchema,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível publicar a nova versão.');
        return;
      }

      onVersionPublished(
        data.template as EvaluationTemplateRecord,
        data.version as EvaluationTemplateVersionRecord
      );
    } catch {
      setError('Falha de comunicação ao publicar nova versão.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-version-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-emerald-600" />
              <h2
                id="template-version-title"
                className="text-base font-bold text-slate-900"
              >
                Versionamento Estrutural — {template.name}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Avaliações concluídas preservam exatamente a versão vigente na data da conclusão.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-5">
          {/* Left: Historical immutable versions */}
          <div className="space-y-3 lg:col-span-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Histórico de Versões Imutáveis
            </h3>
            <div className="space-y-2">
              {orderedVersions.map((ver) => {
                const active = selectedInspectVersion?.id === ver.id;
                const isCurrent =
                  template.current_version_number === ver.version_number;
                return (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => setSelectedInspectVersion(ver)}
                    className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                        v{ver.version_number}
                      </span>
                      {isCurrent && (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Vigente
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-700">
                      {ver.changelog || 'Versão estrutural publicada'}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                      {ver.created_by_name} · {ver.created_at.slice(0, 10)}
                    </p>
                  </button>
                );
              })}
            </div>

            {selectedInspectVersion && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-800">
                  Estrutura congelada da v{selectedInspectVersion.version_number}
                </p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {selectedInspectVersion.schema_json.sections.map((sec) => (
                    <li key={sec.id}>
                      <span className="font-medium text-slate-800">
                        {sec.title}
                      </span>{' '}
                      ({sec.fields.length} campos
                      {sec.is_restricted_to_author ? ', sigiloso' : ''})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right: Publish next incremented version */}
          <div className="space-y-4 lg:col-span-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Publicar Nova Versão (v{template.current_version_number + 1})
              </h3>
              <span className="text-xs text-slate-500">
                Nunca sobrescreve a v{template.current_version_number}
              </span>
            </div>

            {!canPublishVersion ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                Apenas profissionais clínicos ou administradores podem publicar novas versões estruturais de modelos.
              </div>
            ) : (
              <>
                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="space-y-3">
                  {draftSections.map((sec) => (
                    <div
                      key={sec.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900">
                          {sec.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleSectionRestricted(sec.id)}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${
                            sec.is_restricted_to_author
                              ? 'border-slate-300 bg-white text-slate-800'
                              : 'border-slate-200 bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Lock className="h-3 w-3" />
                          {sec.is_restricted_to_author
                            ? 'Restrito ao autor'
                            : 'Compartilhado equipe'}
                        </button>
                      </div>

                      <div className="space-y-1">
                        {sec.fields.map((field) => (
                          <div
                            key={field.id}
                            className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <span className="text-slate-800">
                              {field.label}{' '}
                              <span className="font-mono text-[11px] text-slate-400">
                                ({field.type})
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                toggleFieldRequired(sec.id, field.id)
                              }
                              className={`cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium ${
                                field.required
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {field.required ? 'Obrigatório' : 'Opcional'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add new field */}
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-slate-800">
                    Adicionar novo campo na versão v
                    {template.current_version_number + 1}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={newFieldSectionId}
                      onChange={(e) => setNewFieldSectionId(e.target.value)}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                    >
                      {draftSections.map((sec) => (
                        <option key={sec.id} value={sec.id}>
                          {sec.title}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newFieldType}
                      onChange={(e) =>
                        setNewFieldType(e.target.value as EvaluationFieldType)
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
                    >
                      {FIELD_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      placeholder="Rótulo do novo campo clínico..."
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 sm:col-span-2"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={newFieldRequired}
                        onChange={(e) => setNewFieldRequired(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      Campo obrigatório para conclusão
                    </label>
                    <button
                      type="button"
                      onClick={handleAddFieldToDraft}
                      className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Incluir campo
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-800">
                    Justificativa / Changelog da versão v
                    {template.current_version_number + 1}{' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="Ex.: Inclusão de escala funcional complementar conforme atualização clínica"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={publishing}
                    onClick={() => void handlePublishNewVersion()}
                    className="h-9 cursor-pointer rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {publishing
                      ? 'Publicando...'
                      : `Publicar versão v${template.current_version_number + 1}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
