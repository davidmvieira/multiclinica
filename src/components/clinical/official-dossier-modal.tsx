'use client';

import {
  AlertCircle,
  FileCode2,
  FileJson,
  Lock,
  Printer,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { APPOINTMENT_STATUS_META } from '@/lib/agenda/constants';
import { ADHERENCE_LABELS } from '@/lib/evolutions/server';
import { PATIENT_STATUS_META } from '@/lib/patients/constants';
import type { AppointmentStatus } from '@/types/agenda';
import type { OfficialClinicalDossierPayload } from '@/types/evolutions';

interface OfficialDossierModalProps {
  patientId: string;
  patientName: string;
  onClose: () => void;
}

function escapeHtml(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocalDateTime(iso: string | null | undefined, tz = 'America/Sao_Paulo') {
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

export default function OfficialDossierModal({
  patientId,
  patientName,
  onClose,
}: OfficialDossierModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<OfficialClinicalDossierPayload | null>(
    null
  );
  const [includeAppointments, setIncludeAppointments] = useState(true);
  const [includeEvaluations, setIncludeEvaluations] = useState(true);
  const [includeEvolutions, setIncludeEvolutions] = useState(true);

  const loadDossier = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/official-export?format=preview_oficial`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok || !data.dossier) {
        setError(
          data.error ?? 'Não foi possível compilar o prontuário oficial.'
        );
        return;
      }
      setDossier(data.dossier as OfficialClinicalDossierPayload);
    } catch {
      setError('Falha de conexão ao gerar o prontuário oficial.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void loadDossier();
  }, [loadDossier]);

  function buildSlug(name: string) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async function handleExportJson() {
    if (!dossier) return;
    await fetch(
      `/api/patients/${patientId}/official-export?format=portabilidade_json`,
      { cache: 'no-store' }
    ).catch(() => null);

    const exportObj = {
      ...dossier,
      appointments: includeAppointments ? dossier.appointments : [],
      evaluations: includeEvaluations ? dossier.evaluations : [],
      evolutions: includeEvolutions ? dossier.evolutions : [],
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prontuario-oficial-lgpd-${buildSlug(dossier.patient.name)}-${dossier.issuedAtUtc.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportHtml() {
    if (!dossier) return;
    await fetch(
      `/api/patients/${patientId}/official-export?format=documento_html`,
      { cache: 'no-store' }
    ).catch(() => null);

    const tz = dossier.organization.timezone || 'America/Sao_Paulo';
    const apptsHtml = includeAppointments
      ? dossier.appointments
          .map((a) => {
            const st =
              APPOINTMENT_STATUS_META[a.status as AppointmentStatus]?.label ??
              a.status;
            return `<tr>
              <td>${escapeHtml(formatLocalDateTime(a.starts_at, tz))}</td>
              <td>${escapeHtml(a.service_name || a.specialty_name || 'Atendimento Clínico')}</td>
              <td>${escapeHtml(a.professional_name)}${a.professional_council ? ` (${escapeHtml(a.professional_council)})` : ''}</td>
              <td>${escapeHtml(a.unit_name || 'Principal')}</td>
              <td>${escapeHtml(st)}${a.has_finalized_evolution ? ' · Evolução assinada' : ''}</td>
            </tr>`;
          })
          .join('')
      : '';

    const evalsHtml = includeEvaluations
      ? dossier.evaluations
          .map(({ evaluation, templateVersion }) => {
            const sections = [...(templateVersion?.schema_json.sections ?? [])].sort(
              (a, b) => a.order - b.order
            );
            const sectionsHtml = sections
              .map((sec) => {
                if (sec.is_restricted_to_author && !evaluation.viewerIsAuthor) {
                  return `<p><strong>${escapeHtml(sec.title)}:</strong> <em>[Conteúdo sigiloso reservado ao autor — LGPD Art. 11]</em></p>`;
                }
                const fieldsHtml = sec.fields
                  .map((f) => {
                    const val = evaluation.answers?.[f.id];
                    if (val === undefined || val === null || val === '') return '';
                    const fmt = Array.isArray(val)
                      ? val.join(', ')
                      : typeof val === 'boolean'
                        ? val
                          ? 'Sim'
                          : 'Não'
                        : `${val}${f.unit ? ` ${f.unit}` : ''}`;
                    return `<li><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(fmt)}</li>`;
                  })
                  .filter(Boolean)
                  .join('');
                return fieldsHtml
                  ? `<div><strong>${escapeHtml(sec.title)}</strong><ul>${fieldsHtml}</ul></div>`
                  : '';
              })
              .join('');

            return `<div class="card">
              <div class="card-head">
                <strong>${escapeHtml(evaluation.template_name)} (v${escapeHtml(evaluation.template_version_number)})</strong>
                <span>Concluída (UTC): ${escapeHtml(evaluation.finalized_at_utc)}</span>
              </div>
              <p><strong>Diagnóstico Fisioterapêutico:</strong> ${escapeHtml(evaluation.functional_diagnosis || '—')}</p>
              <p><strong>CBDF:</strong> ${escapeHtml(evaluation.cbdf_code || '—')} — ${escapeHtml(evaluation.cbdf_description || '')}</p>
              ${evaluation.shared_summary ? `<p><strong>Síntese Multiprofissional:</strong> ${escapeHtml(evaluation.shared_summary)}</p>` : ''}
              ${sectionsHtml}
              <p class="sig">Assinatura Clínica: ${escapeHtml(evaluation.author_name)} · Registro: ${escapeHtml(evaluation.author_council_number || 'Não informado')}</p>
            </div>`;
          })
          .join('')
      : '';

    const evolsHtml = includeEvolutions
      ? dossier.evolutions
          .map((ev) => {
            const rectsHtml = (ev.rectifications ?? [])
              .map(
                (r) => `<div class="rect">
                  <strong>Nota de Retificação (${escapeHtml(r.created_at_utc)} UTC)</strong> — ${escapeHtml(r.author_name)} (${escapeHtml(r.author_council_number || '')})<br/>
                  <em>Justificativa:</em> ${escapeHtml(r.justification)}<br/>
                  ${escapeHtml(r.rectified_content)}
                </div>`
              )
              .join('');
            return `<div class="card">
              <div class="card-head">
                <strong>Atendimento: ${escapeHtml(formatLocalDateTime(ev.appointment_starts_at || ev.created_at, tz))}</strong>
                <span>Conclusão (UTC): ${escapeHtml(ev.finalized_at_utc || ev.created_at)}</span>
              </div>
              <p><strong>Evolução Compartilhada (SharedClinicalNote):</strong><br/>${escapeHtml(ev.shared_clinical_note)}</p>
              ${ev.procedures_performed ? `<p><strong>Condutas / Procedimentos:</strong> ${escapeHtml(ev.procedures_performed)}</p>` : ''}
              ${ev.patient_response ? `<p><strong>Resposta do Paciente:</strong> ${escapeHtml(ev.patient_response)}</p>` : ''}
              ${ev.eva_before !== null || ev.eva_after !== null ? `<p><strong>EVA:</strong> Pré ${escapeHtml(ev.eva_before ?? '—')}/10 · Pós ${escapeHtml(ev.eva_after ?? '—')}/10</p>` : ''}
              ${ev.restricted_clinical_record ? `<p><strong>Registro Restrito (${escapeHtml(ev.restricted_category || 'Autor')}):</strong> ${escapeHtml(ev.restricted_clinical_record)}</p>` : ev.restrictedRecordHidden ? `<p><em>[Registro Restrito preservado ao autor — LGPD Art. 11]</em></p>` : ''}
              ${rectsHtml}
              <p class="sig">Autoria Inalterável: ${escapeHtml(ev.author_name)} · Registro: ${escapeHtml(ev.author_council_number || '—')} · IP: ${escapeHtml(ev.source_ip)}</p>
            </div>`;
          })
          .join('')
      : '';

    const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Prontuário Clínico Oficial — ${escapeHtml(dossier.patient.name)}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin: 22px 0 10px; }
  .meta { background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; margin-bottom: 16px; }
  .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; margin-bottom: 12px; page-break-inside: avoid; }
  .card-head { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px; font-size: 12px; }
  .rect { background: #fffbeb; border: 1px solid #fde68a; padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 12px; }
  .sig { font-family: ui-monospace, monospace; font-size: 11px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
</style>
</head>
<body>
  <h1>PRONTUÁRIO CLÍNICO OFICIAL — ${escapeHtml(dossier.organization.name)}</h1>
  <p style="margin:0 0 12px;font-size:12px;color:#475569;">Emissão normatizada (COFFITO Res. 414/2012 · CBDF Res. 555/2022 · LGPD Lei 13.709/2018)</p>
  <div class="meta">
    <strong>Paciente:</strong> ${escapeHtml(dossier.patient.name)}${dossier.patient.cpf ? ` · CPF: ${escapeHtml(dossier.patient.cpf)}` : ''}<br/>
    <strong>Situação:</strong> ${escapeHtml(PATIENT_STATUS_META[dossier.patient.status]?.label ?? dossier.patient.status)} · <strong>Nascimento:</strong> ${escapeHtml(dossier.patient.birth_date || 'Não informado')}<br/>
    <strong>Emitido por:</strong> ${escapeHtml(dossier.issuedBy.name)}${dossier.issuedBy.councilNumber ? ` (${escapeHtml(dossier.issuedBy.councilNumber)})` : ''} · <strong>Emissão (UTC):</strong> ${escapeHtml(dossier.issuedAtUtc)} · <strong>Código Verificador:</strong> ${escapeHtml(dossier.verificationCode)}
  </div>
  ${includeAppointments ? `<h2>I. Registro Cronológico de Atendimentos (Encounters)</h2>${apptsHtml ? `<table><thead><tr><th>Data/Hora</th><th>Serviço/Especialidade</th><th>Profissional</th><th>Unidade</th><th>Status</th></tr></thead><tbody>${apptsHtml}</tbody></table>` : '<p>Nenhum atendimento registrado.</p>'}` : ''}
  ${includeEvaluations ? `<h2>II. Avaliações Clínicas Estruturadas e Diagnóstico CBDF</h2>${evalsHtml || '<p>Nenhuma avaliação concluída.</p>'}` : ''}
  ${includeEvolutions ? `<h2>III. Evoluções Clínicas Diárias e Notas de Retificação</h2>${evolsHtml || '<p>Nenhuma evolução clínica concluída.</p>'}` : ''}
  <p class="sig">${escapeHtml(dossier.lgpdNotice)} · IP de emissão: ${escapeHtml(dossier.issuedBy.sourceIp)}</p>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prontuario-oficial-${buildSlug(dossier.patient.name)}-${dossier.issuedAtUtc.slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrintPdf() {
    await fetch(
      `/api/patients/${patientId}/official-export?format=pdf_impressao`,
      { cache: 'no-store' }
    ).catch(() => null);
    window.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 print:static print:block print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="official-dossier-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white print:max-h-none print:overflow-visible print:rounded-none print:border-0">
        {/* Modal Action Bar (hidden on print) */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div>
            <h2
              id="official-dossier-title"
              className="text-base font-bold text-slate-900"
            >
              Exportação Oficial de Prontuário — {patientName}
            </h2>
            <p className="text-xs text-slate-600">
              Formato normatizado (COFFITO Res. 414/2012 · CBDF · LGPD) com trilha de auditoria e código verificador.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!dossier}
              onClick={() => void handleExportJson()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <FileJson className="h-3.5 w-3.5" />
              Portabilidade (.json)
            </button>
            <button
              type="button"
              disabled={!dossier}
              onClick={() => void handleExportHtml()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              Documento Oficial (.html)
            </button>
            <button
              type="button"
              disabled={!dossier}
              onClick={() => void handlePrintPdf()}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Printer className="h-3.5 w-3.5" />
              Imprimir / Salvar PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
              aria-label="Fechar exportação oficial"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scope checkboxes (hidden on print) */}
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-2.5 text-xs text-slate-700 print:hidden">
          <span className="font-semibold text-slate-900">Escopo do documento:</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeAppointments}
              onChange={(e) => setIncludeAppointments(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            Atendimentos ({dossier?.appointments.length ?? 0})
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeEvaluations}
              onChange={(e) => setIncludeEvaluations(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            Avaliações &amp; CBDF ({dossier?.evaluations.length ?? 0})
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeEvolutions}
              onChange={(e) => setIncludeEvolutions(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            Evoluções &amp; Retificações ({dossier?.evolutions.length ?? 0})
          </label>
        </div>

        {/* Printable Official Document Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 print:overflow-visible print:p-0">
          {loading ? (
            <div className="space-y-4">
              <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
              <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : dossier ? (
            <article className="mx-auto max-w-4xl space-y-6 text-slate-900">
              {/* Official Institutional Header */}
              <header className="border-b-2 border-slate-900 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      Prontuário Clínico Oficial — Registro Normatizado
                    </p>
                    <h1 className="mt-0.5 text-xl font-bold text-slate-900">
                      {dossier.organization.name}
                    </h1>
                    <p className="mt-1 text-xs text-slate-600">
                      {dossier.normativeBasis.join(' · ')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono text-[11px] text-slate-700 tabular-nums">
                    <p className="font-bold text-slate-900">
                      COD: {dossier.verificationCode}
                    </p>
                    <p>Emissão UTC: {dossier.issuedAtUtc}</p>
                    <p>IP: {dossier.issuedBy.sourceIp}</p>
                  </div>
                </div>
              </header>

              {/* Patient Identification Block */}
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
                <h2 className="font-bold uppercase tracking-wide text-slate-800">
                  Identificação do Paciente e Emissor
                </h2>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <span className="text-slate-500">Paciente:</span>{' '}
                    <strong className="text-slate-900">
                      {dossier.patient.name}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">CPF / Identificador:</span>{' '}
                    <span className="font-mono text-slate-900">
                      {dossier.patient.cpf ||
                        (dossier.patient.alt_identifier_value
                          ? `${dossier.patient.alt_identifier_type || 'Doc'}: ${dossier.patient.alt_identifier_value}`
                          : 'Sem CPF')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Situação:</span>{' '}
                    <span className="font-semibold text-slate-900">
                      {PATIENT_STATUS_META[dossier.patient.status]?.label ??
                        dossier.patient.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Nascimento:</span>{' '}
                    <span className="font-mono text-slate-800">
                      {dossier.patient.birth_date || 'Não informado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Contato:</span>{' '}
                    <span>{dossier.patient.phone || dossier.patient.email || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Emitido por:</span>{' '}
                    <span className="font-semibold text-slate-900">
                      {dossier.issuedBy.name}
                      {dossier.issuedBy.councilNumber
                        ? ` (${dossier.issuedBy.councilNumber})`
                        : ''}
                    </span>
                  </div>
                </div>
              </section>

              {/* Section I: Appointments */}
              {includeAppointments && (
                <section className="space-y-2.5">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    I. Registro Cronológico de Atendimentos (Encounters)
                  </h2>
                  {dossier.appointments.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhum atendimento registrado para este paciente.
                    </p>
                  ) : (
                    <table className="w-full border-collapse border border-slate-200 text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 font-semibold text-slate-700">
                          <th className="border border-slate-200 px-2.5 py-2">
                            Data / Hora
                          </th>
                          <th className="border border-slate-200 px-2.5 py-2">
                            Serviço / Especialidade
                          </th>
                          <th className="border border-slate-200 px-2.5 py-2">
                            Profissional &amp; Conselho
                          </th>
                          <th className="border border-slate-200 px-2.5 py-2">
                            Unidade
                          </th>
                          <th className="border border-slate-200 px-2.5 py-2">
                            Situação
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dossier.appointments.map((appt) => (
                          <tr key={appt.id} className="break-inside-avoid">
                            <td className="border border-slate-200 px-2.5 py-1.5 font-mono tabular-nums whitespace-nowrap">
                              {formatLocalDateTime(
                                appt.starts_at,
                                dossier.organization.timezone
                              )}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-1.5">
                              {appt.service_name ||
                                appt.specialty_name ||
                                'Atendimento Clínico'}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-1.5">
                              {appt.professional_name}
                              {appt.professional_council
                                ? ` · ${appt.professional_council}`
                                : ''}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-1.5">
                              {appt.unit_name || 'Principal'}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-1.5">
                              {APPOINTMENT_STATUS_META[
                                appt.status as AppointmentStatus
                              ]?.label ?? appt.status}
                              {appt.has_finalized_evolution
                                ? ' · Evolução concluída'
                                : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              )}

              {/* Section II: Structured Evaluations & CBDF */}
              {includeEvaluations && (
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    II. Avaliações Clínicas Estruturadas e Diagnóstico CBDF
                  </h2>
                  {dossier.evaluations.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhuma avaliação estruturada concluída.
                    </p>
                  ) : (
                    dossier.evaluations.map(({ evaluation, templateVersion }) => {
                      const orderedSections = [
                        ...(templateVersion?.schema_json.sections ?? []),
                      ].sort((a, b) => a.order - b.order);

                      return (
                        <div
                          key={evaluation.id}
                          className="break-inside-avoid rounded-lg border border-slate-200 p-4 text-xs space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <p className="text-sm font-bold text-slate-900">
                              {evaluation.template_name}{' '}
                              <span className="font-mono text-xs font-medium text-slate-500">
                                (v{evaluation.template_version_number})
                              </span>
                            </p>
                            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                              Conclusão UTC: {evaluation.finalized_at_utc}
                            </span>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <p>
                              <strong className="text-slate-800">
                                Diagnóstico Fisioterapêutico:
                              </strong>{' '}
                              {evaluation.functional_diagnosis || '—'}
                            </p>
                            <p>
                              <strong className="text-slate-800">CBDF:</strong>{' '}
                              <span className="font-mono font-semibold">
                                {evaluation.cbdf_code || '—'}
                              </span>{' '}
                              {evaluation.cbdf_description
                                ? `— ${evaluation.cbdf_description}`
                                : ''}
                            </p>
                          </div>

                          {evaluation.shared_summary && (
                            <p className="rounded bg-slate-50 p-2 text-slate-700">
                              <strong>Síntese Multiprofissional:</strong>{' '}
                              {evaluation.shared_summary}
                            </p>
                          )}

                          {orderedSections.map((sec) => {
                            if (
                              sec.is_restricted_to_author &&
                              !evaluation.viewerIsAuthor
                            ) {
                              return (
                                <p
                                  key={sec.id}
                                  className="inline-flex items-center gap-1 text-[11px] italic text-slate-500"
                                >
                                  <Lock className="h-3 w-3" />
                                  {sec.title}: conteúdo reservado ao autor (LGPD Art. 11).
                                </p>
                              );
                            }

                            const filledFields = sec.fields.filter((f) => {
                              const v = evaluation.answers?.[f.id];
                              return (
                                v !== undefined && v !== null && v !== ''
                              );
                            });
                            if (filledFields.length === 0) return null;

                            return (
                              <div key={sec.id} className="space-y-1">
                                <p className="font-semibold text-slate-800">
                                  {sec.title}
                                </p>
                                <ul className="grid gap-1 pl-3 sm:grid-cols-2">
                                  {filledFields.map((f) => {
                                    const v = evaluation.answers?.[f.id];
                                    const fmt = Array.isArray(v)
                                      ? v.join(', ')
                                      : typeof v === 'boolean'
                                        ? v
                                          ? 'Sim'
                                          : 'Não'
                                        : `${v}${f.unit ? ` ${f.unit}` : ''}`;
                                    return (
                                      <li key={f.id} className="text-slate-700">
                                        <span className="font-medium text-slate-900">
                                          {f.label}:
                                        </span>{' '}
                                        {fmt}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            );
                          })}

                          <p className="border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-600">
                            Autoria Inalterável: {evaluation.author_name} ·{' '}
                            {evaluation.author_council_number ||
                              'Registro não informado'}
                          </p>
                        </div>
                      );
                    })
                  )}
                </section>
              )}

              {/* Section III: Daily Evolutions & Rectifications */}
              {includeEvolutions && (
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    III. Evoluções Clínicas Diárias e Notas de Retificação
                  </h2>
                  {dossier.evolutions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Nenhuma evolução clínica concluída.
                    </p>
                  ) : (
                    dossier.evolutions.map((ev) => (
                      <div
                        key={ev.id}
                        className="break-inside-avoid rounded-lg border border-slate-200 p-4 text-xs space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <p className="font-bold text-slate-900">
                            Sessão de{' '}
                            <span className="font-mono tabular-nums">
                              {formatLocalDateTime(
                                ev.appointment_starts_at || ev.created_at,
                                dossier.organization.timezone
                              )}
                            </span>
                            {ev.service_name ? ` · ${ev.service_name}` : ''}
                          </p>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            Conclusão UTC: {ev.finalized_at_utc}
                          </span>
                        </div>

                        <p className="whitespace-pre-line text-slate-800">
                          <strong className="text-slate-900">
                            Evolução Compartilhada (SharedClinicalNote):
                          </strong>
                          {'\n'}
                          {ev.shared_clinical_note}
                        </p>

                        {ev.procedures_performed && (
                          <p className="text-slate-700">
                            <strong>Condutas / Recursos aplicados:</strong>{' '}
                            {ev.procedures_performed}
                          </p>
                        )}
                        {ev.patient_response && (
                          <p className="text-slate-700">
                            <strong>Resposta clínica:</strong>{' '}
                            {ev.patient_response}
                          </p>
                        )}
                        {(ev.eva_before !== null ||
                          ev.eva_after !== null ||
                          ev.adherence_level) && (
                          <p className="font-mono text-[11px] text-slate-700 tabular-nums">
                            EVA Pré: {ev.eva_before ?? '—'}/10 · EVA Pós:{' '}
                            {ev.eva_after ?? '—'}/10
                            {ev.adherence_level
                              ? ` · ${ADHERENCE_LABELS[ev.adherence_level]}`
                              : ''}
                          </p>
                        )}

                        {ev.restricted_clinical_record ? (
                          <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                            <p className="font-semibold text-slate-800">
                              Registro Restrito ({ev.restricted_category || 'Autor'})
                            </p>
                            <p className="mt-0.5 whitespace-pre-line text-slate-700">
                              {ev.restricted_clinical_record}
                            </p>
                          </div>
                        ) : ev.restrictedRecordHidden ? (
                          <p className="inline-flex items-center gap-1 text-[11px] italic text-slate-500">
                            <Lock className="h-3 w-3" />
                            Registro Restrito (RestrictedClinicalRecord) preservado ao autor (LGPD Art. 11).
                          </p>
                        ) : null}

                        {(ev.rectifications ?? []).length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            {(ev.rectifications ?? []).map((rect) => (
                              <div
                                key={rect.id}
                                className="rounded border border-amber-200 bg-amber-50 p-2.5"
                              >
                                <p className="font-semibold text-amber-950">
                                  Nota de Retificação ·{' '}
                                  <span className="font-mono text-[11px] tabular-nums">
                                    {rect.created_at_utc} UTC
                                  </span>
                                </p>
                                <p className="mt-0.5 text-amber-900">
                                  <strong>Justificativa:</strong>{' '}
                                  {rect.justification}
                                </p>
                                <p className="mt-0.5 whitespace-pre-line text-amber-950">
                                  {rect.rectified_content}
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-amber-800">
                                  Assinado por: {rect.author_name} ·{' '}
                                  {rect.author_council_number || '—'} · IP:{' '}
                                  {rect.source_ip}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-600">
                          Autoria Inalterável: {ev.author_name} ·{' '}
                          {ev.author_council_number || '—'} · IP: {ev.source_ip}
                        </p>
                      </div>
                    ))
                  )}
                </section>
              )}

              {/* Official Normative Footer */}
              <footer className="border-t border-slate-200 pt-4 text-[11px] text-slate-600 flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold text-slate-800">
                    Termo de Autenticidade, Imutabilidade e Conformidade LGPD
                  </p>
                  <p className="mt-0.5">{dossier.lgpdNotice}</p>
                </div>
              </footer>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  );
}
