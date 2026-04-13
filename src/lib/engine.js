import * as XLSX from 'xlsx';

const p = v => parseFloat(v) || 0;
const s = v => String(v || "");

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

// ═══ SHOPEE — corrected formula ═══
export function processShopee(rows, store) {
  const conc = rows.filter(r => String(r["Status do pedido"]).trim() === "Concluído");

  // Group by order to fix multi-item duplication
  const orderMap = {};
  conc.forEach(r => {
    const oid = s(r["ID do pedido"]);
    if (!orderMap[oid]) orderMap[oid] = [];
    orderMap[oid].push(r);
  });

  const results = [];
  Object.entries(orderMap).forEach(([oid, items]) => {
    // Order-level values (same across all items)
    const first = items[0];
    const tg = p(first["Total global"]);
    const com = p(first["Taxa de comissão líquida"]);
    const srv = p(first["Taxa de serviço líquida"]);
    const freteEst = p(first["Valor estimado do frete"]);
    const descFrete = p(first["Desconto de Frete Aproximado"]) || p(first["Desconto de Frete Aproximado"] || 0);
    const freteComp = p(first["Taxa de envio pagas pelo comprador"]);
    const envio = s(first["Opção de envio"]);

    // Frete that seller actually pays
    let freteVendedor = 0;
    if (envio === "Entrega Direta") {
      freteVendedor = -8; // Shopee PAYS R$8 to seller
    } else if (Math.abs(descFrete - freteEst) < 0.02) {
      freteVendedor = 0; // Shopee covers 100% of frete
    } else if (descFrete === 0 || descFrete === '') {
      freteVendedor = freteEst; // Seller pays full frete
    } else {
      freteVendedor = freteEst - descFrete - freteComp; // Partial subsidy
      if (freteVendedor < 0) freteVendedor = 0;
    }

    // Real repasse for this order
    const orderRepasse = tg - com - srv - freteVendedor;
    const orderTaxas = com + srv + Math.max(freteVendedor, 0);

    // Order subtotal (sum of all items)
    const orderSubtotal = items.reduce((s, r) => s + p(r["Subtotal do produto"]), 0);

    // Distribute to each SKU proportionally
    items.forEach(r => {
      const itemSubtotal = p(r["Subtotal do produto"]);
      const ratio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 1 / items.length;

      results.push({
        plataforma: "Shopee", loja: store, id: oid,
        sku: s(r["Número de referência SKU"]),
        produto: s(r["Nome do Produto"]),
        variacao: s(r["Nome da variação"]),
        qtd: parseInt(r["Quantidade"]) || 1,
        receita: itemSubtotal,
        comissao: com * ratio,
        servico: srv * ratio,
        fretePlat: freteVendedor * ratio,
        taxas: orderTaxas * ratio,
        repasse: orderRepasse * ratio,
        envio: envio,
        data: s(r["Data de criação do pedido"]),
      });
    });
  });

  return results;
}

// ═══ TIKTOK — with date filter ═══
export function processTikTok(rows, store, monthFilter) {
  // DEBUG
  console.log(`[TikTok Debug] Total rows: ${rows.length}, monthFilter: "${monthFilter}"`);
  if (rows.length > 0) {
    const sample = rows[0];
    const dateVal = sample["Data de criação do pedido"];
    const tipoVal = sample["Tipo de transação"];
    console.log(`[TikTok Debug] First row: tipo="${tipoVal}" (type: ${typeof tipoVal}), date="${dateVal}" (type: ${typeof dateVal})`);
    console.log(`[TikTok Debug] parseDateToMonthKey("${dateVal}") = "${parseDateToMonthKey(dateVal)}"`);
    // Show first 5 unique tipos
    const tipos = [...new Set(rows.map(r => String(r["Tipo de transação"]).trim()))];
    console.log(`[TikTok Debug] Unique tipos: ${JSON.stringify(tipos)}`);
    // Count pedidos
    const pedidos = rows.filter(r => String(r["Tipo de transação"]).trim() === "Pedido");
    console.log(`[TikTok Debug] Pedido rows: ${pedidos.length}`);
    if (pedidos.length > 0) {
      const dates = pedidos.slice(0, 5).map(r => {
        const d = r["Data de criação do pedido"];
        return { raw: d, type: typeof d, key: parseDateToMonthKey(d) };
      });
      console.log(`[TikTok Debug] Sample dates:`, JSON.stringify(dates));
    }
  }

  return rows
    .filter(r => {
      if (String(r["Tipo de transação"]).trim() !== "Pedido") return false;
      if (monthFilter) {
        const key = parseDateToMonthKey(r["Data de criação do pedido"]);
        if (key && key !== monthFilter) return false;
      }
      return true;
    })
    .map(r => {
      const vl = p(r["Vendas líquidas dos produtos"]);
      const sub = p(r["Subtotal do item antes dos descontos"]);
      const com = Math.abs(p(r["Tarifa de comissão da plataforma"]));
      const srv = Math.abs(p(r["Taxas de serviço"]));
      const af = Math.abs(p(r["Comissões de afiliados"]));
      const fl = Math.abs(p(r["Custo líquido de frete"]));
      const val = p(r["Valor total a ser liquidado"]);
      const rec = vl > 0 ? vl : sub;
      return {
        plataforma: "TikTok", loja: store, id: s(r["ID do pedido/ajuste"]),
        sku: s(r["Nome do SKU"]) || "default",
        produto: s(r["Nome do produto"]),
        variacao: s(r["Nome do SKU"]), qtd: parseInt(r["Quantidade"]) || 1,
        receita: rec, comissao: com, servico: srv + af, fretePlat: fl,
        taxas: com + srv + af + fl, repasse: val,
        data: parseDateToLabel(r["Data de criação do pedido"]),
      };
    });
}// ═══ ML — unchanged ═══
export function processML(rows, store) {
  return rows
    .filter(r => String(r["Status da operação (status)"]).trim() === "approved")
    .map(r => {
      const vp = p(r["Valor do produto (transaction_amount)"]);
      const fr = Math.abs(p(r["Frete (shipping_cost)"]));
      const nr = p(r["Valor total recebido (net_received_amount)"]);
      const tt = vp - nr;
      return {
        plataforma: "Mercado Livre", loja: store,
        id: s(r["Número da venda no Mercado Livre (order_id)"]),
        sku: s(r["SKU do produto (seller_custom_field)"]),
        produto: s(r["Descrição da operação (reason)"]),
        variacao: "", qtd: 1, receita: vp, comissao: tt - fr, servico: 0,
        fretePlat: fr, taxas: tt, repasse: nr,
        data: s(r["Data da compra (date_created)"]),
      };
    });
}

// Robust date parser: handles JS Date objects, "2026/03/30", "30/03/2026", "2026-03-30", Excel serial numbers
function parseDateToMonthKey(val) {
  if (!val) return null;
  // JS Date object (SheetJS often returns these)
  if (val instanceof Date || (typeof val === 'object' && val.getMonth)) {
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    return `${mm}/${val.getFullYear()}`;
  }
  // Excel serial number (days since 1899-12-30)
  if (typeof val === 'number' && val > 40000 && val < 60000) {
    const d = new Date((val - 25569) * 86400000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${mm}/${d.getFullYear()}`;
  }
  const d = String(val);
  // "2026/03/30" or "2026-03-30"
  let m = d.match(/(\d{4})[\/-](\d{1,2})/);
  if (m) return `${m[2].padStart(2, '0')}/${m[1]}`;
  // "30/03/2026"
  m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[2].padStart(2, '0')}/${m[3]}`;
  // "Mon Mar 30 2026..." (JS Date.toString())
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

export function extractMonth(d) {
  return parseDateToLabel(d);
}

export function extractMonthKey(d) {
  return parseDateToMonthKey(d);
}

// Get unique months from TikTok data for filter dropdown
export function getTikTokMonths(rows) {
  const months = new Set();
  rows.filter(r => String(r["Tipo de transação"]).trim() === "Pedido").forEach(r => {
    const key = parseDateToMonthKey(r["Data de criação do pedido"]);
    if (key) months.add(key);
  });
  return [...months].sort();
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
