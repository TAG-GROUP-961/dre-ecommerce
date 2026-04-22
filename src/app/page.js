'use client';
import { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext } from "react";
import _ from "lodash";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  detectPlatform, readExcelFile, readCostExcel, processShopee, processTikTok,
  processML, extractMonth, getTikTokMonths, exportToExcel, DEFAULT_STORES,
  reconciliationSummary, detectAnomalies, compareExpected, lossAnalysis
} from "@/lib/engine";

/* ═══ Theme ═══ */
const ThemeCtx = createContext();
const useTheme = () => useContext(ThemeCtx);

function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dre-theme') !== 'light';
    return true;
  });
  useEffect(() => { localStorage.setItem('dre-theme', dark ? 'dark' : 'light'); }, [dark]);
  const t = dark ? {
    bg: "bg-[#0c0f1a]", card: "bg-[#141827]", cardHover: "hover:bg-[#1a1f35]", border: "border-[#1e2540]",
    text: "text-gray-200", textSub: "text-gray-500", textMuted: "text-gray-600",
    headerBg: "bg-[#0c0f1a]/95", input: "bg-[#1a1f35] border-[#2a305a] text-gray-200",
    tableRow: "hover:bg-[#1a1f35]", tableStripe: "bg-[#111528]",
    accent: "#6C5CE7", accentBg: "bg-[#6C5CE7]", accentText: "text-[#6C5CE7]",
    accentLight: "bg-[#6C5CE7]/10 border-[#6C5CE7]/30 text-[#a78bfa]",
    green: "text-emerald-400", red: "text-rose-400", greenBg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
    redBg: "bg-rose-500/10 border-rose-500/20 text-rose-400", mode: "dark",
  } : {
    bg: "bg-[#f5f6fa]", card: "bg-white", cardHover: "hover:bg-gray-50", border: "border-gray-200",
    text: "text-gray-800", textSub: "text-gray-400", textMuted: "text-gray-300",
    headerBg: "bg-white/95", input: "bg-gray-50 border-gray-200 text-gray-800",
    tableRow: "hover:bg-gray-50", tableStripe: "bg-gray-50/50",
    accent: "#6C5CE7", accentBg: "bg-[#6C5CE7]", accentText: "text-[#6C5CE7]",
    accentLight: "bg-[#6C5CE7]/5 border-[#6C5CE7]/20 text-[#6C5CE7]",
    green: "text-emerald-600", red: "text-rose-600", greenBg: "bg-emerald-50 border-emerald-200 text-emerald-700",
    redBg: "bg-rose-50 border-rose-200 text-rose-700", mode: "light",
  };
  return <ThemeCtx.Provider value={{ ...t, dark, setDark }}>{children}</ThemeCtx.Provider>;
}

/* ═══ Helpers ═══ */
const fmt = v => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = v => v >= 1000 ? `${(v/1000).toFixed(1)}K` : fmt(v);
const fmtPct = v => (v * 100).toFixed(1) + "%";
const fmtInt = v => v.toLocaleString("pt-BR");
const PLAT_COLORS = { Shopee: "#FF6B35", "Mercado Livre": "#FFE600", TikTok: "#69C9D0" };
const PIE_COLORS = ["#6C5CE7", "#FF6B35", "#00CECE", "#FFE600", "#FF6B81", "#A78BFA"];
const DEFAULT_DESP = { "Motoboy / Entrega": 0, "Embalagem": 0, "Ads / Marketing": 0, "Outros": 0 };

/* ═══ Components ═══ */
function Stat({ label, value, sub, variant = "default" }) {
  const t = useTheme();
  const styles = {
    default: `${t.card} ${t.border}`,
    accent: `${t.accentLight} border`,
    green: `${t.greenBg} border`,
    red: `${t.redBg} border`,
  };
  return (<div className={`${styles[variant]} rounded-2xl p-5 transition-all`}>
    <p className={`text-[10px] uppercase tracking-[.15em] font-bold ${t.textSub}`}>{label}</p>
    <p className={`text-[22px] font-extrabold mt-1.5 tabular-nums leading-none ${t.text}`}>{value}</p>
    {sub && <p className={`text-[11px] mt-2 ${t.textMuted}`}>{sub}</p>}
  </div>);
}

function Table({ title, rows, cols }) {
  const t = useTheme();
  return (<div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
    <div className={`px-5 py-3 border-b ${t.border}`}><h3 className={`${t.text} font-bold text-[13px] uppercase tracking-wider`}>{title}</h3></div>
    <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className={`border-b ${t.border}`}>
      {cols.map(c => <th key={c.key} className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold ${c.right ? "text-right" : "text-left"}`}>{c.label}</th>)}
    </tr></thead><tbody>{rows.map((r, i) => (
      <tr key={i} className={`border-b border-transparent ${r._total ? t.tableStripe + " font-bold" : t.tableRow} transition-colors`}>
        {cols.map(c => { const v = r[c.key]; const cl = c.color === "green" && v > 0 ? t.green : c.color === "red" ? t.red : r._total ? t.text : `${t.text} opacity-80`;
          return <td key={c.key} className={`px-4 py-2.5 tabular-nums ${c.right ? "text-right" : ""} ${cl}`}>{c.fmt ? c.fmt(v) : v}</td>; })}
      </tr>))}</tbody></table></div></div>);
}

function ChartTooltip({ active, payload, label, prefix = "R$ " }) {
  const t = useTheme();
  if (!active || !payload?.length) return null;
  return (<div className={`${t.card} border ${t.border} rounded-xl px-3 py-2 shadow-xl`}>
    <p className={`text-xs font-bold ${t.text}`}>{label}</p>
    {payload.map((p, i) => <p key={i} className="text-xs tabular-nums" style={{ color: p.color }}>{prefix}{fmt(p.value)}</p>)}
  </div>);
}

/* ═══ Main ═══ */
export default function Home() {
  return <ThemeProvider><App /></ThemeProvider>;
}

function App() {
  const t = useTheme();
  const [orders, setOrders] = useState([]);
  const [costs, setCosts] = useState(() => { if (typeof window !== 'undefined') { try { return JSON.parse(localStorage.getItem('dre-sku-costs')) || {}; } catch { return {}; } } return {}; });
  const [despesas, setDespesas] = useState(() => { if (typeof window !== 'undefined') { try { return JSON.parse(localStorage.getItem('dre-despesas')) || { ...DEFAULT_DESP }; } catch { return { ...DEFAULT_DESP }; } } return { ...DEFAULT_DESP }; });
  const [stores, setStores] = useState(() => { if (typeof window !== 'undefined') { try { const s = localStorage.getItem('dre-stores'); return s ? JSON.parse(s) : { ...DEFAULT_STORES }; } catch { return { ...DEFAULT_STORES }; } } return { ...DEFAULT_STORES }; });
  const [newDesp, setNewDesp] = useState("");
  const [newStore, setNewStore] = useState({ platform: "Shopee", name: "" });
  const [expected, setExpected] = useState(() => { if (typeof window !== 'undefined') { try { return JSON.parse(localStorage.getItem('dre-expected-repasse')) || {}; } catch { return {}; } } return {}; });
  useEffect(() => { try { localStorage.setItem('dre-sku-costs', JSON.stringify(costs)); } catch {} }, [costs]);
  useEffect(() => { try { localStorage.setItem('dre-despesas', JSON.stringify(despesas)); } catch {} }, [despesas]);
  useEffect(() => { try { localStorage.setItem('dre-stores', JSON.stringify(stores)); } catch {} }, [stores]);
  useEffect(() => { try { localStorage.setItem('dre-expected-repasse', JSON.stringify(expected)); } catch {} }, [expected]);

  const [pending, setPending] = useState([]);
  const [tab, setTab] = useState("upload");
  const [busy, setBusy] = useState(false);
  const [costSearch, setCostSearch] = useState("");
  const [costFilter, setCostFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [platF, setPlatF] = useState("all");
  const [lojaF, setLojaF] = useState("all");
  const [ttMonths, setTtMonths] = useState({});
  const fileRef = useRef(); const costRef = useRef();
  const PP = 500;

  const handleFiles = useCallback(async (fileList) => {
    for (const file of Array.from(fileList).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name))) {
      try {
        const json = await readExcelFile(file);
        if (!json?.length) continue;
        const platform = detectPlatform(Object.keys(json[0]));
        const id = Date.now() + Math.random();
        const months = platform === "TikTok" ? getTikTokMonths(json) : [];
        setPending(prev => [...prev, { name: file.name, platform, rows: json, store: platform ? stores[platform]?.[0] || "" : "", rowCount: json.length, id, months }]);
        if (platform === "TikTok" && months.length) setTtMonths(prev => ({ ...prev, [id]: months[months.length - 1] }));
      } catch (e) { console.error(e); }
    }
  }, []);

  const processAll = useCallback(() => {
    setBusy(true);
    setTimeout(() => {
      const nw = [];
      pending.forEach(f => {
        let pr = [];
        if (f.platform === "Shopee") pr = processShopee(f.rows, f.store);
        else if (f.platform === "TikTok") pr = processTikTok(f.rows, f.store, ttMonths[f.id]);
        else if (f.platform === "Mercado Livre") pr = processML(f.rows, f.store);
        pr.forEach(o => { o.mes = extractMonth(o.data); });
        nw.push(...pr);
      });
      setOrders(prev => [...prev, ...nw]); setPending([]); setBusy(false); setTab("dre");
    }, 300);
  }, [pending, ttMonths]);

  const skuList = useMemo(() => {
    const g = _.groupBy(orders, "sku");
    return Object.entries(g).filter(([k]) => k && k !== "" && k !== "undefined")
      .map(([sku, os]) => ({ sku, produto: os[0].produto, qtd: _.sumBy(os, "qtd"), receita: _.sumBy(os, "receita") }))
      .sort((a, b) => b.receita - a.receita);
  }, [orders]);

  const totalDesp = useMemo(() => Object.values(despesas).reduce((s, v) => s + (parseFloat(v) || 0), 0), [despesas]);
  const stats = useMemo(() => {
    const r = _.sumBy(orders, "receita"), tx = _.sumBy(orders, "taxas"), rp = _.sumBy(orders, "repasse"),
      c = _.sumBy(orders, o => (costs[o.sku] || 0) * o.qtd), lb = rp - c, ll = lb - totalDesp;
    return { receita: r, taxas: tx, repasse: rp, cmv: c, lucroBruto: lb, lucroLiq: ll, margem: r > 0 ? ll / r : 0, n: orders.length };
  }, [orders, costs, totalDesp]);

  const mkBD = useCallback((key) => {
    const g = _.groupBy(orders, key);
    const rows = Object.entries(g).map(([name, os]) => {
      const r = _.sumBy(os, "receita"), tx = _.sumBy(os, "taxas"), rp = _.sumBy(os, "repasse"),
        c = _.sumBy(os, o => (costs[o.sku] || 0) * o.qtd), l = rp - c;
      return { name, n: os.length, receita: r, taxas: tx, repasse: rp, cmv: c, lucro: l, margem: r > 0 ? l / r : 0 };
    }).sort((a, b) => b.receita - a.receita);
    const totR = _.sumBy(rows, "receita"), totL = _.sumBy(rows, "lucro");
    rows.push({ name: "TOTAL", _total: true, n: _.sumBy(rows, "n"), receita: totR, taxas: _.sumBy(rows, "taxas"), repasse: _.sumBy(rows, "repasse"), cmv: _.sumBy(rows, "cmv"), lucro: totL, margem: totR > 0 ? totL / totR : 0 });
    return rows;
  }, [orders, costs]);

  const platRows = useMemo(() => mkBD("plataforma"), [mkBD]);
  const storeRows = useMemo(() => mkBD("loja"), [mkBD]);
  const monthRows = useMemo(() => { const r = mkBD("mes"); r.sort((a, b) => a._total ? 1 : b._total ? -1 : a.name.localeCompare(b.name)); return r; }, [mkBD]);

  const filtSkus = useMemo(() => {
    let l = skuList;
    if (costSearch) l = l.filter(x => x.sku.toLowerCase().includes(costSearch.toLowerCase()) || x.produto.toLowerCase().includes(costSearch.toLowerCase()));
    if (costFilter === "missing") l = l.filter(x => !costs[x.sku]);
    if (costFilter === "filled") l = l.filter(x => costs[x.sku] > 0);
    return l;
  }, [skuList, costSearch, costFilter, costs]);

  const filledN = skuList.filter(x => costs[x.sku] > 0).length;
  const filtOrders = useMemo(() => {
    let o = orders;
    if (platF !== "all") o = o.filter(x => x.plataforma === platF);
    if (lojaF !== "all") o = o.filter(x => x.loja === lojaF);
    return o;
  }, [orders, platF, lojaF]);
  const totalPg = Math.ceil(filtOrders.length / PP);
  const pgOrders = useMemo(() => filtOrders.slice(page * PP, (page + 1) * PP), [filtOrders, page]);

  const tCols = [
    { key: "name", label: "Nome" }, { key: "n", label: "Pedidos", right: true, fmt: fmtInt },
    { key: "receita", label: "Receita", right: true, fmt: v => `R$ ${fmt(v)}` },
    { key: "taxas", label: "Taxas", right: true, fmt: v => `R$ ${fmt(v)}`, color: "red" },
    { key: "repasse", label: "Repasse", right: true, fmt: v => `R$ ${fmt(v)}` },
    { key: "cmv", label: "CMV", right: true, fmt: v => `R$ ${fmt(v)}`, color: "red" },
    { key: "lucro", label: "Lucro", right: true, fmt: v => `R$ ${fmt(v)}`, color: "green" },
    { key: "margem", label: "Margem", right: true, fmt: fmtPct },
  ];

  const pieData = platRows.filter(r => !r._total && r.receita > 0).map(r => ({ name: r.name, value: r.receita }));
  const barData = storeRows.filter(r => !r._total).map(r => ({ name: r.name.replace("Shopee ", "S.").replace("TikTok ", "TT.").replace("ML ", "ML "), receita: r.receita, lucro: r.lucro }));

  const tabs = [
    { id: "upload", label: "Upload", icon: "📁" },
    { id: "dre", label: "DRE", icon: "📊", off: !orders.length },
    { id: "validacao", label: "Validação", icon: "✅", off: !orders.length },
    { id: "custos", label: "Custos", icon: "💰", off: !orders.length },
    { id: "despesas", label: "Despesas", icon: "🧾", off: !orders.length },
    { id: "pedidos", label: "Pedidos", icon: "📋", off: !orders.length },
    { id: "config", label: "Lojas", icon: "⚙️" },
  ];

  // Reconciliação/validação
  const recon = useMemo(() => reconciliationSummary(orders), [orders]);
  const reconStoreRows = useMemo(() => compareExpected(recon.byStore, expected), [recon.byStore, expected]);
  const anomalies = useMemo(() => detectAnomalies(orders, costs), [orders, costs]);
  const losses = useMemo(() => lossAnalysis(orders, costs), [orders, costs]);

  const platBadge = { Shopee: "bg-[#FF6B35]/15 text-[#FF6B35] border-[#FF6B35]/30", TikTok: "bg-[#69C9D0]/15 text-[#69C9D0] border-[#69C9D0]/30", "Mercado Livre": "bg-[#FFE600]/15 text-[#c5b200] border-[#FFE600]/30" };

  return (
    <div className={`min-h-screen ${t.bg} transition-colors duration-300`}>
      {/* HEADER */}
      <header className={`border-b ${t.border} ${t.headerBg} backdrop-blur-xl sticky top-0 z-50`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl ${t.accentBg} flex items-center justify-center font-black text-white text-lg shadow-lg shadow-[#6C5CE7]/30`}>₿</div>
              <div><h1 className={`text-sm font-extrabold ${t.text}`}>DRE E-Commerce</h1><p className={`text-[10px] ${t.textSub} tracking-[.2em] uppercase`}>Multi-plataforma</p></div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => t.setDark(!t.dark)} className={`w-9 h-9 rounded-xl ${t.card} border ${t.border} flex items-center justify-center text-sm transition-all hover:scale-105`}>
                {t.dark ? "☀️" : "🌙"}
              </button>
              {orders.length > 0 && (<>
                <button onClick={() => { setOrders([]); setPending([]); setTab("upload"); }} className={`px-3 py-2 ${t.textSub} hover:text-rose-400 text-xs rounded-xl`}>Limpar</button>
                <button onClick={() => exportToExcel(orders, costs, despesas)} className={`px-4 py-2 ${t.accentBg} hover:opacity-90 text-white text-xs font-bold rounded-xl shadow-lg shadow-[#6C5CE7]/20 transition-all hover:scale-[1.02]`}>⬇ Excel</button>
              </>)}
            </div>
          </div>
          <div className="flex gap-0.5 -mb-px overflow-x-auto">
            {tabs.map(tx => (
              <button key={tx.id} disabled={tx.off} onClick={() => !tx.off && setTab(tx.id)}
                className={`px-3 sm:px-5 py-2.5 text-xs font-bold rounded-t-xl transition-all whitespace-nowrap ${tab === tx.id ? `${t.bg} ${t.accentText} border-t-2 border-[#6C5CE7]` : tx.off ? `${t.textMuted} cursor-not-allowed` : `${t.textSub} hover:${t.text}`}`}>
                <span className="mr-1.5">{tx.icon}</span><span className="hidden sm:inline">{tx.label}</span>
              </button>))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* ═══ UPLOAD ═══ */}
        {tab === "upload" && (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="text-center"><h2 className={`text-2xl font-extrabold ${t.text}`}>Importe seus relatórios</h2><p className={`${t.textSub} text-sm mt-1`}>Plataforma detectada automaticamente</p></div>
            <div className={`border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer ${t.border} ${t.card} hover:border-[#6C5CE7]/50 transition-all group`}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }} onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
              <div className="text-5xl mb-3 group-hover:scale-110 transition-transform">📊</div>
              <p className={`${t.text} font-bold text-lg`}>Arraste arquivos aqui</p>
              <p className={`${t.textSub} text-xs mt-1`}>ou clique para selecionar · .xlsx .xls .csv</p>
            </div>
            {pending.length > 0 && (
              <div className={`${t.card} rounded-2xl p-4 border ${t.border} space-y-2.5`}>
                <p className={`${t.textSub} text-xs font-bold uppercase tracking-wider`}>Arquivos ({pending.length})</p>
                {pending.map((f, i) => (
                  <div key={f.id} className={`flex items-center gap-2 ${t.tableStripe} rounded-xl p-3 flex-wrap`}>
                    <div className="flex-1 min-w-0"><p className={`${t.text} text-sm truncate font-semibold`}>{f.name}</p><p className={`${t.textMuted} text-[11px]`}>{fmtInt(f.rowCount)} linhas</p></div>
                    {f.platform ? <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${platBadge[f.platform] || ""}`}>{f.platform}</span>
                    : <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${t.redBg} border`}>?</span>}
                    <select className={`${t.input} text-xs rounded-lg px-2 py-1.5 border outline-none`}
                      value={f.store} onChange={e => { const u = [...pending]; u[i] = { ...f, store: e.target.value }; setPending(u); }}>
                      <option value="">Loja...</option>{f.platform && stores[f.platform]?.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                    {f.platform === "TikTok" && f.months?.length > 0 && (
                      <select className={`${t.input} text-xs rounded-lg px-2 py-1.5 border border-[#69C9D0]/50 outline-none`}
                        value={ttMonths[f.id] || ""} onChange={e => setTtMonths(prev => ({ ...prev, [f.id]: e.target.value }))}>
                        <option value="">Todos meses</option>{f.months.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>)}
                    <button onClick={() => setPending(pending.filter((_, j) => j !== i))} className={`${t.textMuted} hover:text-rose-400 text-lg px-1`}>×</button>
                  </div>))}
                <button onClick={processAll} disabled={pending.some(f => !f.platform || !f.store) || busy}
                  className={`w-full py-3.5 ${t.accentBg} hover:opacity-90 disabled:bg-gray-600 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all`}>
                  {busy ? "⏳ Processando..." : `Processar ${pending.length} arquivo${pending.length > 1 ? "s" : ""}`}</button>
              </div>)}
            {orders.length > 0 && (<div className={`p-4 ${t.greenBg} border rounded-2xl`}><p className="font-bold text-sm">✓ {fmtInt(orders.length)} pedidos · {[...new Set(orders.map(o => o.loja))].length} lojas · {[...new Set(orders.map(o => o.mes))].length} mês(es)</p></div>)}
          </div>)}

        {/* ═══ DRE ═══ */}
        {tab === "dre" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="Receita Bruta" value={`R$ ${fmtK(stats.receita)}`} sub={`${fmtInt(stats.n)} pedidos`} />
              <Stat label="Repasse" value={`R$ ${fmtK(stats.repasse)}`} sub={`Taxas: R$ ${fmtK(stats.taxas)}`} />
              <Stat label="Lucro Bruto" value={`R$ ${fmtK(stats.lucroBruto)}`} sub={`CMV: R$ ${fmtK(stats.cmv)}`} variant={stats.lucroBruto >= 0 ? "green" : "red"} />
              <Stat label="Despesas Op." value={`R$ ${fmt(totalDesp)}`} sub="Motoboy, embal, ads" variant={totalDesp > 0 ? "red" : "default"} />
              <Stat label="Lucro Líquido" value={`R$ ${fmtK(stats.lucroLiq)}`} sub={`Margem: ${fmtPct(stats.margem)}`} variant={stats.lucroLiq >= 0 ? "accent" : "red"} />
            </div>

            {stats.cmv === 0 && (<div className={`p-3.5 border rounded-2xl flex items-center gap-3 flex-wrap ${t.dark ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
              <span>⚠️</span><p className={`text-sm flex-1 ${t.dark ? "text-amber-300" : "text-amber-700"}`}>Preencha custos na aba Custos</p>
              <button onClick={() => setTab("custos")} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${t.accentBg} text-white`}>Custos →</button>
            </div>)}

            {/* DRE Summary Card */}
            <div className={`${t.card} rounded-2xl border ${t.border} p-6`}>
              <h3 className={`${t.text} font-extrabold text-[13px] uppercase tracking-wider mb-4`}>DRE Resumido</h3>
              {[
                ["Receita Bruta", stats.receita, false, false],
                ["(-) Taxas das Plataformas", stats.taxas, true, false],
                ["(=) Repasse Recebido", stats.repasse, false, false],
                ["(-) CMV (Custo dos Produtos)", stats.cmv, true, false],
                ["(=) Lucro Bruto", stats.lucroBruto, false, true],
                ["(-) Despesas Operacionais", totalDesp, true, false],
                ["(=) LUCRO LÍQUIDO", stats.lucroLiq, false, true],
              ].map(([label, val, neg, hi], i) => (
                <div key={i} className={`flex justify-between py-2.5 px-4 rounded-xl ${hi ? (val >= 0 ? t.greenBg + " border" : t.redBg + " border") : ""} ${i > 0 ? `border-t ${t.border}` : ""}`}>
                  <span className={`text-sm ${hi ? "font-extrabold" : "font-medium"} ${neg ? t.red : t.text}`}>{label}</span>
                  <span className={`text-sm tabular-nums font-bold ${hi ? (val >= 0 ? t.green : t.red) : neg ? t.red : t.text}`}>R$ {fmt(val)}</span>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className={`${t.card} rounded-2xl border ${t.border} p-5`}>
                <h3 className={`${t.textSub} text-[11px] uppercase tracking-[.15em] font-bold mb-4`}>Receita por Plataforma</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" stroke="none">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie><Tooltip content={<ChartTooltip />} /></PieChart>
                </ResponsiveContainer>
                <div className="flex justify-center gap-4 mt-2">
                  {pieData.map((d, i) => (<div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <span className={`text-[11px] ${t.textSub}`}>{d.name}</span>
                  </div>))}
                </div>
              </div>
              <div className={`${t.card} rounded-2xl border ${t.border} p-5`}>
                <h3 className={`${t.textSub} text-[11px] uppercase tracking-[.15em] font-bold mb-4`}>Lucro por Loja</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={barData} margin={{ left: 10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.dark ? "#1e2540" : "#e5e7eb"} />
                    <XAxis dataKey="name" tick={{ fill: t.dark ? "#6b7280" : "#9ca3af", fontSize: 10 }} />
                    <YAxis tick={{ fill: t.dark ? "#6b7280" : "#9ca3af", fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}K`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="receita" fill="#6C5CE7" radius={[6, 6, 0, 0]} name="Receita" />
                    <Bar dataKey="lucro" fill="#10B981" radius={[6, 6, 0, 0]} name="Lucro" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {monthRows.length > 2 && <Table title="Por Mês" rows={monthRows} cols={tCols} />}
            <Table title="Por Plataforma" rows={platRows} cols={tCols} />
            <Table title="Por Loja" rows={storeRows} cols={tCols} />
          </div>)}

        {/* ═══ VALIDAÇÃO ═══ */}
        {tab === "validacao" && (
          <div className="space-y-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h2 className={`text-lg font-extrabold ${t.text}`}>Validação / Conciliação</h2>
                <p className={`${t.textSub} text-xs mt-0.5`}>Compare o repasse calculado com o que a plataforma realmente te pagou. Preencha o valor esperado por loja.</p>
              </div>
              <button onClick={() => { if (confirm("Zerar todos os valores esperados?")) setExpected({}); }}
                className={`px-3 py-1.5 ${t.card} border ${t.border} ${t.textSub} text-xs rounded-lg ${t.cardHover}`}>Zerar esperados</button>
            </div>

            {/* Anomalias */}
            {anomalies.length > 0 && (
              <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
                <div className={`px-5 py-3 border-b ${t.border} flex items-center gap-2`}>
                  <h3 className={`${t.text} font-bold text-[13px] uppercase tracking-wider`}>Anomalias detectadas</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.redBg} border`}>{anomalies.length}</span>
                </div>
                <div className={`divide-y ${t.border}`}>
                  {anomalies.map((a, i) => {
                    const cls = a.level === "error" ? t.redBg : a.level === "warn" ? (t.dark ? "bg-amber-500/10 border-amber-500/20 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-700") : t.accentLight;
                    const icon = a.level === "error" ? "🚨" : a.level === "warn" ? "⚠️" : "ℹ️";
                    return (<div key={i} className={`px-5 py-3 flex items-start gap-3 text-sm ${cls}`}>
                      <span className="text-lg">{icon}</span>
                      <div className="flex-1"><span className="font-bold">{a.loja}:</span> {a.msg}</div>
                    </div>);
                  })}
                </div>
              </div>
            )}

            {/* Tabela conciliação por loja */}
            <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
              <div className={`px-5 py-3 border-b ${t.border}`}><h3 className={`${t.text} font-bold text-[13px] uppercase tracking-wider`}>Conciliação por loja</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className={`border-b ${t.border}`}>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-left`}>Loja</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Pedidos</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Receita</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Taxas</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Taxa %</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Repasse calc</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Repasse esperado</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Diff</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Refunds</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Ajustes</th>
                  </tr></thead>
                  <tbody>
                    {reconStoreRows.map((r, i) => {
                      const taxaPct = r.receita > 0 ? (r.taxas / r.receita) : 0;
                      const statusCls = r.status === "ok" ? t.greenBg : r.status === "warn" ? (t.dark ? "bg-amber-500/10 text-amber-300" : "bg-amber-50 text-amber-700") : r.status === "error" ? t.redBg : "";
                      return (<tr key={i} className={`border-b border-transparent ${t.tableRow} ${i % 2 ? t.tableStripe : ""}`}>
                        <td className={`px-4 py-2.5 ${t.text} font-semibold`}>{r.loja}</td>
                        <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{fmtInt(r.n)}</td>
                        <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums`}>R$ {fmt(r.receita)}</td>
                        <td className={`px-4 py-2.5 ${t.red} text-right tabular-nums`}>R$ {fmt(r.taxas)}</td>
                        <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{(taxaPct*100).toFixed(1)}%</td>
                        <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums font-semibold`}>R$ {fmt(r.repasse)}</td>
                        <td className="px-4 py-2 text-right">
                          <input type="number" step="0.01" min="0" placeholder="0,00"
                            className={`w-32 text-right text-sm rounded-lg px-2 py-1 border outline-none tabular-nums ${t.input}`}
                            value={expected[r.loja] || ""}
                            onChange={e => setExpected(prev => ({ ...prev, [r.loja]: e.target.value }))} />
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${statusCls}`}>
                          {r.diff === null ? <span className={t.textMuted}>—</span> : `${r.diff >= 0 ? "+" : ""}${fmt(r.diff)} (${r.diffPct >= 0 ? "+" : ""}${(r.diffPct*100).toFixed(2)}%)`}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${r.refunds > 0 ? t.red : t.textSub}`}>{r.refunds}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${t.textSub}`}>{r.adjustments}</td>
                      </tr>);
                    })}
                  </tbody>
                </table>
              </div>
              <div className={`px-5 py-3 border-t ${t.border} text-[11px] ${t.textSub} flex flex-wrap gap-4`}>
                <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle"></span> diff &lt; 1% (ok)</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle"></span> 1–3% (atenção)</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1.5 align-middle"></span> &gt; 3% (investigar)</span>
                <span className="ml-auto">Valores esperados salvos automaticamente.</span>
              </div>
            </div>

            {/* SKUs com prejuízo */}
            {Object.keys(costs).length === 0 ? (
              <div className={`p-4 ${t.accentLight} border rounded-2xl`}>
                <p className="text-xs">ℹ️ Cadastre custos na aba <strong>Custos</strong> para habilitar análise de prejuízo por SKU.</p>
              </div>
            ) : (
              <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
                <div className={`px-5 py-3 border-b ${t.border} flex items-center gap-3 flex-wrap`}>
                  <h3 className={`${t.text} font-bold text-[13px] uppercase tracking-wider`}>SKUs com prejuízo</h3>
                  {losses.totalNegCount > 0 ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.redBg}`}>
                      {fmtInt(losses.totalNegCount)} pedidos no negativo · −R$ {fmt(Math.abs(losses.totalNegLoss))}
                    </span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${t.greenBg}`}>Nenhum pedido no prejuízo ✓</span>
                  )}
                  <span className={`${t.textSub} text-[11px] ml-auto`}>Top {Math.min(losses.skuLossRanking.length, 20)} de {losses.skuLossRanking.length} SKU(s) com lucro acumulado &lt; 0</span>
                </div>
                {losses.skuLossRanking.length === 0 ? (
                  <div className={`p-6 text-center ${t.textSub} text-sm`}>
                    Todos os SKUs com custo cadastrado estão dando lucro 🎉
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead><tr className={`border-b ${t.border}`}>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-left`}>SKU</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-left`}>Produto</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Pedidos</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Qtd</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Custo un.</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Receita</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Repasse</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>CMV</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Prejuízo</th>
                        <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Pedidos neg.</th>
                      </tr></thead>
                      <tbody>
                        {losses.skuLossRanking.slice(0, 20).map((s, i) => {
                          const lossPorPedido = s.lucro / s.pedidos;
                          return (<tr key={s.sku} className={`border-b border-transparent ${t.tableRow} ${i % 2 ? t.tableStripe : ""}`}>
                            <td className={`px-4 py-2.5 ${t.accentText} font-mono text-[11px] cursor-pointer hover:underline`}
                                title="Copiar SKU" onClick={() => { navigator.clipboard.writeText(s.sku); }}>{s.sku}</td>
                            <td className={`px-4 py-2.5 ${t.text} truncate max-w-[200px]`} title={s.produto}>{s.produto}</td>
                            <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{fmtInt(s.pedidos)}</td>
                            <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{fmtInt(s.qtd)}</td>
                            <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>R$ {fmt(s.custoUnit)}</td>
                            <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums`}>R$ {fmt(s.receita)}</td>
                            <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums`}>R$ {fmt(s.repasse)}</td>
                            <td className={`px-4 py-2.5 ${t.textMuted} text-right tabular-nums`}>R$ {fmt(s.cmv)}</td>
                            <td className={`px-4 py-2.5 ${t.red} text-right tabular-nums font-bold`}>
                              R$ {fmt(s.lucro)}
                              <div className={`${t.textMuted} font-normal text-[10px]`}>{fmt(lossPorPedido)}/pedido</div>
                            </td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${s.pedidosNeg === s.pedidos ? t.red : t.textSub}`}>
                              {s.pedidosNeg}/{s.pedidos}
                            </td>
                          </tr>);
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {losses.skuLossRanking.length > 0 && (
                  <div className={`px-5 py-3 border-t ${t.border} text-[11px] ${t.textSub}`}>
                    💡 Clique no SKU para copiar. Ação sugerida: subir preço, rever custo cadastrado ou pausar anúncio.
                  </div>
                )}
              </div>
            )}

            {/* Totais por plataforma */}
            <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
              <div className={`px-5 py-3 border-b ${t.border}`}><h3 className={`${t.text} font-bold text-[13px] uppercase tracking-wider`}>Resumo por plataforma</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className={`border-b ${t.border}`}>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-left`}>Plataforma</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Pedidos</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Receita</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Taxas</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Taxa %</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Repasse</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Refunds</th>
                    <th className={`px-4 py-2.5 text-[10px] uppercase tracking-[.12em] ${t.textSub} font-bold text-right`}>Ajustes</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(recon.byPlat).map(([plat, st], i) => (
                      <tr key={plat} className={`border-b border-transparent ${t.tableRow} ${i % 2 ? t.tableStripe : ""}`}>
                        <td className={`px-4 py-2.5 ${t.text} font-semibold`}>{plat}</td>
                        <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{fmtInt(st.n)}</td>
                        <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums`}>R$ {fmt(st.receita)}</td>
                        <td className={`px-4 py-2.5 ${t.red} text-right tabular-nums`}>R$ {fmt(st.taxas)}</td>
                        <td className={`px-4 py-2.5 ${t.textSub} text-right tabular-nums`}>{st.receita > 0 ? (st.taxas/st.receita*100).toFixed(1) : "0.0"}%</td>
                        <td className={`px-4 py-2.5 ${t.text} text-right tabular-nums font-semibold`}>R$ {fmt(st.repasse)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${st.refunds > 0 ? t.red : t.textSub}`}>{st.refunds}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${t.textSub}`}>{st.adjustments}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>)}

        {/* ═══ CUSTOS ═══ */}
        {tab === "custos" && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
              <div><h2 className={`text-lg font-extrabold ${t.text}`}>Custos por SKU</h2><p className={`${t.textSub} text-xs mt-0.5`}>Salvos automaticamente</p></div>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => costRef.current?.click()} className={`px-3 py-1.5 ${t.accentBg} text-white text-xs font-bold rounded-lg shadow-sm`}>⬆ Importar Excel</button>
                <input ref={costRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => { readCostExcel(e.target.files[0]).then(imp => { if (Object.keys(imp).length) { setCosts(prev => ({ ...prev, ...imp })); alert(`${Object.keys(imp).length} custos importados!`); } else alert("Nenhum custo encontrado. Colunas: SKU + Custo"); }); e.target.value = ""; }} />
                <button onClick={() => { const b = new Blob([JSON.stringify(costs, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "custos_backup.json"; a.click(); }}
                  className={`px-3 py-1.5 ${t.card} border ${t.border} ${t.textSub} text-xs font-medium rounded-lg`}>⬇ Backup</button>
                <button onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.onchange = (e) => { const fr = new FileReader(); fr.onload = (ev) => { try { setCosts(prev => ({ ...prev, ...JSON.parse(ev.target.result) })); } catch {} }; fr.readAsText(e.target.files[0]); }; inp.click(); }}
                  className={`px-3 py-1.5 ${t.card} border ${t.border} ${t.textSub} text-xs font-medium rounded-lg`}>⬆ JSON</button>
              </div>
            </div>
            <div className={`mb-3 p-3 ${t.accentLight} border rounded-xl`}><p className="text-xs">Excel com colunas <strong>SKU</strong> e <strong>Custo</strong> (ou Custo Unitario). O que cruzar atualiza, o resto preencha abaixo.</p></div>
            <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
              <div className={`px-5 py-3 border-b ${t.border} space-y-2.5`}>
                <div className="flex items-center justify-between"><span className={`${t.textSub} text-xs font-bold`}>{filledN} de {skuList.length}</span>
                  <select className={`${t.input} text-xs rounded-lg px-2.5 py-1.5 border outline-none`} value={costFilter} onChange={e => setCostFilter(e.target.value)}>
                    <option value="all">Todos</option><option value="missing">Sem custo</option><option value="filled">Com custo</option></select></div>
                <input type="text" placeholder="Buscar SKU ou produto..." value={costSearch} onChange={e => setCostSearch(e.target.value)}
                  className={`w-full ${t.input} text-sm rounded-xl px-4 py-2.5 border outline-none placeholder:${t.textMuted}`} />
                <div className={`h-1.5 rounded-full overflow-hidden ${t.dark ? "bg-[#1e2540]" : "bg-gray-100"}`}>
                  <div className={`h-full ${t.accentBg} rounded-full transition-all duration-500`} style={{ width: `${(filledN / Math.max(skuList.length, 1)) * 100}%` }} /></div>
              </div>
              <div className={`max-h-[600px] overflow-y-auto divide-y ${t.border}`}>
                {filtSkus.map((sk, i) => (
                  <div key={sk.sku} className={`flex items-center gap-3 px-5 py-3 ${i % 2 ? t.tableStripe : ""} ${t.cardHover} transition-colors`}>
                    <div className="flex-1 min-w-0"><p className={`${t.text} text-sm font-semibold truncate`}>{sk.sku}</p><p className={`${t.textMuted} text-[11px] truncate`}>{sk.produto} · {fmtInt(sk.qtd)} un · R$ {fmt(sk.receita)}</p></div>
                    <div className="flex items-center gap-1.5 shrink-0"><span className={`${t.textMuted} text-xs`}>R$</span>
                      <input type="number" step="0.01" min="0" placeholder="0,00"
                        className={`w-28 text-right text-sm rounded-xl px-3 py-2 border outline-none tabular-nums font-semibold transition-colors ${costs[sk.sku] > 0 ? `${t.greenBg} border` : `${t.input} border`}`}
                        value={costs[sk.sku] || ""} onChange={e => setCosts(prev => ({ ...prev, [sk.sku]: parseFloat(e.target.value) || 0 }))} /></div>
                  </div>))}
              </div>
            </div>
          </div>)}

        {/* ═══ DESPESAS ═══ */}
        {tab === "despesas" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-4"><h2 className={`text-lg font-extrabold ${t.text}`}>Despesas Operacionais</h2><p className={`${t.textSub} text-xs mt-0.5`}>Descontadas do lucro bruto → lucro líquido</p></div>
            <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
              <div className={`divide-y ${t.border}`}>
                {Object.entries(despesas).map(([nome, valor], i) => (
                  <div key={nome} className={`flex items-center gap-3 px-5 py-3.5 ${i % 2 ? t.tableStripe : ""}`}>
                    <div className="flex-1"><p className={`${t.text} text-sm font-medium`}>{nome}</p></div>
                    <div className="flex items-center gap-1.5"><span className={`${t.textMuted} text-xs`}>R$</span>
                      <input type="number" step="0.01" min="0" placeholder="0,00"
                        className={`w-32 text-right text-sm rounded-xl px-3 py-2 border outline-none tabular-nums font-semibold ${parseFloat(valor) > 0 ? `${t.redBg} border` : `${t.input} border`}`}
                        value={valor || ""} onChange={e => setDespesas(prev => ({ ...prev, [nome]: e.target.value }))} /></div>
                    {!Object.keys(DEFAULT_DESP).includes(nome) && <button onClick={() => setDespesas(prev => { const n = { ...prev }; delete n[nome]; return n; })} className={`${t.textMuted} hover:text-rose-400 text-lg px-1`}>×</button>}
                  </div>))}
              </div>
              <div className={`px-5 py-3 border-t ${t.border}`}>
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Nova despesa..." value={newDesp} onChange={e => setNewDesp(e.target.value)}
                    className={`flex-1 ${t.input} text-sm rounded-xl px-3 py-2 border outline-none`}
                    onKeyDown={e => { if (e.key === "Enter" && newDesp.trim()) { setDespesas(prev => ({ ...prev, [newDesp.trim()]: 0 })); setNewDesp(""); } }} />
                  <button onClick={() => { if (newDesp.trim()) { setDespesas(prev => ({ ...prev, [newDesp.trim()]: 0 })); setNewDesp(""); } }}
                    className={`px-4 py-2 ${t.accentBg} text-white text-xs font-bold rounded-xl`}>+ Adicionar</button>
                </div>
              </div>
              <div className={`px-5 py-3.5 border-t ${t.border} ${t.redBg} flex justify-between items-center`}>
                <span className="font-extrabold text-sm">TOTAL DESPESAS</span>
                <span className="font-extrabold text-xl tabular-nums">R$ {fmt(totalDesp)}</span>
              </div>
            </div>
          </div>)}

        {/* ═══ PEDIDOS ═══ */}
        {tab === "pedidos" && (
          <div>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h2 className={`text-lg font-extrabold ${t.text}`}>Pedidos</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <select className={`${t.input} text-xs rounded-lg px-3 py-2 border outline-none font-medium`}
                  value={platF} onChange={e => { setPlatF(e.target.value); setLojaF("all"); setPage(0); }}>
                  <option value="all">Todas plataformas</option>{[...new Set(orders.map(o => o.plataforma))].map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select className={`${t.input} text-xs rounded-lg px-3 py-2 border outline-none font-medium`}
                  value={lojaF} onChange={e => { setLojaF(e.target.value); setPage(0); }}>
                  <option value="all">Todas lojas</option>{[...new Set(orders.map(o => o.loja))].filter(l => platF === "all" || orders.some(o => o.loja === l && o.plataforma === platF)).map(l => <option key={l} value={l}>{l}</option>)}</select>
                <span className={`${t.textSub} text-xs font-bold`}>{fmtInt(filtOrders.length)} pedidos</span>
              </div>
            </div>
            <div className={`${t.card} rounded-2xl border ${t.border} overflow-hidden`}>
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="sticky top-0 z-10"><tr className={`${t.tableStripe} border-b ${t.border}`}>
                  {["ID Pedido","Plat","Loja","Mês","SKU","Qtd","Receita","Taxas","Repasse","Custo","Lucro"].map(h =>
                    <th key={h} className={`px-3 py-2.5 text-[10px] ${t.textSub} font-bold text-left uppercase tracking-wider`}>{h}</th>)}</tr></thead>
                <tbody>{pgOrders.map((o, i) => {
                  const c = (costs[o.sku] || 0) * o.qtd, l = o.repasse - c;
                  return (<tr key={i} className={`border-b border-transparent ${t.tableRow} ${i % 2 ? t.tableStripe : ""}`}>
                    <td className={`px-3 py-2 ${t.accentText} font-mono text-[11px] cursor-pointer hover:underline`} title="Clique para copiar" onClick={() => { navigator.clipboard.writeText(o.id); }}>{o.id}</td><td className={`px-3 py-2 ${t.textSub}`}>{o.plataforma}</td><td className={`px-3 py-2 ${t.textSub}`}>{o.loja}</td>
                    <td className={`px-3 py-2 ${t.textMuted}`}>{o.mes}</td><td className={`px-3 py-2 ${t.text} font-medium truncate max-w-[150px]`}>{o.sku}</td>
                    <td className={`px-3 py-2 ${t.textSub} text-right tabular-nums`}>{o.qtd}</td>
                    <td className={`px-3 py-2 ${t.text} text-right tabular-nums`}>{fmt(o.receita)}</td>
                    <td className={`px-3 py-2 ${t.red} text-right tabular-nums`}>{fmt(o.taxas)}</td>
                    <td className={`px-3 py-2 ${t.text} text-right tabular-nums`}>{fmt(o.repasse)}</td>
                    <td className={`px-3 py-2 ${t.textMuted} text-right tabular-nums`}>{fmt(c)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${l > 0 ? t.green : l < 0 ? t.red : t.textMuted}`}>{fmt(l)}</td>
                  </tr>); })}</tbody></table></div>
              {totalPg > 1 && (
                <div className={`px-4 py-3 border-t ${t.border} flex items-center justify-between`}>
                  <span className={`${t.textSub} text-xs`}>Pág {page + 1} de {totalPg}</span>
                  <div className="flex items-center gap-1">
                    {[{ label: "⟨⟨", fn: () => setPage(0), dis: page === 0 },
                      { label: "←", fn: () => setPage(p => p - 1), dis: page === 0 },
                      { label: String(page + 1), fn: null, dis: true, active: true },
                      { label: "→", fn: () => setPage(p => p + 1), dis: page >= totalPg - 1 },
                      { label: "⟩⟩", fn: () => setPage(totalPg - 1), dis: page >= totalPg - 1 },
                    ].map((b, i) => (
                      <button key={i} disabled={b.dis && !b.active} onClick={b.fn}
                        className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all ${b.active ? `${t.accentBg} text-white border-transparent font-bold` : `${t.card} ${t.border} ${t.textSub} ${b.dis ? "opacity-30 cursor-not-allowed" : t.cardHover}`}`}>
                        {b.label}
                      </button>))}
                  </div>
                </div>)}
            </div>
          </div>)}

        {/* ═══ CONFIG / LOJAS ═══ */}
        {tab === "config" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-4"><h2 className={`text-lg font-extrabold ${t.text}`}>Configuração de Lojas</h2><p className={`${t.textSub} text-xs mt-0.5`}>Edite nomes, adicione ou remova lojas — salvo automaticamente</p></div>
            
            {["Shopee", "TikTok", "Mercado Livre"].map(plat => (
              <div key={plat} className={`${t.card} rounded-2xl border ${t.border} overflow-hidden mb-4`}>
                <div className={`px-5 py-3 border-b ${t.border} flex items-center gap-2`}>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${platBadge[plat]}`}>{plat}</span>
                  <span className={`${t.textSub} text-xs`}>{(stores[plat] || []).length} lojas</span>
                </div>
                <div className={`divide-y ${t.border}`}>
                  {(stores[plat] || []).map((loja, i) => (
                    <div key={i} className={`flex items-center gap-3 px-5 py-3 ${i % 2 ? t.tableStripe : ""}`}>
                      <input type="text" value={loja}
                        className={`flex-1 ${t.input} text-sm rounded-xl px-4 py-2 border outline-none font-medium`}
                        onChange={e => {
                          const updated = { ...stores };
                          updated[plat] = [...(updated[plat] || [])];
                          updated[plat][i] = e.target.value;
                          setStores(updated);
                        }} />
                      <button onClick={() => {
                        const updated = { ...stores };
                        updated[plat] = (updated[plat] || []).filter((_, j) => j !== i);
                        setStores(updated);
                      }} className={`${t.textMuted} hover:text-rose-400 text-lg px-2 transition-colors`}>×</button>
                    </div>
                  ))}
                </div>
                <div className={`px-5 py-3 border-t ${t.border}`}>
                  <div className="flex items-center gap-2">
                    <input type="text" placeholder={`Nova loja ${plat}...`}
                      className={`flex-1 ${t.input} text-sm rounded-xl px-3 py-2 border outline-none`}
                      value={newStore.platform === plat ? newStore.name : ""}
                      onChange={e => setNewStore({ platform: plat, name: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === "Enter" && newStore.name.trim() && newStore.platform === plat) {
                          setStores(prev => ({ ...prev, [plat]: [...(prev[plat] || []), newStore.name.trim()] }));
                          setNewStore({ platform: plat, name: "" });
                        }
                      }} />
                    <button onClick={() => {
                      if (newStore.name.trim() && newStore.platform === plat) {
                        setStores(prev => ({ ...prev, [plat]: [...(prev[plat] || []), newStore.name.trim()] }));
                        setNewStore({ platform: plat, name: "" });
                      }
                    }} className={`px-4 py-2 ${t.accentBg} text-white text-xs font-bold rounded-xl`}>+ Adicionar</button>
                  </div>
                </div>
              </div>
            ))}

            <div className={`p-4 ${t.accentLight} border rounded-2xl mt-4`}>
              <p className="text-xs font-medium">Os nomes das lojas aparecem no dropdown ao importar arquivos. Se renomear uma loja, os dados já importados mantêm o nome antigo.</p>
            </div>

            <button onClick={() => { if (confirm("Restaurar lojas padrão? Nomes personalizados serão perdidos.")) setStores({ ...DEFAULT_STORES }); }}
              className={`mt-3 px-4 py-2 ${t.card} border ${t.border} ${t.textSub} text-xs font-medium rounded-xl ${t.cardHover} transition-colors`}>
              Restaurar padrão
            </button>
          </div>)}
      </main>
    </div>
  );
}
