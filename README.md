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
- Backend próprio conectado ao PostgreSQL por rede privada Docker.

## Primeira fase

- Definir arquitetura e contratos internos.
- Criar schema SQL do ledger e entidades financeiras.
- Criar API/backend com autenticação, autorização e idempotência.
- Implementar simulador de provedor para testes.
- Implementar adaptador Z2PAY após validar documentação e credenciais.
- Integrar primeiro ao Zailom Booking.

## Estado atual

Repositório recém-criado. A estrutura de aplicação e as migrações PostgreSQL serão adicionadas em etapas, após validar a base técnica e os contratos internos.
