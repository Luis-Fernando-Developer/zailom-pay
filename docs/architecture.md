# Arquitetura inicial

## Contextos

- **Core financeiro:** participantes, empresas, produtos de origem, contas contábeis, lançamentos e auditoria.
- **Payments:** intenção de pagamento, tentativa, confirmação, cancelamento, reembolso e chargeback.
- **Allocation:** regras versionadas de comissão, taxas e distribuição entre empresa, profissionais e Zailom.
- **Receivables:** valores a receber, prazos, reservas, bloqueios e disponibilidade.
- **Payouts:** solicitações e ordens de saque, agendamento, execução, falha e conciliação.
- **Anticipation:** simulações e operações de antecipação, sujeitas à elegibilidade e oferta do provedor.
- **Provider integrations:** interface comum e adaptadores independentes (Z2PAY primeiro).
- **Reconciliation:** comparação entre eventos, transações, saldos e repasses do provedor.
- **Product API:** integração autenticada para Booking, Flow, Orbit e outros produtos.

## Modelo de integração

Produtos Zailom -> API Zailom Pay -> domínio financeiro/ledger -> adaptador do provedor -> infraestrutura financeira contratada.

Os produtos não devem integrar diretamente com a Z2PAY nem armazenar credenciais dela. O Zailom Pay mantém IDs externos e referências necessárias para rastreabilidade.

## Ledger

O ledger será de partidas dobradas. Cada operação contabilizada gera uma transação com dois ou mais lançamentos, e a soma dos débitos deve ser igual à soma dos créditos na mesma moeda.

Não manter saldo como fonte primária de verdade. Saldos apresentados na API serão derivados dos lançamentos ou de projeções reconstruíveis e verificáveis.

Separar, no mínimo:
- pendente de confirmação;
- recebível futuro;
- liquidado pelo provedor;
- disponível para saque;
- reservado/bloqueado;
- antecipado;
- pago/transferido;
- estornado/reembolsado;
- contestado/chargeback.

## Distribuição

As regras de distribuição devem ser versionadas e congeladas na transação no momento da venda. Alterações futuras não podem modificar vendas anteriores.

Uma distribuição pode conter:
- valor bruto;
- custo do meio de pagamento;
- tarifa Zailom;
- comissão de profissional;
- valor líquido da empresa;
- reservas e ajustes.

O motor calcula a distribuição; o adaptador do provedor executa a operação compatível com o contrato e a API disponíveis. Não presumir que split externo, saldo interno e saque são a mesma operação.

## Segurança e integridade

- Idempotency key obrigatória para comandos financeiros críticos.
- Webhooks verificados, persistidos antes do processamento e processados de forma idempotente.
- Controle de acesso por produto, empresa e participante.
- Trilha de auditoria para ações administrativas.
- Nenhuma credencial de provedor no frontend.
- Nenhum endpoint de saque sem autorização, validação de titularidade e política de risco.
- Valores sempre em centavos e moeda explícita.

## Limites importantes

O ledger do Zailom é registro contábil e operacional. A guarda, liquidação e movimentação efetiva dos recursos dependem da instituição/provedor contratado e do modelo aprovado. A arquitetura não deve pressupor que a Zailom pode custodiar recursos de terceiros em conta própria.

## Decisões ainda abertas

- Framework/backend e estratégia de deploy.
- Provedor de autenticação e isolamento multi-tenant.
- Contrato real da API Z2PAY: onboarding, recebedores, split, saldo, saque, antecipação, estornos e chargebacks.
- Modelo de taxas Zailom permitido contratualmente.
- Responsabilidades por saldo negativo, reservas e disputas.
- Estratégia de conciliação e fechamento financeiro.
