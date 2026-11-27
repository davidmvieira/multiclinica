import type {
  CbdfCatalogItem,
  EvaluationAnswerValue,
  EvaluationAuditAction,
  EvaluationSectionDefinition,
  EvaluationTemplateSchema,
  ProcedureCodeOption,
} from '@/types/evaluations';

export interface HomologatedTemplateSeed {
  slug: string;
  name: string;
  category_label: string;
  description: string;
  changelog: string;
  schema: EvaluationTemplateSchema;
}

export const EVALUATION_AUDIT_ACTION_LABELS: Record<
  EvaluationAuditAction,
  string
> = {
  OPEN_DRAFT: 'Abertura / edição de rascunho',
  VIEW_EVALUATION: 'Visualização de avaliação concluída',
  FINALIZE_EVALUATION: 'Conclusão e assinatura clínica',
  EXPORT_PDF: 'Exportação em PDF / impressão',
  SHARE_SUMMARY: 'Compartilhamento de resumo LGPD',
  DENIED_RESTRICTED_ACCESS: 'Tentativa bloqueada a conteúdo restrito',
};

export const CBDF_CATALOG: CbdfCatalogItem[] = [
  {
    code: 'CBDF-S01.10',
    chapter: 'Saúde Cinético-Funcional — Dor e Mobilidade Articular',
    description:
      'Deficiência cinético-funcional associada à dor musculoesquelética aguda ou subaguda com restrição de amplitude de movimento',
  },
  {
    code: 'CBDF-S01.24',
    chapter: 'Saúde Cinético-Funcional — Coluna Vertebral',
    description:
      'Disfunção cinético-funcional da coluna vertebral com comprometimento de estabilidade segmentar e tolerância à carga',
  },
  {
    code: 'CBDF-S02.08',
    chapter: 'Saúde Cinético-Funcional — Sistema Neuromuscular',
    description:
      'Deficiência cinético-funcional por alteração de força muscular, recrutamento motor ou resistência localizada',
  },
  {
    code: 'CBDF-S03.12',
    chapter: 'Saúde Cinético-Funcional — Controle Motor e Equilíbrio',
    description:
      'Disfunção cinético-funcional do controle motor, equilíbrio postural e coordenação da marcha com risco de queda',
  },
  {
    code: 'CBDF-S04.05',
    chapter: 'Saúde Cinético-Funcional — Postura e Biomecânica',
    description:
      'Alteração cinético-funcional do alinhamento postural estático e dinâmico com sobrecarga de cadeias miofasciais',
  },
  {
    code: 'CBDF-S05.18',
    chapter: 'Saúde Cinético-Funcional — Pós-Operatório Ortopédico',
    description:
      'Limitação cinético-funcional transitória em fase de reabilitação pós-cirúrgica ortopédica e proteção tecidual',
  },
  {
    code: 'CBDF-S06.03',
    chapter: 'Saúde Cinético-Funcional — Condicionamento e Funcionalidade',
    description:
      'Redução da capacidade funcional global e intolerância ao esforço em atividades básicas e instrumentais de vida diária',
  },
  {
    code: 'CBDF-S07.11',
    chapter: 'Saúde Cinético-Funcional — Gerontologia e Fragilidade',
    description:
      'Declínio cinético-funcional associado à sarcopenia, instabilidade postural e restrição de mobilidade comunitária',
  },
];

export const PROCEDURE_CODE_SUGGESTIONS: ProcedureCodeOption[] = [
  {
    code: 'TUSS-50000470',
    table: 'TUSS / RNPF',
    description: 'Consulta / Avaliação fisioterapêutica inicial',
  },
  {
    code: 'TUSS-50000144',
    table: 'TUSS / RNPF',
    description:
      'Reabilitação em disfunções musculoesqueléticas / traumato-ortopédicas',
  },
  {
    code: 'TUSS-50000152',
    table: 'TUSS / RNPF',
    description: 'Reabilitação neurofuncional e controle motor',
  },
  {
    code: 'TUSS-50000217',
    table: 'TUSS / RNPF',
    description: 'Reeducação postural e cinesioterapia global',
  },
  {
    code: 'TUSS-50000462',
    table: 'TUSS / RNPF',
    description: 'Cinesioterapia clínica supervisionada (Pilates terapêutico)',
  },
  {
    code: 'TUSS-50000381',
    table: 'TUSS / RNPF',
    description: 'Atendimento fisioterapêutico em gerontologia e marcha',
  },
];

export const HOMOLOGATED_TEMPLATES: HomologatedTemplateSeed[] = [
  {
    slug: 'geral',
    name: 'Avaliação Fisioterapêutica Geral',
    category_label: 'Fisioterapia Geral',
    description:
      'Instrumento homologado para triagem cinético-funcional global, dor (EVA), exame físico básico e objetivos terapêuticos.',
    changelog: 'Versão inicial homologada (v1) — Estrutura padrão clínica.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Seção de anamnese restrita ao fisioterapeuta autor (LGPD Art. 11).',
      sections: [
        {
          id: 'anamnese_restrita',
          order: 1,
          title: '1. Anamnese e Histórico Clínico Confidencial',
          description:
            'Conteúdo sigiloso visível exclusivamente ao fisioterapeuta responsável pela avaliação.',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'queixa_principal',
              label: 'Queixa principal (QP)',
              type: 'textarea',
              required: true,
              placeholder: 'Descreva a queixa relatada com palavras do paciente...',
            },
            {
              id: 'hda_detalhada',
              label: 'História da doença atual (HDA)',
              type: 'textarea',
              required: true,
              placeholder: 'Início, evolução, fatores de piora/alívio e tratamentos prévios...',
            },
            {
              id: 'comorbidades_medicacoes',
              label: 'Antecedentes pessoais, comorbidades e medicações em uso',
              type: 'textarea',
              required: false,
              placeholder: 'HAS, diabetes, cirurgias prévias, analgésicos, alergias...',
            },
            {
              id: 'bandeiras_vermelhas',
              label: 'Presença de sinais de alerta (Red Flags)?',
              type: 'boolean',
              required: true,
            },
          ],
        },
        {
          id: 'dor_e_sinais',
          order: 2,
          title: '2. Dor e Parâmetros Clínicos Basais',
          description: 'Registro objetivo de intensidade dolorosa e sinais funcionais.',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'eva_dor_repouso',
              label: 'Escala Visual Analógica de Dor (EVA) — Repouso',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
            {
              id: 'eva_dor_movimento',
              label: 'Escala Visual Analógica de Dor (EVA) — Ao movimento',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
            {
              id: 'pa_fc_observacao',
              label: 'Sinais vitais / observações basais (PA, FC, SpO2)',
              type: 'text',
              required: false,
              placeholder: 'Ex.: PA 120x80 mmHg · FC 72 bpm · SpO2 98%',
            },
          ],
        },
        {
          id: 'exame_cinetico_geral',
          order: 3,
          title: '3. Exame Cinético-Funcional Global',
          description: 'Avaliação de inspeção, mobilidade, força e funcionalidade.',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'inspecao_palpacao',
              label: 'Inspeção estática, trofismo e palpação',
              type: 'textarea',
              required: true,
              placeholder: 'Edema, cicatrizes, pontos gatilho, assimetrias visíveis...',
            },
            {
              id: 'amplitude_movimento_resumo',
              label: 'Amplitude de movimento (ADM) e mobilidade global',
              type: 'select',
              required: true,
              options: [
                'Preservada sem dor',
                'Preservada com dor ao fim do arco',
                'Redução leve (< 25%)',
                'Redução moderada (25% a 50%)',
                'Redução acentuada (> 50%)',
              ],
            },
            {
              id: 'forca_muscular_mrc',
              label: 'Força muscular global predominante (Escala MRC 0–5)',
              type: 'scale_mrc',
              required: true,
              min: 0,
              max: 5,
              step: 1,
            },
            {
              id: 'limitacoes_funcionais',
              label: 'Limitações funcionais e impacto nas AVDs',
              type: 'textarea',
              required: true,
              placeholder: 'Atividades laborais, marcha, transferências, autocuidado...',
            },
          ],
        },
        {
          id: 'plano_multidisciplinar',
          order: 4,
          title: '4. Objetivos e Orientações para Equipe Multiprofissional',
          description:
            'Campos compartilhados com a equipe clínica da organização em conformidade com o princípio de minimização.',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'objetivos_curto_prazo',
              label: 'Objetivos terapêuticos (curto e médio prazo)',
              type: 'textarea',
              required: true,
              placeholder: 'Analgesia, ganho de ADM, reeducação funcional, retorno às AVDs...',
            },
            {
              id: 'frequencia_sugerida',
              label: 'Frequência semanal recomendada',
              type: 'select',
              required: true,
              options: [
                '1x por semana',
                '2x por semana',
                '3x por semana',
                'Diária / intensiva',
                'Reavaliação quinzenal',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'ortopedica',
    name: 'Avaliação Traumato-Ortopédica',
    category_label: 'Ortopedia e Esportiva',
    description:
      'Protocolo homologado para disfunções osteomioarticulares com mecanismo de trauma, EVA, goniometria, força MRC e testes ortopédicos especiais.',
    changelog: 'Versão inicial homologada (v1) — Protocolo traumato-ortopédico.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Mecanismo de lesão e antecedentes cirúrgicos sigilosos ao autor.',
      sections: [
        {
          id: 'anamnese_ortopedica_restrita',
          order: 1,
          title: '1. Anamnese Ortopédica e Mecanismo de Lesão (Sigiloso)',
          description: 'Dados sensíveis de entrevista clínica restritos ao autor.',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'segmento_acometido',
              label: 'Região / Articulação principal acometida',
              type: 'select',
              required: true,
              options: [
                'Coluna Cervical',
                'Coluna Lombar',
                'Ombro / Cintura Escapular',
                'Cotovelo / Punho / Mão',
                'Quadril / Pelve',
                'Joelho',
                'Tornozelo / Pé',
              ],
            },
            {
              id: 'mecanismo_trauma',
              label: 'Mecanismo de lesão e histórico cirúrgico/imagem',
              type: 'textarea',
              required: true,
              placeholder: 'Entorse, sobrecarga repetitiva, pós-op LCA, laudos de RM/RX...',
            },
            {
              id: 'data_evento',
              label: 'Data aproximada do início dos sintomas / cirurgia',
              type: 'date',
              required: false,
            },
          ],
        },
        {
          id: 'dor_e_irritabilidade',
          order: 2,
          title: '2. Quadro Álgico e Irritabilidade Tecidual',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'eva_ortopedica',
              label: 'EVA atual no segmento acometido (0–10)',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
            {
              id: 'estagio_tecidual',
              label: 'Fase de reparo / irritabilidade tecidual',
              type: 'select',
              required: true,
              options: [
                'Aguda / Alta irritabilidade',
                'Subaguda / Moderada irritabilidade',
                'Crônica / Baixa irritabilidade',
                'Pós-operatório imediato (proteção máxima)',
              ],
            },
          ],
        },
        {
          id: 'exame_fisico_ortopedico',
          order: 3,
          title: '3. Goniometria, Força Muscular e Testes Especiais',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'goniometria_adm',
              label: 'Registro de Goniometria (ADM ativa vs. passiva)',
              type: 'textarea',
              required: true,
              placeholder: 'Ex.: Flexão joelho D 105° ativa / 115° passiva; extensão -5°...',
            },
            {
              id: 'mrc_grupo_alvo',
              label: 'Força muscular do grupo agonista principal (MRC 0–5)',
              type: 'scale_mrc',
              required: true,
              min: 0,
              max: 5,
              step: 1,
            },
            {
              id: 'testes_ortopedicos_especiais',
              label: 'Testes ortopédicos especiais realizados e resultados',
              type: 'textarea',
              required: true,
              placeholder: 'Ex.: Lachman (-), Neer (+), Lasègue (-), Phalen (-)...',
            },
            {
              id: 'perimetria_edema',
              label: 'Perimetria / presença de derrame articular ou edema',
              type: 'text',
              required: false,
              placeholder: 'Diferença em cm bilateral ou sinal da tecla...',
            },
          ],
        },
        {
          id: 'conduta_ortopedica',
          order: 4,
          title: '4. Restrições de Carga e Metas Funcionais',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'restricao_carga',
              label: 'Condição de descarga de peso / órteses',
              type: 'select',
              required: true,
              options: [
                'Carga total liberada',
                'Carga parcial com auxiliar de marcha',
                'Sem descarga de peso (descarga zero)',
                'Uso contínuo de imobilizador/tipoia',
              ],
            },
            {
              id: 'metas_retorno_funcional',
              label: 'Metas de reabilitação e critérios de progressão',
              type: 'textarea',
              required: true,
              placeholder: 'Restauração de extensão completa, simetria > 85%, retorno ao esporte...',
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'neurologica',
    name: 'Avaliação Neurofuncional',
    category_label: 'Neurologia Adulto e Infantil',
    description:
      'Avaliação estruturada de tônus (Ashworth), controle motor, equilíbrio (Berg/TUG), marcha e independência nas AVDs.',
    changelog: 'Versão inicial homologada (v1) — Protocolo neurofuncional.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Antecedentes neurológicos detalhados protegidos ao autor.',
      sections: [
        {
          id: 'anamnese_neuro_restrita',
          order: 1,
          title: '1. Histórico Neurológico e Contexto Clínico (Sigiloso)',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'quadro_clinico_neuro',
              label: 'Histórico do evento neurológico e evolução',
              type: 'textarea',
              required: true,
              placeholder: 'AVE, TCE, lesão medular, Parkinson, tempo de lesão, suporte familiar...',
            },
            {
              id: 'crises_convulsivas_alerta',
              label: 'Histórico recente de crises convulsivas ou disautonomia?',
              type: 'boolean',
              required: true,
            },
          ],
        },
        {
          id: 'tonus_sensibilidade',
          order: 2,
          title: '2. Tônus Muscular, Reflexos e Sensibilidade',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'tonus_ashworth',
              label: 'Classificação predominante do tônus (Ashworth Modificada)',
              type: 'select',
              required: true,
              options: [
                'Normotonia',
                'Hipotonia / Flacidez',
                'Grau 1 — Leve aumento no fim do arco',
                'Grau 1+ — Resistência mínima em menos da metade do arco',
                'Grau 2 — Aumento mais marcado na maior parte do arco',
                'Grau 3 — Aumento considerável, movimento passivo difícil',
                'Grau 4 — Parte afetada rígida em flexão ou extensão',
              ],
            },
            {
              id: 'sensibilidade_superficial_profunda',
              label: 'Sensibilidade tátil, térmica e proprioceptiva',
              type: 'textarea',
              required: true,
              placeholder: 'Preservada, hipoestesia em dimídio D/E, alteração proprioceptiva distal...',
            },
            {
              id: 'mrc_neuro_dominante',
              label: 'Força muscular funcional do segmento parético (MRC 0–5)',
              type: 'scale_mrc',
              required: true,
              min: 0,
              max: 5,
              step: 1,
            },
          ],
        },
        {
          id: 'equilibrio_marcha_avds',
          order: 3,
          title: '3. Equilíbrio, Coordenação, Marcha e Independência',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'escala_berg_pontuacao',
              label: 'Pontuação na Escala de Equilíbrio de Berg (0 a 56)',
              type: 'number',
              required: false,
              min: 0,
              max: 56,
              unit: 'pts',
            },
            {
              id: 'padrao_marcha_locomocao',
              label: 'Padrão de marcha e dispositivos auxiliares',
              type: 'select',
              required: true,
              options: [
                'Marcha independente comunitária',
                'Marcha com bengala / muleta',
                'Marcha com andador e supervisão',
                'Deambulação terapêutica assistida',
                'Cadeirante (transferências independentes ou assistidas)',
              ],
            },
            {
              id: 'independencia_funcional_resumo',
              label: 'Independência funcional e metas neuroplásticas',
              type: 'textarea',
              required: true,
              placeholder: 'Controle de tronco, alcance funcional, dissociação de cinturas, AVDs...',
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'postural',
    name: 'Avaliação Postural e Biomecânica',
    category_label: 'Postura e Reeducação Global',
    description:
      'Inspeção postural nas vistas anterior, lateral e posterior, cadeias musculares, flexibilidade e síntese biomecânica.',
    changelog: 'Versão inicial homologada (v1) — Inspeção postural multivistas.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Hábitos ocupacionais e queixas pessoais restritos ao autor.',
      sections: [
        {
          id: 'anamnese_postural_restrita',
          order: 1,
          title: '1. Hábitos Ocupacionais e Histórico de Sobrecarga (Sigiloso)',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'rotina_ergonomica',
              label: 'Jornada postural, ergonomia e queixas associadas',
              type: 'textarea',
              required: true,
              placeholder: 'Tempo sentado, postura de trabalho, prática esportiva, dor crônica...',
            },
          ],
        },
        {
          id: 'vistas_posturais',
          order: 2,
          title: '2. Alinhamento Postural (Vistas Anterior, Lateral e Posterior)',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'eva_desconforto_postural',
              label: 'Intensidade de dor / fadiga postural habitual (EVA 0–10)',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
            {
              id: 'vista_anterior_achados',
              label: 'Vista Anterior (cabeça, ombros, EIAS, joelhos, arcos plantares)',
              type: 'textarea',
              required: true,
              placeholder: 'Desnível de ombros, joelho valgo/varo, rotação pélvica...',
            },
            {
              id: 'vista_lateral_achados',
              label: 'Vista Lateral (anteriorização cefálica, cifose, lordose, pelve)',
              type: 'textarea',
              required: true,
              placeholder: 'Protrusão cervical, hipercifose torácica, anteversão pélvica...',
            },
            {
              id: 'vista_posterior_achados',
              label: 'Vista Posterior (escápulas, escoliose/Adams, alinhamento calcâneo)',
              type: 'textarea',
              required: true,
              placeholder: 'Escápula alada, gibosidade no teste de Adams, calcâneo valgo...',
            },
          ],
        },
        {
          id: 'cadeias_e_flexibilidade',
          order: 3,
          title: '3. Cadeias Musculares e Encurtamentos',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'cadeias_predominantes',
              label: 'Cadeias musculares com maior tensão/encurtamento',
              type: 'multiselect',
              required: true,
              options: [
                'Cadeia Posterior (isquiotibiais/tríceps sural/paravertebrais)',
                'Cadeia Anterior (iliopsoas/reto femoral/peitorais)',
                'Cadeia Inspiratória / Diafragmática',
                'Cadeia Cruzada / Rotadores de Tronco',
              ],
            },
            {
              id: 'sintese_biomecanica',
              label: 'Síntese biomecânica e prioridades de correção',
              type: 'textarea',
              required: true,
              placeholder: 'Desequilíbrios primários vs. compensações secundárias...',
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'pilates',
    name: 'Avaliação Clínica para Pilates',
    category_label: 'Pilates Clínico e Cinesioterapia',
    description:
      'Triagem clínica para prescrição segura de Pilates terapêutico: contraindicações, controle de Powerhouse, mobilidade e progressão.',
    changelog: 'Versão inicial homologada (v1) — Triagem Pilates Clínico.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Triagem médica confidencial restrita ao autor.',
      sections: [
        {
          id: 'triagem_pilates_restrita',
          order: 1,
          title: '1. Triagem Clínica e Restrições Médicas (Sigiloso)',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'historico_lesoes_pilates',
              label: 'Histórico de lesões, cirurgias, gestação ou labirintite',
              type: 'textarea',
              required: true,
              placeholder: 'Hérnia discal, osteoporose, próteses, gestação, tontura postural...',
            },
            {
              id: 'liberacao_medica_atividade',
              label: 'Paciente apto para cinesioterapia assistida sem restrição cardiológica?',
              type: 'boolean',
              required: true,
            },
          ],
        },
        {
          id: 'controle_central_mobilidade',
          order: 2,
          title: '2. Estabilidade Central (Powerhouse) e Mobilidade Segmentar',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'eva_pilates_inicial',
              label: 'Nível de dor pré-sessão (EVA 0–10)',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
            {
              id: 'ativacao_core_respiracao',
              label: 'Padrão respiratório e recrutamento de transverso/assoalho pélvico',
              type: 'select',
              required: true,
              options: [
                'Recrutamento adequado com comando verbal',
                'Dificuldade parcial — necessita feedback tátil',
                'Incoordenação respiratória / compensação abdominal',
                'Déficit acentuado de estabilização lombopélvica',
              ],
            },
            {
              id: 'mobilidade_coluna_quadril',
              label: 'Mobilidade articular de coluna torácica, lombar e quadris',
              type: 'textarea',
              required: true,
              placeholder: 'Flexão segmentar, rotação torácica, dissociação coxofemoral...',
            },
          ],
        },
        {
          id: 'prescricao_aparelhos',
          order: 3,
          title: '3. Prescrição Inicial e Cuidados nos Aparelhos',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'aparelhos_indicados',
              label: 'Recursos / aparelhos prioritários',
              type: 'multiselect',
              required: true,
              options: [
                'Reformer',
                'Cadillac / Trapézio',
                'Step Chair',
                'Ladder Barrel',
                'Mat / Solo com acessórios',
              ],
            },
            {
              id: 'movimentos_evitar',
              label: 'Movimentos contraindicados ou que exigem adaptação',
              type: 'textarea',
              required: true,
              placeholder: 'Ex.: Evitar flexão lombar com carga, adaptar apoio cervical...',
            },
          ],
        },
      ],
    },
  },
  {
    slug: 'geriatrica',
    name: 'Avaliação Geriátrica / Gerontológica',
    category_label: 'Gerontologia e Funcionalidade',
    description:
      'Avaliação gerontológica multidimensional com histórico de quedas, Timed Up and Go (TUG), força MRC, risco funcional e metas de autonomia.',
    changelog: 'Versão inicial homologada (v1) — Protocolo gerontológico.',
    schema: {
      homologationNote:
        'Formulário homologado Iatris v1 · Polifarmácia e histórico familiar sigilosos ao autor.',
      sections: [
        {
          id: 'anamnese_geriatrica_restrita',
          order: 1,
          title: '1. Histórico de Quedas, Polifarmácia e Rede de Apoio (Sigiloso)',
          is_restricted_to_author: true,
          fields: [
            {
              id: 'quedas_ultimos_12_meses',
              label: 'Número de quedas nos últimos 12 meses',
              type: 'number',
              required: true,
              min: 0,
              max: 50,
              unit: 'quedas',
            },
            {
              id: 'polifarmacia_contexto',
              label: 'Uso de múltiplos medicamentos, tontura ou contexto domiciliar',
              type: 'textarea',
              required: true,
              placeholder: 'Anti-hipertensivos, sedativos, tapetes/escadas, cuidador...',
            },
          ],
        },
        {
          id: 'desempenho_mobilidade_tug',
          order: 2,
          title: '2. Testes de Mobilidade, Equilíbrio e Força Muscular',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'tug_segundos',
              label: 'Timed Up and Go (TUG) — Tempo em segundos',
              type: 'number',
              required: true,
              min: 1,
              max: 180,
              step: 0.1,
              unit: 's',
              helpText: 'Referência: ≤10s normal · 11–20s fragilidade leve · >20s alto risco de queda.',
            },
            {
              id: 'sentar_levantar_5x',
              label: 'Teste Sentar e Levantar 5x (tempo em segundos)',
              type: 'number',
              required: false,
              min: 1,
              max: 180,
              step: 0.1,
              unit: 's',
            },
            {
              id: 'mrc_mmii_geriatria',
              label: 'Força funcional de membros inferiores (MRC 0–5)',
              type: 'scale_mrc',
              required: true,
              min: 0,
              max: 5,
              step: 1,
            },
            {
              id: 'eva_dor_geriatrica',
              label: 'Dor musculoesquelética predominante (EVA 0–10)',
              type: 'scale_eva',
              required: true,
              min: 0,
              max: 10,
              step: 1,
            },
          ],
        },
        {
          id: 'autonomia_avds_plano',
          order: 3,
          title: '3. Capacidade Funcional nas AVDs e Plano Preventivo',
          is_restricted_to_author: false,
          fields: [
            {
              id: 'nivel_autonomia_avds',
              label: 'Nível de autonomia nas Atividades de Vida Diária (AVDs)',
              type: 'select',
              required: true,
              options: [
                'Independente para AVDs e AIVDs',
                'Independente para AVDs básicas com supervisão em AIVDs',
                'Dependência parcial para transferências e banho',
                'Dependência acentuada — foco em prevenção de imobilismo',
              ],
            },
            {
              id: 'plano_prevencao_quedas',
              label: 'Conduta multicomponente e orientações à família/equipe',
              type: 'textarea',
              required: true,
              placeholder: 'Treino de força resistida, duplo-tarefa, adaptações ambientais...',
            },
          ],
        },
      ],
    },
  },
];

export function isAnswerFilled(
  value: EvaluationAnswerValue | undefined,
  type: EvaluationSectionDefinition['fields'][number]['type']
): boolean {
  if (value === undefined || value === null) return false;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number' || type === 'scale_eva' || type === 'scale_mrc') {
    return typeof value === 'number' && !Number.isNaN(value);
  }
  if (type === 'multiselect') {
    return Array.isArray(value) && value.length > 0;
  }
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateEvaluationForConclusion(
  schema: EvaluationTemplateSchema,
  answers: Record<string, EvaluationAnswerValue>,
  input: {
    functionalDiagnosis: string | null | undefined;
    cbdfCode: string | null | undefined;
    cbdfDescription: string | null | undefined;
    authorCouncilNumber: string | null | undefined;
  }
): { ok: true } | { ok: false; missingFields: string[]; error: string } {
  const missingFields: string[] = [];

  const orderedSections = [...schema.sections].sort(
    (a, b) => a.order - b.order
  );

  for (const section of orderedSections) {
    for (const field of section.fields) {
      if (!field.required) continue;
      if (!isAnswerFilled(answers[field.id], field.type)) {
        missingFields.push(`${section.title}: ${field.label}`);
      }
    }
  }

  if (!input.functionalDiagnosis || input.functionalDiagnosis.trim().length < 5) {
    missingFields.push('Diagnóstico Fisioterapêutico funcional');
  }
  if (!input.cbdfCode || !input.cbdfCode.trim()) {
    missingFields.push('Código CBDF');
  }
  if (!input.cbdfDescription || input.cbdfDescription.trim().length < 5) {
    missingFields.push('Descrição da classificação CBDF');
  }
  if (!input.authorCouncilNumber || input.authorCouncilNumber.trim().length < 3) {
    missingFields.push('Registro no conselho profissional (ex.: CREFITO)');
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      missingFields,
      error: `Preencha todos os campos obrigatórios antes de concluir a avaliação (${missingFields.length} pendência${missingFields.length > 1 ? 's' : ''}).`,
    };
  }

  return { ok: true };
}
