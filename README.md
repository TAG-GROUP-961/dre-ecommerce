# DRE E-Commerce — Multi-plataforma

Sistema financeiro para calcular lucro mensal de lojas e-commerce em Shopee, Mercado Livre e TikTok Shop.

## Funcionalidades

- **Upload automático**: Detecta a plataforma automaticamente pelas colunas do arquivo
- **Multi-loja**: Shopee Najco, Alfa, Jebaico | TikTok Najco, Alfa | ML Najco, Alfa
- **Multi-mês**: Processa vários meses de uma vez
- **Custos por SKU**: Digite os custos direto no app, lucro atualiza em tempo real
- **Exportar Excel**: Gera relatório consolidado com BASE, DRE e CUSTOS
- **100% no navegador**: Nenhum dado é enviado a servidores

## Deploy no Vercel

### Opção 1: Via GitHub (recomendado)

1. Crie um repositório no GitHub
2. Suba este projeto:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/SEU_USER/dre-ecommerce.git
   git push -u origin main
   ```
3. Vá em [vercel.com](https://vercel.com) → "Add New Project"
4. Conecte o repositório → Deploy automático

### Opção 2: Via CLI

```bash
npm install -g vercel
vercel
```

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse http://localhost:3000

## Lojas suportadas

| Plataforma | Lojas |
|---|---|
| Shopee | Najco, Alfa, Jebaico |
| TikTok | Najco, Alfa |
| Mercado Livre | Najco, Alfa |

Para adicionar novas lojas, edite o arquivo `src/lib/engine.js` no objeto `STORES`.
