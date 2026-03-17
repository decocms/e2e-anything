# QA Report: Casa e Video (Produção)

**Site:** https://www.casaevideo.com.br
**Date:** 2026-03-17
**Framework:** Playwright E2E (Chromium)
**Result:** 36 passed / 25 failed / 61 total

---

## Summary

O site de produção da Casa e Video apresenta **problemas significativos de performance e rate-limiting** que impactam a execução dos testes E2E. Dos 25 testes que falharam, **20 falharam por timeout de navegação** (o site não respondeu em 30s), indicando que o servidor está throttling conexões do Playwright ou está lento sob carga. Os 5 restantes são falhas reais de seletores (newsletter/footer).

Os fluxos que conseguiram completar (homepage, navigation, auth, cart parcial, filters, geolocation, chat) funcionam corretamente.

---

## Results by Area

| Area | Tests | Passed | Result | Notes |
|------|-------|--------|--------|-------|
| Homepage | 5/7 | 5 | PARTIAL | Load, console, header, menu, search OK. Footer não encontrado. Links sample check falhou (timeout em alguns) |
| Navigation | 5/5 | 5 | PASS | Menu links válidos, categorias carregam, breadcrumbs, mobile menu |
| Search | 0/5 | 0 | FAIL | Todos falharam por timeout de navegação |
| Product Page | 0/8 | 0 | FAIL | Todos falharam por timeout na PDP (`/smart-tv-led-32-philco-ptv32cra/p`) |
| Cart / Minicart | 4/5 | 4 | PARTIAL | Drawer abre, mostra produto + preço, checkout link OK. "Add to cart" falhou |
| Auth | 4/4 | 4 | PASS | Login button, dropdown, campos email/password, link my account |
| Checkout | 2/2 | 2 | PASS | Checkout acessível do carrinho, sem erros de servidor |
| Filters | 8/8 | 8 | PASS | Sidebar, filtros, sort, listagem de produtos, paginação, grid toggle |
| Newsletter | 0/4 | 0 | FAIL | Seletores de newsletter não encontrados na página |
| Chat | 3/3 | 3 | PASS | Widget presente, WhatsApp link válido, clicável |
| Geolocation | 4/4 | 4 | PASS | Botão CEP, input, digitação, submit |
| Third-party Scripts | 0/5 | 0 | FAIL | Todos falharam por timeout de navegação |

---

## Análise das Falhas

### Categoria 1: Timeout de navegação (20 testes)
- **Afetados:** Search (5), Product Page (8), Third-party Scripts (5), Homepage links (1), Cart add-to-cart (1)
- **Causa raiz:** O site `casaevideo.com.br` não responde dentro de 30s em muitas requisições do Playwright. Isso sugere:
  - Rate-limiting/WAF (Cloudflare) bloqueando user-agent do Playwright
  - O site de produção é significativamente mais lento que o staging (tanstack)
  - Possível bot protection ativo
- **Evidência:** Headers mostram `server: cloudflare` e `cf-cache-status: DYNAMIC`
- **Severidade:** Alta — impede testes automatizados em CI

### Categoria 2: Footer não encontrado (1 teste)
- **Teste:** `Homepage > should display footer`
- **Causa:** O seletor `footer` não encontra um elemento visível. O footer pode estar em lazy-load ou usar tag diferente
- **Severidade:** Baixa

### Categoria 3: Newsletter não encontrada (4 testes)
- **Testes:** Todos os 4 testes de newsletter
- **Causa:** Os seletores `input[placeholder*='e-mail']`, `input[type='email']` não encontram elementos. A seção de newsletter pode:
  - Não existir no site de produção
  - Estar em lazy-load e não carregar no tempo do teste
  - Usar seletores diferentes
- **Severidade:** Média — se a newsletter existir no site, os seletores precisam ser atualizados

### Categoria 4: Add to cart falhou (1 teste)
- **Teste:** `Cart > should add product to cart`
- **Causa:** Falha ao tentar adicionar produto ao carrinho via automação
- **Severidade:** Média — os outros testes de cart passaram, indicando que o carrinho funciona

---

## CSP Warning

Console errors repetidos em todas as páginas:
```
The Content-Security-Policy directive 'frame-ancestors' contains 'frame-ancestors' as a source expression.
```
Isso indica um erro de configuração no header CSP — a diretiva está duplicada dentro do valor.

---

## Comparação com Staging (Tanstack)

| Métrica | Tanstack (staging) | Produção |
|---------|-------------------|----------|
| Testes passando | 59/61 (97%) | 36/61 (59%) |
| Timeouts | 0 | 20 |
| Performance | Rápido | Lento/throttled |
| Newsletter | Funciona | Não encontrada |
| Footer | Funciona | Não encontrado |

A diferença de performance sugere que o site de produção tem camadas adicionais (CDN/WAF) que interferem com automação.

---

## Recomendações

### Bloqueantes para E2E automatizado
- [ ] **Whitelist do Playwright no WAF/Cloudflare** — Sem isso, testes de CI são inviáveis. Considerar IP allowlist ou bypass token para o user-agent do Playwright
- [ ] **Aumentar timeout** para 60s na config do Playwright para o site de produção

### Melhorias no site
- [ ] **Corrigir CSP header** — Remover `frame-ancestors` duplicado no valor da diretiva
- [ ] **Verificar newsletter** — Confirmar se a seção existe em produção e atualizar seletores
- [ ] **Verificar footer** — Confirmar tag/seletor do footer em produção

### Próximos passos
- [ ] Rodar novamente com `timeout: 120_000` e `retries: 2` para confirmar quais falhas são reais vs. throttling
- [ ] Testar com `--headed` localmente para ver se o comportamento muda (browser real vs headless)
- [ ] Atualizar `sites/casaevideo.yml` com seletores corretos de newsletter/footer após inspeção manual
