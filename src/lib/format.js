export const fmt = (v) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (v) => (v * 100).toFixed(1) + "%";

export const fmtInt = (v) => v.toLocaleString("pt-BR");
