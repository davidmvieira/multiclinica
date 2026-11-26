import type {
  MedicalRecordCategory,
  PatientAuditFieldChange,
  PatientOperationalStatus,
  PatientRecord,
} from '@/types/patients';

export const PATIENT_STATUS_LIST: PatientOperationalStatus[] = [
  'em_avaliacao',
  'em_tratamento',
  'em_acompanhamento',
  'alta',
  'inativo',
  'desistencia',
];

export const PATIENT_STATUS_META: Record<
  PatientOperationalStatus,
  {
    label: string;
    textClass: string;
    description: string;
  }
> = {
  em_avaliacao: {
    label: 'Em Avaliação',
    textClass: 'text-sky-700',
    description: 'Triagem inicial ou avaliação fisioterapêutica em andamento.',
  },
  em_tratamento: {
    label: 'Em Tratamento',
    textClass: 'text-emerald-700',
    description: 'Paciente em sessões ativas e plano terapêutico vigente.',
  },
  em_acompanhamento: {
    label: 'Em Acompanhamento',
    textClass: 'text-amber-700',
    description: 'Monitoramento periódico ou manutenção clínica.',
  },
  alta: {
    label: 'Alta',
    textClass: 'text-teal-700',
    description: 'Objetivos terapêuticos atingidos com alta registrada.',
  },
  inativo: {
    label: 'Inativo',
    textClass: 'text-slate-500',
    description: 'Cadastro pausado sem atendimentos programados.',
  },
  desistencia: {
    label: 'Desistência/Abandono',
    textClass: 'text-red-700',
    description: 'Interrupção sem alta ou abandono do tratamento.',
  },
};

export function isValidPatientStatus(
  value: unknown
): value is PatientOperationalStatus {
  return (
    typeof value === 'string' &&
    PATIENT_STATUS_LIST.includes(value as PatientOperationalStatus)
  );
}

export const MEDICAL_RECORD_CATEGORIES: MedicalRecordCategory[] = [
  'clinical',
  'administrative',
  'document',
];

export const MEDICAL_RECORD_CATEGORY_META: Record<
  MedicalRecordCategory,
  {
    label: string;
    shortLabel: string;
    description: string;
    accentClass: string;
  }
> = {
  clinical: {
    label: 'Registros Clínicos',
    shortLabel: 'Clínico',
    description:
      'Avaliações, anamneses, evoluções de sessão e condutas terapêuticas (imutáveis após conclusão).',
    accentClass: 'text-emerald-700',
  },
  administrative: {
    label: 'Registros Administrativos',
    shortLabel: 'Administrativo',
    description:
      'Admissões, alterações cadastrais, mudanças de situação operacional e contatos.',
    accentClass: 'text-sky-700',
  },
  document: {
    label: 'Documentos Anexados',
    shortLabel: 'Documento',
    description:
      'Laudos, exames de imagem, encaminhamentos médicos e termos assinados.',
    accentClass: 'text-amber-700',
  },
};

export const RECORD_SUBTYPES_BY_CATEGORY: Record<
  MedicalRecordCategory,
  { value: string; label: string }[]
> = {
  clinical: [
    { value: 'evolucao', label: 'Evolução de Sessão' },
    { value: 'avaliacao', label: 'Avaliação Fisioterapêutica' },
    { value: 'anamnese', label: 'Anamnese' },
    { value: 'plano_terapeutico', label: 'Plano Terapêutico' },
    { value: 'alta_clinica', label: 'Relatório de Alta' },
  ],
  administrative: [
    { value: 'contato', label: 'Contato Administrativo' },
    { value: 'admissao', label: 'Admissão / Acolhimento' },
    { value: 'alteracao_cadastral', label: 'Alteração Cadastral' },
    { value: 'alteracao_status', label: 'Mudança de Situação' },
    { value: 'ocorrencia', label: 'Ocorrência Administrativa' },
  ],
  document: [
    { value: 'laudo', label: 'Laudo Médico' },
    { value: 'exame', label: 'Exame / Imagem' },
    { value: 'encaminhamento', label: 'Encaminhamento' },
    { value: 'termo', label: 'Termo / Consentimento' },
    { value: 'outro', label: 'Outro Documento' },
  ],
};

export const ALT_IDENTIFIER_TYPES = [
  'RG',
  'CNS (Cartão SUS)',
  'Certidão de Nascimento',
  'Passaporte',
  'RNM / RNE',
  'Outro',
] as const;

export function getRecordSubtypeLabel(
  category: MedicalRecordCategory,
  recordType: string
): string {
  const list = RECORD_SUBTYPES_BY_CATEGORY[category] ?? [];
  return list.find((item) => item.value === recordType)?.label ?? recordType;
}

export function normalizeCpfDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(value: string | null | undefined): string {
  const digits = normalizeCpfDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeCpfDigits(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  if (remainder !== Number(digits[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10) remainder = 0;
  return remainder === Number(digits[10]);
}

export function isSafeHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const ALLOWED_DOCUMENT_DATA_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
]);

export function isAllowedDocumentDataUrl(dataUrl: string): {
  valid: boolean;
  mime?: string;
} {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(
    dataUrl.trim()
  );
  if (!match) return { valid: false };
  const mime = match[1].toLowerCase();
  if (!ALLOWED_DOCUMENT_DATA_MIMES.has(mime)) return { valid: false };
  // Cap raw base64 size (~2 MB decoded max)
  if (match[2].length > 2_800_000) return { valid: false };
  return { valid: true, mime };
}

const AUDITED_PATIENT_FIELDS: {
  key: keyof PatientRecord;
  label: string;
  format?: (val: unknown) => string | null;
}[] = [
  { key: 'name', label: 'Nome completo' },
  { key: 'social_name', label: 'Nome social' },
  {
    key: 'status',
    label: 'Situação operacional',
    format: (v) =>
      isValidPatientStatus(v) ? PATIENT_STATUS_META[v].label : String(v ?? ''),
  },
  {
    key: 'cpf',
    label: 'CPF',
    format: (v) => (v ? formatCpf(String(v)) : null),
  },
  {
    key: 'has_no_cpf',
    label: 'Cadastro sem CPF',
    format: (v) => (v ? 'Sim' : 'Não'),
  },
  { key: 'alt_identifier_type', label: 'Tipo de identificador alternativo' },
  { key: 'alt_identifier_value', label: 'Identificador alternativo' },
  { key: 'birth_date', label: 'Data de nascimento' },
  { key: 'gender', label: 'Gênero' },
  { key: 'phone', label: 'Telefone principal' },
  { key: 'secondary_phone', label: 'Telefone secundário' },
  { key: 'email', label: 'E-mail' },
  { key: 'address_zip', label: 'CEP' },
  { key: 'address_street', label: 'Logradouro' },
  { key: 'address_number', label: 'Número' },
  { key: 'address_complement', label: 'Complemento' },
  { key: 'address_neighborhood', label: 'Bairro' },
  { key: 'address_city', label: 'Cidade' },
  { key: 'address_state', label: 'UF' },
  { key: 'legal_guardian_name', label: 'Responsável legal' },
  { key: 'legal_guardian_relationship', label: 'Vínculo do responsável' },
  { key: 'legal_guardian_phone', label: 'Telefone do responsável' },
  {
    key: 'legal_guardian_cpf',
    label: 'CPF do responsável',
    format: (v) => (v ? formatCpf(String(v)) : null),
  },
  { key: 'emergency_contact_name', label: 'Contato de emergência' },
  {
    key: 'emergency_contact_relationship',
    label: 'Relação (emergência)',
  },
  { key: 'emergency_contact_phone', label: 'Telefone de emergência' },
  { key: 'notes', label: 'Observações cadastrais' },
];

function normalizeAuditValue(
  val: unknown,
  formatter?: (v: unknown) => string | null
): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (formatter) return formatter(val);
  return String(val);
}

export function computePatientAuditDiff(
  previous: Partial<PatientRecord>,
  next: Partial<PatientRecord>
): PatientAuditFieldChange[] {
  const changes: PatientAuditFieldChange[] = [];
  for (const field of AUDITED_PATIENT_FIELDS) {
    const before = normalizeAuditValue(previous[field.key], field.format);
    const after = normalizeAuditValue(next[field.key], field.format);
    if (before !== after) {
      changes.push({
        field: String(field.key),
        label: field.label,
        before,
        after,
      });
    }
  }
  return changes;
}
