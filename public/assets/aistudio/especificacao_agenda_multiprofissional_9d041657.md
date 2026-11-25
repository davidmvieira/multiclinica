# Especificação funcional --- Agenda multiprofissional

## 1. Objetivo

Criar o módulo de agenda da plataforma SaaS de gestão de clínicas,
permitindo que cada profissional tenha sua **agenda independente**, sem
impedir a visualização e a gestão centralizada de várias agendas por
usuários autorizados.

A solução deve atender clínicas com atuação individual e
multiprofissional, inicialmente contemplando fisioterapia, nutrição,
estética e psicologia, com possibilidade de expansão para novas
especialidades.

**Diretriz principal:** cada profissional mantém sua própria agenda e
disponibilidade. A clínica pode reunir essas agendas em uma visão
consolidada, e a gestão pode ser delegada a uma ou mais pessoas,
conforme permissões.

## 2. Conceitos e regras fundamentais

1.  **Agenda independente por profissional:** cada profissional possui
    configurações próprias de disponibilidade, horários de trabalho,
    intervalos, bloqueios e agendamentos.
2.  **Visão consolidada:** a agenda geral apenas reúne visualmente as
    agendas individuais. Não deve criar uma agenda paralela nem duplicar
    agendamentos.
3.  **Gestão compartilhada:** uma agenda pode ser administrada por uma
    ou mais pessoas autorizadas. Uma pessoa também pode administrar
    várias agendas.
4.  **Multiprofissionalidade:** a clínica pode cadastrar profissionais
    de diferentes especialidades. Um profissional pode estar associado a
    uma ou mais especialidades, conforme as regras cadastrais da
    plataforma.
5.  **Separação entre disponibilidade e agendamento:** jornada/horários
    disponíveis, bloqueios e compromissos são conceitos distintos.
6.  **Vínculo organizacional:** todo registro deve respeitar a
    organização (clínica) e, quando aplicável, a unidade à qual
    pertence.
7.  **Sem duplicidade:** mudar a forma de visualizar a agenda não pode
    duplicar, transferir ou alterar os dados dos agendamentos.
8.  **Rastreabilidade:** operações relevantes devem registrar autor,
    data/hora e alterações realizadas.

## 3. Experiência de interface --- prioridade máxima: inspiração na Imagem A

O front-end deve ser **altamente inspirado na Imagem A**, a primeira
referência visual apresentada: calendário semanal em formato de grade,
com horários na vertical e uma coluna independente para cada
profissional.

A referência deve orientar principalmente a estrutura, a hierarquia
visual e a interação. Não é necessário copiar marca, textos, cores ou
elementos proprietários.

### 3.1 Estrutura visual da visão geral

-   Cabeçalho superior com título **Agenda**.
-   Navegação de período com data atual em destaque e controles para
    período anterior/próximo.
-   Ação visível **Hoje**.
-   Seletor de visualização: **Dia \| Semana \| Mês \| Lista**.
-   Filtros de unidade, especialidade, profissional e situação do
    agendamento.
-   Área principal em grade semanal:
    -   primeira coluna reservada aos horários;
    -   cada coluna seguinte representa um profissional;
    -   cabeçalho de cada coluna mostra nome do profissional e,
        opcionalmente, especialidade;
    -   horários organizados verticalmente, com escala consistente;
    -   compromissos posicionados conforme início e duração;
    -   rolagem vertical para percorrer o dia e, quando necessário,
        rolagem horizontal para visualizar muitos profissionais.
-   Cabeçalho dos profissionais e coluna de horários devem permanecer
    visíveis durante a rolagem, sempre que tecnicamente viável.
-   Diferenciar visualmente horários livres, ocupados e bloqueados sem
    poluir a grade.
-   Utilizar cores consistentes por profissional ou especialidade, com
    legenda discreta. A cor nunca deve ser o único indicador de
    situação: combinar com texto/ícone.
-   Evitar cartões excessivamente grandes. O cartão deve mostrar,
    conforme espaço disponível, horário, paciente, serviço/procedimento
    e situação.
-   Em telas menores, preservar a usabilidade: permitir selecionar um
    profissional ou grupo de profissionais e apresentar a agenda em
    formato adaptado, sem comprimir colunas até ficarem ilegíveis.

### 3.2 Cartão de agendamento

Cada compromisso deve ser apresentado como um cartão dentro da coluna do
profissional correspondente.

Informações mínimas: - horário de início e término; - nome do
paciente; - serviço/procedimento ou tipo de atendimento; - situação do
agendamento.

Ações disponíveis conforme permissão: - abrir detalhes; - editar; -
reagendar; - cancelar; - registrar chegada/comparecimento ou falta,
quando esse fluxo fizer parte do módulo.

O cartão deve indicar visualmente quando houver conflito, encaixe ou
outro estado relevante. Não exibir dados clínicos sensíveis na grade
geral.

### 3.3 Interações prioritárias

-   Clicar em um espaço livre abre o fluxo de criação de agendamento,
    com profissional, data e horário previamente preenchidos.
-   Clicar em um cartão abre seus detalhes.
-   A edição deve permitir alterar horário, duração, profissional,
    paciente e serviço, respeitando validações e permissões.
-   Arrastar e soltar pode ser oferecido para reagendamento, mas deve
    exigir validação de disponibilidade e confirmação quando houver
    mudança relevante.
-   Não permitir que uma ação de arrastar e soltar ignore conflitos,
    bloqueios, duração ou regras do profissional.
-   Toda alteração deve atualizar a visão individual e a consolidada,
    pois ambas representam os mesmos registros.

## 4. Modos de visualização

### 4.1 Geral --- padrão para recepção e gestão

Exibe simultaneamente as agendas dos profissionais selecionados, em
colunas, seguindo a Imagem A. Deve permitir selecionar todos ou apenas
alguns profissionais.

### 4.2 Individual --- padrão para o profissional

Exibe somente a agenda de um profissional, com visualizações diária,
semanal, mensal e lista. Deve facilitar a consulta da própria rotina,
disponibilidade e compromissos.

### 4.3 Lista

Apresenta os agendamentos em ordem cronológica, com filtros por data,
profissional, especialidade, unidade e situação. Deve facilitar busca,
conferência e operações administrativas.

### 4.4 Mensal

Apresenta visão resumida de ocupação por dia. Ao selecionar um dia,
permite acessar a visão diária detalhada.

## 5. Gestão por uma ou mais pessoas

A agenda pertence ao profissional no sentido operacional, mas a
administração pode ser delegada.

Regras: - Um profissional pode ter **um ou vários gestores
autorizados**. - Um gestor/recepcionista pode administrar **uma ou
várias agendas**. - A autorização deve ser configurável por agenda e, se
necessário, por unidade. - O profissional pode manter acesso à própria
agenda mesmo quando ela é administrada pela recepção. - A remoção de um
gestor não pode excluir a agenda nem seus agendamentos. - Ações
realizadas por terceiros devem ser identificadas no histórico.

### Permissões sugeridas

  ------------------------------------------------------------------------
  Perfil            Visualizar        Criar/editar      Configurar
                                      agendamento       disponibilidade
  ----------------- ----------------- ----------------- ------------------
  Administrador da  Todas as agendas  Conforme política Conforme política
  clínica           da organização    administrativa    administrativa

  Gestor da unidade Agendas           Agendas           Conforme
                    autorizadas da    autorizadas       autorização
                    unidade                             

  Recepção          Agendas           Agendas           Não, salvo
                    atribuídas        atribuídas        autorização
                                                        específica

  Profissional      Própria agenda    Própria agenda,   Própria
                                      conforme política disponibilidade,
                                      da clínica        conforme política

  Gestor delegado   Agendas que       Conforme          Somente se
                    recebeu           permissão         autorizado
                                      concedida         
  ------------------------------------------------------------------------

As permissões devem ser verificadas no servidor/API, não apenas
escondidas na interface. A matriz acima é uma proposta inicial e deve
ser ajustável pela política de acesso da organização.

## 6. Disponibilidade e regras de agendamento

Manter estruturas e fluxos distintos para:

-   **Jornada/horário de trabalho:** dias da semana, hora inicial/final
    e intervalos.
-   **Disponibilidade:** períodos em que o profissional aceita
    agendamentos.
-   **Bloqueios:** férias, ausências, reuniões, manutenção ou
    indisponibilidade pontual.
-   **Agendamentos:** compromissos vinculados a paciente e profissional.
-   **Exceções:** alterações pontuais em relação à disponibilidade
    recorrente.

Regras: - Não permitir sobreposição de agendamentos para o mesmo
profissional, salvo regra explícita de atendimento simultâneo. - Validar
duração do serviço, intervalos, antecedência mínima e limites
configurados. - Considerar fuso horário da unidade/clínica e persistir
datas de forma consistente. - Permitir encaixes somente para usuários
autorizados e com validação explícita. - Permitir recorrência e séries
de sessões, com possibilidade de revisar ocorrências antes de
confirmar. - Cancelamento e reagendamento devem preservar histórico; não
apagar silenciosamente o registro anterior.

## 7. Dados e relacionamentos essenciais

A modelagem deve contemplar, no mínimo:

-   **Organização/clínica**
-   **Unidade**
-   **Usuário**
-   **Profissional**
-   **Especialidade**
-   **Paciente**
-   **Serviço/procedimento**
-   **Agenda do profissional**
-   **Regra de disponibilidade**
-   **Bloqueio/ausência**
-   **Agendamento**
-   **Vínculo de gestor da agenda e permissões**
-   **Histórico/auditoria**

Um agendamento deve relacionar organização, unidade (quando aplicável),
profissional, paciente, serviço/procedimento, início, fim, situação e
dados de auditoria.

A agenda geral é uma consulta/visão agregada dos agendamentos das
agendas individuais autorizadas; não deve ser persistida como uma
segunda agenda independente.

## 8. Situações do agendamento

Definir estados claros e transições válidas. Sugestão inicial:

-   Pendente
-   Aguardando confirmação
-   Confirmado
-   Aguardando atendimento
-   Em atendimento
-   Realizado
-   Cancelado
-   Não compareceu

A lista final de estados e suas transições deve ser validada com os
fluxos operacionais da clínica. Evitar usar cor como único significado
do estado.

## 9. Segurança, privacidade e auditoria

-   Isolamento obrigatório entre organizações (multi-tenant).
-   Restringir acesso por organização, unidade, agenda e permissão
    concedida.
-   Não expor informações clínicas na visão geral da agenda.
-   Registrar criação, edição, cancelamento, reagendamento, mudança de
    profissional e alteração de permissões.
-   Guardar autor, data/hora e valores relevantes anteriores e
    posteriores.
-   Aplicar autorização também nas APIs e operações em lote.
-   Proteger dados pessoais e de saúde conforme LGPD e políticas da
    plataforma.

## 10. Escopo recomendado para o MVP

1.  Cadastro/configuração de agenda independente por profissional.
2.  Definição de jornada, disponibilidade e bloqueios.
3.  Visão semanal geral em colunas por profissional --- prioridade
    visual e funcional.
4.  Visão individual do profissional.
5.  Filtros por unidade, especialidade, profissional e situação.
6.  Criar, visualizar, editar, cancelar e reagendar agendamentos.
7.  Associação de uma ou mais pessoas gestoras a cada agenda.
8.  Permissões para visualizar, operar agendamentos e configurar
    disponibilidade.
9.  Validação de conflitos e sobreposição.
10. Histórico de alterações.

Deixar para etapas posteriores, se necessário: lista de espera
automatizada, notificações avançadas, confirmação automática, encaixes
com regras complexas, otimização de salas/recursos e relatórios
avançados.

## 11. Critérios de aceite

-   É possível criar agendas independentes para diferentes profissionais
    e especialidades.
-   A visão geral reúne várias agendas sem duplicar dados.
-   É possível filtrar a visão geral para exibir todos, um ou vários
    profissionais.
-   Uma pessoa autorizada consegue administrar mais de uma agenda.
-   Uma agenda pode ter mais de uma pessoa gestora.
-   Um profissional não acessa agendas de terceiros sem autorização.
-   Alterações feitas na visão geral aparecem na visão individual e
    vice-versa.
-   O sistema impede conflitos de horário conforme as regras
    configuradas.
-   Bloqueios e disponibilidade são respeitados ao criar ou reagendar.
-   Alterações relevantes ficam registradas em histórico.
-   A interface semanal geral mantém a organização em colunas por
    profissional, inspirada na Imagem A, e continua utilizável com
    muitos profissionais e em telas menores.

## 12. Orientação final para o front-end

**A prioridade de design é reproduzir a lógica visual da Imagem A:** uma
grade semanal de leitura imediata, horários na vertical e profissionais
em colunas independentes. A visão geral deve permitir entender
rapidamente quem está ocupado, quem tem horários livres e como está
distribuída a operação da clínica.

Não transformar a tela principal em uma tabela administrativa genérica.
A agenda deve parecer e funcionar como um calendário visual de gestão de
tempo. Os filtros, ações e indicadores devem complementar a grade, sem
competir com ela.

Manter consistência entre visão geral, individual, lista e mensal; todas
devem operar sobre os mesmos agendamentos e respeitar as mesmas regras
de negócio e permissões.
