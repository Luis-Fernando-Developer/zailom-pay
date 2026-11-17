# Zailom Pay

Núcleo financeiro do ecossistema Zailom. O objetivo é centralizar regras financeiras, ledger, divisão de valores, recebíveis, saques, conciliação e integrações com provedores de pagamento.

## Direção do produto

- Zailom Pay é a camada de orquestração e gestão financeira dos produtos Zailom.
- Booking é o primeiro produto integrado; a arquitetura deve permitir integrar Flow, Orbit e produtos futuros.
- Z2PAY é o provedor financeiro prioritário em avaliação, mas a aplicação não deve ficar acoplada a um único provedor.
- O ledger interno registra a posição contábil de cada participante; não representa, por si só, custódia ou autorização para movimentar recursos.
- Beneficiários poderão precisar de cadastro, KYC e aprovação no provedor antes de receber repasses.
- Nenhuma transação será considerada liquidada apenas porque foi criada no Zailom Pay: estados financeiros devem ser confirmados por eventos e conciliação do provedor.

## Princípios obrigatórios

1. Ledger imutável e auditável, com lançamentos balanceados.
2. Valores monetários armazenados em unidades mínimas inteiras (centavos), nunca em ponto flutuante.
3. Idempotência em operações e webhooks.
4. Separação entre pagamento, distribuição, recebível, saldo disponível e saque.
5. Toda movimentação deve ter origem, produto, empresa e participante identificáveis.
6. Segredos e credenciais de provedores somente no backend.
7. Adaptadores de provedores isolados do domínio financeiro.
8. Reembolsos, chargebacks e ajustes devem gerar lançamentos compensatórios; nunca editar o histórico.
9. Ambiente de desenvolvimento/testes não deve movimentar dinheiro real.
10. Regras regulatórias, contratuais e de KYC devem ser respeitadas; não presumir que ledger próprio substitui a estrutura regulada do parceiro.

## Banco de dados e infraestrutura

- PostgreSQL 16 em container Docker próprio no VPS, seguindo o padrão utilizado pelo Zailom Orbit.
- Instância, volume, credenciais e ciclo de vida independentes do Orbit: Zailom Pay terá seu próprio banco e usuário de banco.
- Não utilizar Supabase, Supabase Auth, Edge Functions ou recursos específicos do Supabase.
- Backend Fastify em Node.js 22, conectado ao PostgreSQL por rede privada Docker.
- O PostgreSQL não publica porta no host; apenas a API acessa o banco pela rede interna.
- A rede externa zailom_pay_net é usada para comunicação com o Traefik. A rede pay_data_net mantém o banco isolado.
- O Compose cria volume persistente exclusivo zailom_pay_postgres_data.

## Endereços

- Painel: https://pay.zailom.com
- API: https://api-pay.zailom.com

## Deploy inicial

1. Configure no DNS os dois hosts acima apontando para o proxy/servidor já utilizado pela Zailom.
2. No Portainer, crie a stack a partir deste repositório.
3. Defina POSTGRES_PASSWORD como uma senha longa, aleatória e exclusiva da instância Pay.
4. Confirme que a rede Docker externa zailom_pay_net existe e está conectada ao Traefik.
5. Configure ADMIN_EMAIL, ADMIN_PASSWORD (mínimo de 14 caracteres) e ADMIN_NAME nas variáveis da stack. Use uma senha exclusiva e guarde-a em local seguro.
6. Faça o deploy. A API aplica a migração SQL versionada no primeiro start e expõe /health para healthcheck.
7. Não publique a porta 5432 do PostgreSQL.

O arquivo .env.example documenta as variáveis. Em Portainer, cadastre os valores como variáveis da stack; não envie o arquivo real de segredos ao Git.

## Estado atual

- [x] Base de deploy Docker/Portainer.
- [x] PostgreSQL 16 isolado, com volume persistente.
- [x] API Fastify inicial e healthcheck com verificação do banco.
- [x] Aplicação automática da migração financeira inicial.
- [x] Rotas iniciais /, /health e /api/v1/status.
- [x] Autenticação administrativa inicial com sessão HttpOnly e bootstrap do superadmin.
- [ ] Autorização granular e isolamento multi-tenant.
- [x] Painel administrativo em /panel com indicadores reais do PostgreSQL.
- [x] API administrativa protegida por sessão para visão geral.
- [x] API inicial do ledger: contas contábeis, consulta de lançamentos e postagem balanceada.
- [x] Idempotência de lançamentos e bloqueio de alteração/exclusão do histórico contabilizado.
- [x] Plano de contas compartilhado inicial em BRL.
- [ ] Serviços de pagamentos, distribuição, recebíveis e saques.
- [ ] Simulador de provedor e adaptador Z2PAY.
- [ ] Integração com Booking.

O painel já consulta indicadores reais do banco. A API do ledger permite registrar lançamentos contábeis internos balanceados, com idempotência e histórico imutável. Isso não inicia pagamentos, não cria saldo sacável e não movimenta dinheiro. A integração com provedores, liquidação, distribuição e saques permanece desativada até que os fluxos contratuais e técnicos sejam definidos.


## API administrativa inicial

Todas as rotas abaixo exigem sessão autenticada. Escritas no ledger exigem perfil `superadmin` ou `admin`.

- `GET /api/v1/admin/overview` — indicadores operacionais.
- `GET /api/v1/admin/ledger/accounts` — plano de contas.
- `POST /api/v1/admin/ledger/accounts` — cria conta contábil.
- `GET /api/v1/admin/ledger/transactions` — consulta lançamentos contabilizados.
- `POST /api/v1/admin/ledger/transactions` — registra uma transação contábil balanceada.

O endpoint de transações exige `productCode`, `eventType`, `idempotencyKey` e pelo menos dois lançamentos. Cada lançamento informa `accountId`, `direction` (`debit` ou `credit`), `amountMinor` (centavos inteiros) e `currency`. Débitos e créditos devem fechar por moeda. Reutilizar uma chave de idempotência com conteúdo diferente retorna conflito HTTP 409.

O plano de contas inicial cria contas compartilhadas em BRL para valores a liquidar pelo provedor, valores devidos aos participantes, receita de tarifas, despesas de tarifas e reembolsos a pagar. Essas contas são apenas estrutura contábil; não representam dinheiro custodiado ou disponível.
