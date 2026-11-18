-- Planos base. Garantem que qualquer base de dados (incluindo a de produção, onde o seed
-- não corre) tem planos para as subscrições. Não altera planos já existentes: preços e
-- limites mudam-se na administração (/admin/planos).
INSERT INTO "plans" ("id", "code", "name", "description", "monthlyPrice", "annualPrice", "maxUnits", "maxTenants", "maxMembers", "features", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'FREE', 'Grátis', 'Para quem está a começar: até 3 unidades.', 0, 0, 3, 3, 1, '{"portal": true, "sms": false, "reports": false}', 0, now()),
  (gen_random_uuid(), 'ESSENCIAL', 'Essencial', 'Até 20 unidades, lembretes por SMS e portal do inquilino.', 99000, 990000, 20, 20, 2, '{"portal": true, "sms": true, "reports": true}', 1, now()),
  (gen_random_uuid(), 'PROFISSIONAL', 'Profissional', 'Imobiliárias: unidades ilimitadas e equipa com papéis.', 349000, 3490000, NULL, NULL, 10, '{"portal": true, "sms": true, "reports": true, "multiUser": true}', 2, now())
ON CONFLICT ("code") DO NOTHING;
