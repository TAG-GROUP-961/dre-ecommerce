import * as XLSX from 'xlsx';

const p = v => parseFloat(v) || 0;
const s = v => String(v || "");
const abs = v => Math.abs(p(v));

export const DEFAULT_STORES = {
  Shopee: ["Shopee Najco", "Shopee Alfa", "Shopee Jex"],
  TikTok: ["TikTok Najco", "TikTok Alfa"],
  "Mercado Livre": ["ML Najco", "ML Alfa"],
};

// For backward compatibility
export const STORES = DEFAULT_STORES;

export function detectPlatform(columns) {
  const c = columns.map(x => String(x).toLowerCase());
  if (c.some(x => x.includes("taxa de comissão líquida") || x.includes("total global"))) return "Shopee";
  if (c.some(x => x.includes("tarifa de comissão da plataforma") || x.includes("valor total a ser liquidado"))) return "TikTok";
  if (c.some(x => x.includes("tarifa do mercado pago") || x.includes("net_received_amount"))) return "Mercado Livre";
  return null;
}

export function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        let bestJson = [];
        let bestScore = -1;
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          // Fix truncated ranges: scan for actual data extent
          if (ws["!ref"]) {
            const range = XLSX.utils.decode_range(ws["!ref"]);
            if (range.e.r < 100) {
              let maxRow = range.e.r;
              let maxCol = range.e.c;
              for (const key of Object.keys(ws)) {
                if (key[0] === "!") continue;
                const cell = XLSX.utils.decode_cell(key);
                if (cell.r > maxRow) maxRow = cell.r;
                if (cell.c > maxCol) maxCol = cell.c;
              }
              if (maxRow > range.e.r) {
                ws["!ref"] = XLSX.utils.encode_range({ s: range.s, e: { r: maxRow, c: maxCol } });
              }
            }
          }
          const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
          if (json.length === 0) continue;
          // Score: prefer sheets with recognized platform columns
          const cols = Object.keys(json[0]).map(c => String(c).toLowerCase());
          let score = json.length;
          // Boost score heavily if columns match a known platform
          if (cols.some(c => c.includes("id do pedido") || c.includes("status do pedido"))) score += 100000; // Shopee
          if (cols.some(c => c.includes("tipo de transação") || c.includes("tarifa de comissão da plataforma"))) score += 100000; // TikTok
          if (cols.some(c => c.includes("transaction_amount") || c.includes("net_received_amount"))) score += 100000; // ML
          // Penalize sheets with __EMPTY columns (summary/report sheets)
          if (cols.some(c => c.includes("__empty"))) score -= 50000;
          if (score > bestScore) {
            bestScore = score;
            bestJson = json;
          }
        }
        resolve(bestJson);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function readCostExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const costs = {};
        json.forEach(row => {
          const sku = String(row['SKU'] || row['sku'] || row['Sku'] || '').trim();
          const cost = parseFloat(row['Custo'] || row['custo'] || row['Custo Unitario'] || row['Custo Unit'] || row['custo_unitario'] || row['cost'] || row['Cost'] || 0);
          if (sku && cost > 0) costs[sku] = cost;
        });
        resolve(costs);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SHOPEE — fórmula validada April 2026
//
// IF Valor Total == 0  (pedido totalmente devolvido/estornado)
//    Receita = 0
//    Repasse = -Taxa de Envio Reversa
// ELSE
//    Receita = Subtotal do produto
//    Bonus  = R$8 se Opção de envio == "Entrega Direta", senão 0
//    FreteSeller = frete que o vendedor efetivamente paga:
//       - 0 se Entrega Direta (Shopee cobre)
//       - 0 se Desconto de Frete Aproximado ≈ Valor estimado do frete (Shopee cobre 100%)
//       - max(0, freteEst - descFrete - freteComprador) caso contrário
//    Repasse = Receita + Bonus - Cupom_vendedor - Comissão - Serviço - EnvioReversa - FreteSeller
//    Taxas   = Receita - Repasse  (sempre consistente)
//
// Multi-item: taxas estão no primeiro row; distribui por proporção de Subtotal.
// ═══════════════════════════════════════════════════════════════════════════
export function processShopee(rows, store) {
  const conc = rows.filter(r => String(r["Status do pedido"]).trim() === "Concluído");
  const orderMap = {};
  conc.forEach(r => {
    const oid = s(r["ID do pedido"]);
    if (!orderMap[oid]) orderMap[oid] = [];
    orderMap[oid].push(r);
  });

  const results = [];
  Object.entries(orderMap).forEach(([oid, items]) => {
    const first = items[0];
    const valorTotal  = p(first["Valor Total"]);
    const envioRev    = p(first["Taxa de Envio Reversa"]);
    const com         = p(first["Taxa de comissão líquida"]);
    const srv         = p(first["Taxa de serviço líquida"]);
    const cupomVend   = p(first["Cupom do vendedor"]);
    const freteEst    = p(first["Valor estimado do frete"]);
    const descFrete   = p(first["Desconto de Frete Aproximado"]);
    const freteComp   = p(first["Taxa de envio pagas pelo comprador"]);
    const envio       = s(first["Opção de envio"]);
    const statusDevol = s(first["Status da Devolução / Reembolso"]);

    // Sum subtotals across all items for this order
    const orderSubtotal = items.reduce((sum, r) => sum + p(r["Subtotal do produto"]), 0);

    let orderReceita, orderRepasse, orderTaxas;

    if (valorTotal === 0) {
      // Full refund / devolução total
      orderReceita = 0;
      orderRepasse = -envioRev;
      orderTaxas   = envioRev;
    } else {
      const bonusED = envio === "Entrega Direta" ? 8 : 0;
      // Frete que o vendedor paga de fato
      let freteSeller;
      if (envio === "Entrega Direta") {
        freteSeller = 0;
      } else if (descFrete > 0 && Math.abs(descFrete - freteEst) < 0.02) {
        freteSeller = 0; // Shopee subsidiou 100%
      } else {
        freteSeller = Math.max(0, freteEst - descFrete - freteComp);
      }

      orderReceita = orderSubtotal;
      orderRepasse = orderReceita + bonusED - cupomVend - com - srv - envioRev - freteSeller;
      orderTaxas   = orderReceita - orderRepasse;
    }

    // Distribute to each item line
    items.forEach(r => {
      const itemSubtotal = p(r["Subtotal do produto"]);
      const ratio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 1 / items.length;
      // For refunded orders (receita=0), distribute the loss evenly
      const itemReceita = orderReceita * ratio;
      const itemRepasse = orderRepasse * ratio;
      const itemTaxas   = orderTaxas * ratio;
      results.push({
        plataforma: "Shopee", loja: store, id: oid,
        sku: s(r["Número de referência SKU"]),
        produto: s(r["Nome do Produto"]),
        variacao: s(r["Nome da variação"]),
        qtd: parseInt(r["Quantidade"]) || 1,
        receita: itemReceita,
        comissao: com * ratio,
        servico: srv * ratio,
        fretePlat: 0, // no longer tracked separately (mixed in taxas)
        taxas: itemTaxas,
        repasse: itemRepasse,
        envio: envio,
        data: s(r["Data de criação do pedido"]),
        // debug
        _raw_vt: valorTotal,
        _raw_envio_rev: envioRev,
        _raw_cupom: cupomVend,
        _is_refund: valorTotal === 0,
        _status_devol: statusDevol,
      });
    });
  });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIKTOK — fórmula validada April 2026
//
// Inclui tipos:
//   - "Pedido": venda normal (ou com refund embedded)
//   - "Reembolso de logística": ajuste positivo de logística
//   - "Reembolso", "Devolução", "Ajuste" (se aparecerem)
//
// Para Pedido:
//   Receita = Vendas líquidas dos produtos (NÃO usa subtotal como fallback — evita
//             contar pedidos estornados como receita falsa)
//   Repasse = Valor total a ser liquidado
//   Taxas   = Receita - Repasse  (sempre consistente)
//
// Filtro mensal: mantido via monthFilter.
// ═══════════════════════════════════════════════════════════════════════════
export function processTikTok(rows, store, monthFilter) {
  const results = [];
  rows.forEach(r => {
    const tipo = s(r["Tipo de transação"]).trim();
    if (!tipo) return;

    // Apply month filter to everything
    if (monthFilter) {
      const key = parseDateToMonthKey(r["Data de criação do pedido"]);
      if (key && key !== monthFilter) return;
    }

    const oid = s(r["ID do pedido/ajuste"]);
    const sku = s(r["Nome do SKU"]) || "default";
    const produto = s(r["Nome do produto"]);
    const qtd = parseInt(r["Quantidade"]) || 1;
    const dataRaw = r["Data de criação do pedido"];

    if (tipo === "Pedido") {
      // Always use vendas líquidas — if 0, it was a full refund, receita should be 0
      const receita = p(r["Vendas líquidas dos produtos"]);
      const repasse = p(r["Valor total a ser liquidado"]);

      // Fee breakdown (for informational display; total taxas = receita - repasse for consistency)
      const com       = abs(r["Tarifa de comissão da plataforma"]);
      const srv       = abs(r["Taxas de serviço"]);
      const srvSfp    = abs(r["Taxa de serviço do SFP"]);
      const txItem    = abs(r["Taxa por item vendido"]);
      const af        = abs(r["Comissões de afiliados"]);
      const impostos  = abs(r["Impostos"]) + abs(r["ICMS DIFAL"]) + abs(r["Multa de ICMS"]);
      const fl        = abs(r["Custo líquido de frete"]);
      const planoImp  = abs(r["Plano de serviço gerenciado (Imposto sobre vendas)"]);
      const planoPed  = abs(r["Plano de serviço gerenciado (Taxa por pedido)"]);

      const taxas = receita - repasse; // canonical total

      results.push({
        plataforma: "TikTok", loja: store, id: oid,
        sku, produto, variacao: sku, qtd,
        receita, comissao: com, servico: srv + srvSfp + txItem + af, fretePlat: fl,
        taxas, repasse,
        data: parseDateToLabel(dataRaw),
        _is_refund: receita === 0 && p(r["Subtotal do item antes dos descontos"]) > 0,
        _extra_taxas: impostos + planoImp + planoPed,
      });
    } else if (tipo === "Reembolso de logística" || tipo === "Reembolso" || tipo === "Devolução" || tipo === "Ajuste") {
      // Adjustments that affect repasse but not receita
      const ajuste = p(r["Valor do ajuste"]) || p(r["Valor total a ser liquidado"]);
      if (ajuste === 0) return;
      results.push({
        plataforma: "TikTok", loja: store, id: oid,
        sku: sku || "AJUSTE", produto: produto || `${tipo}`,
        variacao: tipo, qtd: 0,
        receita: 0, comissao: 0, servico: 0, fretePlat: 0,
        taxas: -ajuste,  // negative taxas = positive repasse adjustment
        repasse: ajuste,
        data: parseDateToLabel(dataRaw),
        _is_adjustment: true,
        _tipo: tipo,
      });
    }
  });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// MERCADO LIVRE — fórmula validada April 2026
//
// Inclui status:
//   - "approved": venda normal
//   - "refunded": venda estornada (entra como DOIS efeitos: -receita, -repasse_líquido)
//
// Exclui: rejected, pending, in_mediation, cancelled (não movimentaram dinheiro real
// — ou estão em limbo que não afeta fechamento atual).
//
// Para approved:
//   Receita = transaction_amount
//   Repasse = net_received_amount - amount_refunded (reembolsos parciais)
//
// Para refunded:
//   Receita = -transaction_amount (reverte a venda)
//   Repasse = net_received_amount - amount_refunded (normalmente negativo)
//
// Taxas = Receita - Repasse (consistente).
// ═══════════════════════════════════════════════════════════════════════════
export function processML(rows, store) {
  const results = [];
  rows.forEach(r => {
    const status = s(r["Status da operação (status)"]).trim();
    if (status !== "approved" && status !== "refunded") return;

    const vp  = p(r["Valor do produto (transaction_amount)"]);
    const fr  = Math.abs(p(r["Frete (shipping_cost)"]));
    const nr  = p(r["Valor total recebido (net_received_amount)"]);
    const ref = p(r["Valor devolvido (amount_refunded)"]);

    let receita, repasse;
    if (status === "refunded") {
      receita = -vp;
      repasse = nr - ref; // geralmente negativo (perda real ao vendedor)
    } else {
      receita = vp;
      repasse = nr - ref; // se houver reembolso parcial, desconta
    }
    const taxas = receita - repasse;

    results.push({
      plataforma: "Mercado Livre", loja: store,
      id: s(r["Número da venda no Mercado Livre (order_id)"]),
      sku: s(r["SKU do produto (seller_custom_field)"]),
      produto: s(r["Descrição da operação (reason)"]),
      variacao: "", qtd: status === "refunded" ? -1 : 1,
      receita, comissao: taxas - fr, servico: 0,
      fretePlat: fr, taxas, repasse,
      data: s(r["Data da compra (date_created)"]),
      _status: status,
      _refunded: ref,
      _is_refund: status === "refunded",
    });
  });
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Date helpers — unchanged (already robust)
// ═══════════════════════════════════════════════════════════════════════════
function parseDateToMonthKey(val) {
  if (!val) return null;
  if (val instanceof Date || (typeof val === 'object' && val.getMonth)) {
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    return `${mm}/${val.getFullYear()}`;
  }
  if (typeof val === 'number' && val > 40000 && val < 60000) {
    const d = new Date((val - 25569) * 86400000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${mm}/${d.getFullYear()}`;
  }
  const d = String(val);
  let m = d.match(/(\d{4})[\/-](\d{1,2})/);
  if (m) return `${m[2].padStart(2, '0')}/${m[1]}`;
  m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[2].padStart(2, '0')}/${m[3]}`;
  const monthNames = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  m = d.match(/([A-Z][a-z]{2})\s.*?(\d{4})/);
  if (m && monthNames[m[1]]) return `${monthNames[m[1]]}/${m[2]}`;
  return null;
}

function parseDateToLabel(val) {
  const key = parseDateToMonthKey(val);
  if (!key) return "Sem data";
  const ms = ["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const [mm, yyyy] = key.split('/');
  return `${ms[parseInt(mm)]}/${yyyy}`;
}

export function extractMonth(d) { return parseDateToLabel(d); }
export function extractMonthKey(d) { return parseDateToMonthKey(d); }

export function getTikTokMonths(rows) {
  const months = new Set();
  rows.filter(r => String(r["Tipo de transação"]).trim() === "Pedido").forEach(r => {
    const key = parseDateToMonthKey(r["Data de criação do pedido"]);
    if (key) months.add(key);
  });
  return [...months].sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION — helpers for Validação tab
// ═══════════════════════════════════════════════════════════════════════════
export function reconciliationSummary(orders) {
  const byPlat = {};
  const byStore = {};
  const byStoreMonth = {};
  orders.forEach(o => {
    const keyMes = `${o.loja}|${o.mes}`;
    for (const [key, map] of [[o.plataforma, byPlat], [o.loja, byStore], [keyMes, byStoreMonth]]) {
      if (!map[key]) map[key] = { n: 0, receita: 0, taxas: 0, repasse: 0, refunds: 0, adjustments: 0, plataforma: o.plataforma, loja: o.loja, mes: o.mes };
      map[key].n++;
      map[key].receita += o.receita;
      map[key].taxas += o.taxas;
      map[key].repasse += o.repasse;
      if (o._is_refund) map[key].refunds++;
      if (o._is_adjustment) map[key].adjustments++;
    }
  });
  return { byPlat, byStore, byStoreMonth };
}

// Expected fee ranges per platform (taxa%)
const TAXA_RANGES = {
  "Shopee":        { min: 0.18, max: 0.32, nome: "Shopee" },
  "Mercado Livre": { min: 0.20, max: 0.42, nome: "Mercado Livre" },
  "TikTok":        { min: 0.22, max: 0.40, nome: "TikTok" },
};

// Max refund rate before flagging
const MAX_REFUND_RATE = 0.10; // 10%

export function detectAnomalies(orders, costs = {}) {
  const warns = [];
  if (!orders || orders.length === 0) return warns;

  const byStore = {};
  orders.forEach(o => {
    if (!byStore[o.loja]) byStore[o.loja] = { plat: o.plataforma, loja: o.loja, n: 0, receita: 0, taxas: 0, repasse: 0, refunds: 0, negRep: 0, skusMissing: new Set() };
    const st = byStore[o.loja];
    st.n++;
    st.receita += o.receita;
    st.taxas += o.taxas;
    st.repasse += o.repasse;
    if (o._is_refund) st.refunds++;
    if (o.repasse < 0 && !o._is_refund) st.negRep++;
    if (o.sku && !(costs[o.sku] > 0)) st.skusMissing.add(o.sku);
  });

  Object.values(byStore).forEach(st => {
    // Refund rate
    const refRate = st.refunds / st.n;
    if (refRate > MAX_REFUND_RATE) {
      warns.push({
        level: "warn", loja: st.loja,
        msg: `Taxa de refund alta: ${(refRate*100).toFixed(1)}% (${st.refunds}/${st.n}). Limite saudável ≤ ${(MAX_REFUND_RATE*100).toFixed(0)}%.`
      });
    }
    // Taxa%
    if (st.receita > 0) {
      const taxaPct = st.taxas / st.receita;
      const range = TAXA_RANGES[st.plat];
      if (range) {
        if (taxaPct < range.min) {
          warns.push({
            level: "info", loja: st.loja,
            msg: `Taxa% ${(taxaPct*100).toFixed(1)}% abaixo da faixa típica ${st.plat} (${(range.min*100).toFixed(0)}-${(range.max*100).toFixed(0)}%). Possível falta de pedidos com comissão.`
          });
        } else if (taxaPct > range.max) {
          warns.push({
            level: "error", loja: st.loja,
            msg: `Taxa% ${(taxaPct*100).toFixed(1)}% ACIMA da faixa típica ${st.plat} (${(range.min*100).toFixed(0)}-${(range.max*100).toFixed(0)}%). Suspeita de bug na fórmula ou dados errados.`
          });
        }
      }
    }
    // Repasse negativo inesperado (não refund)
    if (st.negRep > 0) {
      warns.push({
        level: "info", loja: st.loja,
        msg: `${st.negRep} pedido(s) com repasse negativo fora de refund — investigar.`
      });
    }
    // SKUs sem custo
    if (st.skusMissing.size > 0) {
      warns.push({
        level: "info", loja: st.loja,
        msg: `${st.skusMissing.size} SKU(s) sem custo cadastrado. Afeta cálculo de lucro bruto.`
      });
    }
  });

  return warns;
}

// Compare calculated repasse vs user-provided expected. Returns per-store diff.
export function compareExpected(byStore, expected = {}) {
  const out = [];
  Object.values(byStore).forEach(st => {
    const exp = parseFloat(expected[st.loja]);
    if (!isFinite(exp) || exp <= 0) {
      out.push({ ...st, expected: null, diff: null, diffPct: null, status: "no-expected" });
      return;
    }
    const diff = st.repasse - exp;
    const diffPct = diff / exp;
    let status = "ok";
    const absPct = Math.abs(diffPct);
    if (absPct > 0.03) status = "error";
    else if (absPct > 0.01) status = "warn";
    out.push({ ...st, expected: exp, diff, diffPct, status });
  });
  return out;
}

export function exportToExcel(orders, costs, despesas) {
  const wb = XLSX.utils.book_new();
  const base = orders.map(o => ({
    Plataforma: o.plataforma, Loja: o.loja, Mes: o.mes, ID: o.id,
    SKU: o.sku, Produto: o.produto, Qtd: o.qtd,
    "Receita Bruta": +o.receita.toFixed(2),
    Comissao: +o.comissao.toFixed(2), Servico: +o.servico.toFixed(2),
    "Total Taxas": +o.taxas.toFixed(2), Repasse: +o.repasse.toFixed(2),
    "Custo Unit": +(costs[o.sku] || 0).toFixed(2),
    "Custo Total": +((costs[o.sku] || 0) * o.qtd).toFixed(2),
    Lucro: +(o.repasse - (costs[o.sku] || 0) * o.qtd).toFixed(2),
    Data: o.data,
    Refund: o._is_refund ? "S" : "",
    Ajuste: o._is_adjustment ? "S" : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(base), "BASE_CONSOLIDADA");
  // DRE
  const months = [...new Set(orders.map(o => o.mes))].sort();
  const totalDesp = Object.values(despesas || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const inds = [
    ["Receita Bruta", o => o.receita],
    ["(-) Taxas", o => o.taxas],
    ["Repasse", o => o.repasse],
    ["(-) CMV", o => (costs[o.sku] || 0) * o.qtd],
    ["Lucro Bruto", o => o.repasse - (costs[o.sku] || 0) * o.qtd],
    ["(-) Despesas Op.", () => 0],
    ["LUCRO LÍQUIDO", o => o.repasse - (costs[o.sku] || 0) * o.qtd],
  ];
  const dreRows = inds.map(([label, fn]) => {
    const row = { Indicador: label };
    let tot = 0;
    months.forEach(m => {
      let v = orders.filter(o => o.mes === m).reduce((s, o) => s + fn(o), 0);
      if (label === "(-) Despesas Op.") v = -totalDesp / months.length;
      if (label === "LUCRO LÍQUIDO") v -= totalDesp / months.length;
      row[m] = +v.toFixed(2); tot += v;
    });
    row.TOTAL = +tot.toFixed(2);
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dreRows), "DRE");
  // CUSTOS
  const cr = Object.entries(costs).filter(([, v]) => v > 0).map(([sku, cost]) => ({ SKU: sku, "Custo Unitario": cost }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cr), "CUSTOS");
  // DESPESAS
  if (despesas && Object.keys(despesas).length > 0) {
    const dr = Object.entries(despesas).filter(([,v]) => parseFloat(v) > 0).map(([nome, valor]) => ({ Despesa: nome, "Valor (R$)": parseFloat(valor) }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dr), "DESPESAS");
  }
  XLSX.writeFile(wb, `DRE_Consolidado.xlsx`);
}
