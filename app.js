const COLORS = { teal: "#1D6E64", indigo: "#35407A", rust: "#A8492F", mustard: "#C08A1E", sienna: "#8A5A3C", forest: "#3F6B4F", ink: "#211F1D" };
const ENVELOPE_COLORS = [COLORS.teal, COLORS.indigo, COLORS.rust, COLORS.mustard, COLORS.sienna, COLORS.forest];
const VAULT_KEY = "smartg_vault_v2";
let vaultKey = null;
let vaultSalt = null;
let appReady = false;
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function fromB64(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
async function deriveVaultKey(pin, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:210000, hash:"SHA-256"}, material, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function encryptVault(key, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(payload)));
  return {version:2, salt:b64(vaultSalt), iv:b64(iv), data:b64(encrypted)};
}
async function decryptVault(key, record) {
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv:fromB64(record.iv)}, key, fromB64(record.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}
function showSecurity(id) {
  ["setupScreen","lockScreen"].forEach(x => document.getElementById(x)?.classList.toggle("show", x === id));
}
function revealApp() {
  appReady = true;
  document.getElementById("appShell").classList.add("ready");
  ["setupScreen","lockScreen"].forEach(x => document.getElementById(x)?.classList.remove("show"));
  renderPinStatus(); applyModeUI(); renderAll();
}
async function persistVault() {
  if (!vaultKey) return;
  const payload = { transactions, envelopes, patrimoine, accounts, goals, receivables, debts, investments, settings };
  localStorage.setItem(VAULT_KEY, JSON.stringify(await encryptVault(vaultKey, payload)));
}


const ACCOUNT_TYPES = [
  { key: "banque", label: "Banque" },
  { key: "mobile_money", label: "Mobile Money" },
  { key: "especes", label: "Espèces" },
  { key: "carte", label: "Carte bancaire" },
  { key: "pro", label: "Compte professionnel" },
  { key: "autre", label: "Autre" },
];
const SCHEMA_VERSION = 3;

const DEFAULT_ENVELOPES = [
  { key: "dime", label: "Dîme", percent: 10, monthlyAmount: 0, color: COLORS.teal, target: null, note: "Reversée à chaque entrée" },
  { key: "loyer", label: "Loyer", percent: 20, monthlyAmount: 0, color: COLORS.indigo, target: null, note: "Loyer ou hébergement" },
  { key: "bouffe", label: "Bouffe", percent: 12, monthlyAmount: 0, color: COLORS.rust, target: null, note: "Alimentation courante" },
  { key: "deplacement", label: "Déplacement", percent: 10, monthlyAmount: 0, color: COLORS.forest, target: null, note: "Transport, essence, tickets" },
  { key: "elec_eau", label: "Élec/eau", percent: 5, monthlyAmount: 0, color: COLORS.mustard, target: null, note: "Charges du logement" },
  { key: "internet", label: "Internet", percent: 8, monthlyAmount: 0, color: COLORS.sienna, target: null, note: "Abonnement mensuel" },
  { key: "loisirs", label: "Loisirs", percent: 5, monthlyAmount: 0, color: COLORS.mustard, target: null, note: "Sorties, plaisirs" },
  { key: "epargne", label: "Épargne", percent: 15, monthlyAmount: 0, color: COLORS.forest, target: null, note: "Mise de côté, projets à long terme", savings: true },
  { key: "disponible", label: "Disponible", percent: 10, monthlyAmount: 0, color: COLORS.indigo, target: null, note: "Non affecté" },
  { key: "imprevu", label: "Imprévu", percent: 5, monthlyAmount: 0, color: COLORS.rust, target: null, note: "Pannes, urgences ponctuelles" },
];

// ---------- Migration depuis l'ancienne app "Carnet de Compte" ----------
(function migrateOldKeys() {
  const map = {
    cc_transactions: "eq_transactions",
    cc_envelopes: "eq_envelopes",
    cc_patrimoine: "eq_patrimoine",
    cc_theme: "eq_theme",
    cc_accounts: "eq_accounts",
    cc_goals: "eq_goals",
    cc_receivables: "eq_receivables",
    cc_debts: "eq_debts",
    cc_investments: "eq_investments",
  };
  Object.entries(map).forEach(([oldKey, newKey]) => {
    if (localStorage.getItem(newKey) === null && localStorage.getItem(oldKey) !== null) {
      localStorage.setItem(newKey, localStorage.getItem(oldKey));
    }
  });
})();

let transactions = [];
let envelopes = DEFAULT_ENVELOPES.map((e) => ({ ...e }));
let patrimoine = [];
let goals = [];
let receivables = [];
let debts = [];
let investments = [];
let accounts = [];
let settings = { incomeMode: "irregular", pinHash: null, schemaVersion: SCHEMA_VERSION };

// ---------- Migration V1 → V2 : ajout des comptes ----------
// Règle absolue : ne jamais supprimer ou écraser de données existantes.
// Toute transaction pré-V2 est rattachée à un compte par défaut créé automatiquement.
function migrateToV2() {
  let changed = false;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    accounts = [{ id: uid(), name: "Compte principal", type: "autre" }];
    changed = true;
  }
  const fallbackAccountId = accounts[0].id;

  transactions.forEach((t) => {
    if (!t.accountId) {
      t.accountId = fallbackAccountId;
      changed = true;
    }
  });

  if (!settings.schemaVersion || settings.schemaVersion < 2) {
    settings.schemaVersion = 2;
    changed = true;
  }

  if (changed) {
    save();
    saveSettings();
  }
  return changed;
}

// ---------- Migration V2 → V3 : restructuration du patrimoine ----------
// Règle absolue : ne jamais supprimer. Les anciens éléments "passif" deviennent des
// vraies dettes (objet dédié) ; les "actif" restent dans patrimoine, taggés "biens" par
// défaut — à toi de les reclasser (créance, investissement, stock...) car seul toi sais
// ce qu'ils représentent vraiment. Un item déjà compté comme Compte (Phase 1, ex: MoMo)
// doit être supprimé d'ici pour éviter un double comptage.
let migrationV3Notice = null;
function migrateToV3() {
  if (settings.schemaVersion >= 3) return;

  const migratedDebts = [];
  const migratedBiens = [];
  patrimoine.forEach((p) => {
    if (p.type === "passif") {
      debts.push({ id: p.id, name: p.label, amount: p.amount, status: "en_attente", dueDate: null });
      migratedDebts.push(p.label);
    } else {
      if (!p.category) p.category = "biens";
      migratedBiens.push(p.label);
    }
  });
  patrimoine = patrimoine.filter((p) => p.type !== "passif");

  if (migratedDebts.length || migratedBiens.length) {
    migrationV3Notice = { debts: migratedDebts, biens: migratedBiens };
  }

  settings.schemaVersion = 3;
  save();
  saveSettings();
}

function migrateEnvelopes() {
  let changed = false;
  DEFAULT_ENVELOPES.forEach((def) => {
    if (!envelopes.some((e) => e.key === def.key)) {
      envelopes.push({ ...def, percent: 0, monthlyAmount: 0 });
      changed = true;
    }
  });
  envelopes.forEach((e) => {
    if (e.monthlyAmount === undefined) e.monthlyAmount = 0;
  });
  if (changed) save();
}
migrateEnvelopes();
migrateToV2();
migrateToV3();

function save() { persistVault().catch(() => alert("Impossible d’enregistrer le coffre local.")); }
function saveSettings() { save(); }

function fmt(n) {
  return Math.round(n).toLocaleString("fr-FR") + " fr";
}
function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
}
function slugify(label) {
  const base = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "enveloppe";
  let key = base, i = 1;
  while (envelopes.some((e) => e.key === key)) key = base + "_" + ++i;
  return key;
}
function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ---------- Balances ----------
function computeBalances() {
  const b = {};
  envelopes.forEach((e) => (b[e.key] = 0));

  if (settings.incomeMode === "irregular") {
    transactions.forEach((t) => {
      if (t.type === "entree") {
        envelopes.forEach((e) => (b[e.key] += (t.amount * e.percent) / 100));
      } else if (t.type === "depense") {
        b[t.category] = (b[t.category] || 0) - t.amount;
      }
    });
  } else {
    const ym = currentYearMonth();
    envelopes.forEach((e) => (b[e.key] = Number(e.monthlyAmount || 0)));
    transactions.forEach((t) => {
      if (t.type === "depense" && t.date && t.date.startsWith(ym)) {
        b[t.category] = (b[t.category] !== undefined ? b[t.category] : 0) - t.amount;
      }
    });
  }
  return b;
}

// ---------- Comptes ----------
function computeAccountBalances() {
  const b = {};
  accounts.forEach((a) => (b[a.id] = 0));
  transactions.forEach((t) => {
    if (t.type === "entree" && t.accountId in b) {
      b[t.accountId] += t.amount;
    } else if (t.type === "depense" && t.accountId in b) {
      b[t.accountId] -= t.amount;
    } else if (t.type === "transfer") {
      // Un transfert déplace de l'argent entre deux comptes ; il n'entre ni ne sort
      // du "système" — donc jamais compté dans les revenus/dépenses (voir computeMonthTotals).
      if (t.fromAccountId in b) b[t.fromAccountId] -= t.amount;
      if (t.toAccountId in b) b[t.toAccountId] += t.amount;
    }
  });
  return b;
}

function computeMonthTotals() {
  const ym = currentYearMonth();
  let income = 0, expense = 0;
  transactions.forEach((t) => {
    if (!t.date || !t.date.startsWith(ym)) return;
    if (t.type === "entree") income += t.amount;
    else if (t.type === "depense") expense += t.amount;
  });
  return { income, expense, net: income - expense };
}

// ---------- Patrimoine restructuré (Phase 5) ----------
// Chaque brique a une seule source de vérité : liquidités = comptes (Phase 1),
// créances/dettes = leurs objets dédiés (Phase 6), investissements = Phase 7,
// biens/stocks = ce qui reste dans patrimoine[]. Rien n'est compté deux fois par construction.
function computePatrimoine() {
  const liquidites = Object.values(computeAccountBalances()).reduce((s, v) => s + v, 0);
  const creances = receivables.filter((r) => r.status !== "payee").reduce((s, r) => s + r.amount, 0);
  const investissementsTotal = investments.reduce((s, i) => s + i.valeurActuelle, 0);
  const biens = patrimoine.filter((p) => p.category === "biens").reduce((s, p) => s + p.amount, 0);
  const stocks = patrimoine.filter((p) => p.category === "stocks").reduce((s, p) => s + p.amount, 0);
  const dettesTotal = debts.filter((d) => d.status !== "remboursee").reduce((s, d) => s + d.amount, 0);
  const actifs = liquidites + creances + investissementsTotal + biens + stocks;
  return { liquidites, creances, investissementsTotal, biens, stocks, actifs, passifs: dettesTotal, net: actifs - dettesTotal };
}

// ---------- Objectifs (Phase 4) ----------
function goalCurrentAmount(g) {
  if (g.envelopeKey) return computeBalances()[g.envelopeKey] || 0;
  return g.manualAmount || 0;
}
function goalProgress(g) {
  if (!g.targetAmount) return 0;
  return Math.min(100, Math.max(0, (goalCurrentAmount(g) / g.targetAmount) * 100));
}

// ---------- Créances : encaissement (Phase 6) ----------
// Marquer payée génère une vraie entrée sur le compte choisi, qui se répartit ensuite
// normalement dans les enveloppes — comme n'importe quelle autre entrée d'argent.
function markReceivablePaid(id, accountId) {
  const r = receivables.find((x) => x.id === id);
  if (!r || r.status === "payee") return;
  r.status = "payee";
  r.paidDate = new Date().toISOString().slice(0, 10);
  r.paidAccountId = accountId;
  transactions.unshift({
    id: uid(), type: "entree", amount: r.amount,
    label: "Créance encaissée : " + r.name,
    category: "disponible", accountId, date: r.paidDate,
  });
  save();
}

// ---------- Dettes : remboursement (Phase 6) ----------
function markDebtPaid(id, accountId, category) {
  const d = debts.find((x) => x.id === id);
  if (!d || d.status === "remboursee") return;
  d.status = "remboursee";
  d.paidDate = new Date().toISOString().slice(0, 10);
  d.paidAccountId = accountId;
  transactions.unshift({
    id: uid(), type: "depense", amount: d.amount,
    label: "Dette remboursée : " + d.name,
    category: category || "imprevu", accountId, date: d.paidDate,
  });
  save();
}

// ---------- Investissements (Phase 7) ----------
function investmentPerformance(inv) {
  if (!inv.montantInvesti) return 0;
  return ((inv.valeurActuelle - inv.montantInvesti) / inv.montantInvesti) * 100;
}

// ---------- Dashboard (Phase 8) ----------
function computeDashboard() {
  const accBal = computeAccountBalances();
  const totalComptes = Object.values(accBal).reduce((s, v) => s + v, 0);
  const envBal = computeBalances();
  const disponible = envBal["disponible"] || 0;
  const month = computeMonthTotals();
  const pat = computePatrimoine();
  const urgence = envBal["imprevu"] || 0;
  return {
    totalComptes, disponible,
    depensesMois: month.expense, revenusMois: month.income,
    objectifsCount: goals.length,
    fondsUrgence: urgence,
    investissementsTotal: pat.investissementsTotal,
    patrimoineNet: pat.net,
  };
}

function computeMonthSummary() {
  const ym = currentYearMonth();
  const monthTx = transactions.filter((t) => t.date && t.date.startsWith(ym));
  const { income, expense, net } = computeMonthTotals();
  const byCat = {};
  monthTx.filter((t) => t.type === "depense").forEach((t) => {
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  });
  let topCat = null, topAmt = 0;
  Object.entries(byCat).forEach(([k, v]) => {
    if (v > topAmt) { topAmt = v; topCat = k; }
  });
  const topLabel = topCat ? (envelopes.find((e) => e.key === topCat)?.label || topCat) : null;
  return { income, expense, net, topLabel, topAmt };
}

function last6Months() {
  const arr = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({ ym: d.toISOString().slice(0, 7), label: d.toLocaleDateString("fr-FR", { month: "short" }) });
  }
  return arr;
}

// ---------- Rendering ----------
function renderResume() {
  const totals = computeMonthTotals();
  document.getElementById("sumIncome").textContent = fmt(totals.income);
  document.getElementById("sumExpense").textContent = fmt(totals.expense);
  const netEl = document.getElementById("sumNet");
  netEl.textContent = fmt(totals.net);
  netEl.style.color = totals.net >= 0 ? COLORS.indigo : COLORS.rust;

  const balances = computeBalances();
  const container = document.getElementById("envelopeCards");
  container.innerHTML = "";
  envelopes.forEach((e) => {
    const bal = balances[e.key] || 0;
    const isOver = bal < 0;
    const pct = e.target ? Math.min(100, Math.max(0, (bal / e.target) * 100)) : null;
    const div = document.createElement("div");
    div.className = "env" + (isOver ? " over" : "");
    div.innerHTML = `
      <div class="top sans"><span class="name"><span class="dot" style="background:${esc(e.color)}"></span>${esc(e.label)}</span>
      <span class="mono bal" style="color:${isOver ? COLORS.rust : COLORS.ink}">${isOver ? "⚠ " : ""}${fmt(bal)}</span></div>
      ${e.target ? `<div class="bar"><div style="width:${pct}%;background:${esc(e.color)}"></div></div>
      <div class="target sans">Objectif ${fmt(e.target)}</div>` : ""}
    `;
    container.appendChild(div);
  });

  const targetPct = envelopes.filter((e) => e.savings).reduce((s, e) => s + Number(e.percent), 0);
  document.getElementById("savingsPct").textContent = targetPct + "%";
  document.getElementById("savingsAmt").textContent = `≈ ${fmt((totals.income * targetPct) / 100)} épargnés ce mois, au rythme actuel`;

  renderMonthSummary();
  renderEvoChart();
}

function renderMonthSummary() {
  const s = computeMonthSummary();
  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  document.getElementById("summaryMonthLabel").textContent = monthLabel;
  document.getElementById("summaryText").innerHTML = `
    ${fmt(s.income)} reçus, ${fmt(s.expense)} dépensés — solde ${s.net >= 0 ? "positif" : "négatif"} de ${fmt(Math.abs(s.net))}.<br>
    ${s.topLabel ? `Enveloppe la plus sollicitée : <strong>${s.topLabel}</strong> (${fmt(s.topAmt)}).` : "Aucune dépense catégorisée ce mois-ci pour le moment."}
  `;
}

function renderEvoChart() {
  const months = last6Months();
  const data = months.map((m) => {
    let income = 0, expense = 0;
    transactions.forEach((t) => {
      if (t.date && t.date.startsWith(m.ym)) {
        if (t.type === "entree") income += t.amount;
        else if (t.type === "depense") expense += t.amount;
      }
    });
    return { ...m, income, expense };
  });
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const w = 320, h = 130, bw = w / data.length;
  let bars = "";
  data.forEach((d, i) => {
    const x = i * bw;
    const hIncome = (d.income / max) * (h - 24);
    const hExpense = (d.expense / max) * (h - 24);
    bars += `
      <rect x="${x + 6}" y="${h - hIncome - 18}" width="${bw / 2 - 8}" height="${hIncome}" fill="${COLORS.teal}" rx="2"></rect>
      <rect x="${x + bw / 2 + 2}" y="${h - hExpense - 18}" width="${bw / 2 - 8}" height="${hExpense}" fill="${COLORS.rust}" rx="2"></rect>
      <text x="${x + bw / 2}" y="${h - 4}" font-size="9" text-anchor="middle" style="fill:var(--muted)">${d.label}</text>
    `;
  });
  document.getElementById("evoChart").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;">${bars}</svg>
    <div class="evo-legend sans"><span style="color:${COLORS.teal}">■</span> Entrées &nbsp; <span style="color:${COLORS.rust}">■</span> Dépenses</div>
  `;
}

function renderJournal() {
  const list = document.getElementById("journalList");
  list.innerHTML = "";
  if (transactions.length === 0) {
    list.innerHTML = `<div class="empty sans">Aucun mouvement enregistré pour le moment.</div>`;
    return;
  }
  transactions.forEach((t) => {
    const div = document.createElement("div");
    div.className = "txn sans";
    let catLabel = "", accLabel = "", amtColor, amtSign;
    if (t.type === "transfer") {
      const fromName = accounts.find((a) => a.id === t.fromAccountId)?.name || "?";
      const toName = accounts.find((a) => a.id === t.toAccountId)?.name || "?";
      accLabel = `${fromName} → ${toName}`;
      amtColor = COLORS.indigo;
      amtSign = "↔ ";
    } else {
      catLabel = t.type === "depense" ? (envelopes.find((e) => e.key === t.category)?.label || t.category) : "";
      accLabel = accounts.find((a) => a.id === t.accountId)?.name || "";
      amtColor = t.type === "entree" ? COLORS.teal : COLORS.rust;
      amtSign = t.type === "entree" ? "+" : "-";
    }
    div.innerHTML = `
      <div class="left">
        <div class="desc">
          <div class="t">${esc(t.label)}</div>
          <div class="d">${esc(t.date)}${catLabel ? " · " + esc(catLabel) : ""}${accLabel ? " · " + esc(accLabel) : ""}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="amt mono" style="color:${amtColor}">${amtSign}${fmt(t.amount)}</span>
        <button class="del" data-id="${esc(t.id)}">✕</button>
      </div>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll(".del").forEach((btn) => {
    btn.addEventListener("click", () => {
      transactions = transactions.filter((t) => t.id !== btn.dataset.id);
      save();
      renderAll();
    });
  });
}

function renderEnvelopeDetail() {
  const balances = computeBalances();
  const el = document.getElementById("envelopeDetail");
  el.innerHTML = "";
  envelopes.forEach((e) => {
    const bal = balances[e.key] || 0;
    const div = document.createElement("div");
    div.className = "env sans" + (bal < 0 ? " over" : "");
    div.style.marginBottom = "10px";
    const rightVal = settings.incomeMode === "irregular" ? e.percent + "%" : fmt(e.monthlyAmount || 0);
    div.innerHTML = `
      <div class="top"><span class="name"><span class="dot" style="background:${esc(e.color)}"></span>${esc(e.label)}</span><span class="mono">${rightVal}</span></div>
      <div style="font-size:11px;color:var(--muted);margin:4px 0;">${esc(e.note || "")}</div>
      <div class="mono" style="color:${bal < 0 ? COLORS.rust : COLORS.ink}">Solde : ${bal < 0 ? "⚠ " : ""}${fmt(bal)}</div>
    `;
    el.appendChild(div);
  });
}

function renderSliders() {
  const el = document.getElementById("sliders");
  el.innerHTML = "";
  const irregular = settings.incomeMode === "irregular";
  envelopes.forEach((e) => {
    const row = document.createElement("div");
    row.className = "slider-row sans";
    if (irregular) {
      row.innerHTML = `
        <span class="lbl"><span class="dot" style="background:${esc(e.color)}"></span> ${esc(e.label)}</span>
        <input type="range" min="0" max="60" value="${e.percent}" data-key="${e.key}">
        <span class="pct mono">${e.percent}%</span>
        <button type="button" class="env-del" data-key="${e.key}" title="Supprimer l'enveloppe">✕</button>
      `;
    } else {
      row.innerHTML = `
        <span class="lbl"><span class="dot" style="background:${esc(e.color)}"></span> ${esc(e.label)}</span>
        <input type="number" min="0" value="${e.monthlyAmount || 0}" data-key="${e.key}">
        <span class="pct mono">fr</span>
        <button type="button" class="env-del" data-key="${e.key}" title="Supprimer l'enveloppe">✕</button>
      `;
    }
    el.appendChild(row);
  });
  if (irregular) {
    el.querySelectorAll("input[type=range]").forEach((input) => {
      input.addEventListener("input", () => {
        const env = envelopes.find((e) => e.key === input.dataset.key);
        env.percent = Number(input.value);
        input.nextElementSibling.textContent = env.percent + "%";
        updatePctTotal();
        save();
      });
    });
  } else {
    el.querySelectorAll("input[type=number]").forEach((input) => {
      input.addEventListener("input", () => {
        const env = envelopes.find((e) => e.key === input.dataset.key);
        env.monthlyAmount = Number(input.value) || 0;
        updatePctTotal();
        save();
      });
    });
  }
  el.querySelectorAll(".env-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const env = envelopes.find((e) => e.key === btn.dataset.key);
      if (!confirm(`Supprimer l'enveloppe "${env.label}" ? Les mouvements déjà enregistrés dans cette catégorie resteront dans le journal.`)) return;
      envelopes = envelopes.filter((e) => e.key !== btn.dataset.key);
      save();
      refreshCategoryOptions();
      renderAll();
    });
  });
  updatePctTotal();
}

function renderNewEnvSwatches() {
  const el = document.getElementById("newEnvSwatches");
  if (!el) return;
  el.innerHTML = "";
  ENVELOPE_COLORS.forEach((c, i) => {
    const s = document.createElement("div");
    s.className = "swatch" + (i === 0 ? " sel" : "");
    s.style.background = c;
    s.dataset.color = c;
    s.addEventListener("click", () => {
      el.querySelectorAll(".swatch").forEach((n) => n.classList.remove("sel"));
      s.classList.add("sel");
    });
    el.appendChild(s);
  });
}

function renderMigrationNotice() {
  const el = document.getElementById("migrationNotice");
  if (!el) return;
  if (!migrationV3Notice) { el.innerHTML = ""; return; }
  const parts = [];
  if (migrationV3Notice.debts.length) parts.push(`${migrationV3Notice.debts.length} passif(s) déplacé(s) vers Dettes : ${migrationV3Notice.debts.join(", ")}`);
  if (migrationV3Notice.biens.length) parts.push(`${migrationV3Notice.biens.length} actif(s) classé(s) par défaut en "Biens" : ${migrationV3Notice.biens.join(", ")} — vérifie qu'aucun n'est déjà compté comme Compte (ex: MoMo), sinon supprime-le d'ici.`);
  el.innerHTML = `<div class="banner warn sans">⚠️ Mise à jour du patrimoine : ${parts.join(" · ")} <button type="button" id="dismissMigrationNotice" style="margin-left:8px;background:none;border:none;text-decoration:underline;cursor:pointer;color:inherit;">Compris</button></div>`;
  const btn = document.getElementById("dismissMigrationNotice");
  if (btn) btn.addEventListener("click", () => { migrationV3Notice = null; renderMigrationNotice(); });
}

function renderPatrimoine() {
  const pat = computePatrimoine();
  document.getElementById("sumActifs").textContent = fmt(pat.actifs);
  document.getElementById("sumPassifs").textContent = fmt(pat.passifs);
  const netEl = document.getElementById("sumNetWorth");
  netEl.textContent = fmt(pat.net);
  netEl.style.color = pat.net >= 0 ? COLORS.indigo : COLORS.rust;

  document.getElementById("patLiquidites").textContent = fmt(pat.liquidites);
  document.getElementById("patCreances").textContent = fmt(pat.creances);
  document.getElementById("patInvestissements").textContent = fmt(pat.investissementsTotal);
  document.getElementById("patBiens").textContent = fmt(pat.biens);
  document.getElementById("patStocks").textContent = fmt(pat.stocks);

  renderMigrationNotice();
  renderGoals();
  renderReceivables();
  renderDebts();
  renderInvestments();
  renderBiensStocks();
}

// ---------- Objectifs ----------
function refreshGoalEnvelopeOptions() {
  const sel = document.getElementById("goalEnvelope");
  if (!sel) return;
  sel.innerHTML = `<option value="">Aucune (montant manuel)</option>` + envelopes.map((e) => `<option value="${esc(e.key)}">${esc(e.label)}</option>`).join("");
}

function renderGoals() {
  const el = document.getElementById("goalsList");
  if (!el) return;
  el.innerHTML = "";
  if (goals.length === 0) { el.innerHTML = `<div class="empty sans">Aucun objectif pour le moment.</div>`; return; }
  goals.forEach((g) => {
    const current = goalCurrentAmount(g);
    const pct = goalProgress(g);
    const div = document.createElement("div");
    div.className = "env sans";
    div.style.marginBottom = "10px";
    div.innerHTML = `
      <div class="top">
        <span class="name">${esc(g.name)}${g.deadline ? ` <span style="color:var(--muted);font-weight:400;font-size:11px;">— avant ${esc(g.deadline)}</span>` : ""}</span>
        <span class="mono">${fmt(current)} / ${fmt(g.targetAmount)}</span>
      </div>
      <div class="bar"><div style="width:${pct}%;background:${COLORS.forest}"></div></div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
        ${!g.envelopeKey ? `<input type="number" placeholder="+ ajouter" class="goal-add" data-id="${g.id}" style="max-width:120px;padding:6px 8px;">` : `<span class="target sans">Suivi automatique (enveloppe ${envelopes.find(e=>e.key===g.envelopeKey)?.label || g.envelopeKey})</span>`}
        <button type="button" class="ghost goal-del" data-id="${g.id}" style="font-size:11px;padding:5px 10px;margin-left:auto;">Supprimer</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".goal-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      goals = goals.filter((g) => g.id !== btn.dataset.id);
      save();
      renderGoals();
    });
  });
  el.querySelectorAll(".goal-add").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const val = parseFloat(input.value);
      if (!val) return;
      const g = goals.find((x) => x.id === input.dataset.id);
      g.manualAmount = (g.manualAmount || 0) + val;
      save();
      renderGoals();
    });
  });
}

document.getElementById("goalForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("goalName").value.trim();
  const targetAmount = parseFloat(document.getElementById("goalTarget").value);
  const envelopeKey = document.getElementById("goalEnvelope").value || null;
  const deadline = document.getElementById("goalDeadline").value || null;
  if (!name || !targetAmount) return;
  goals.push({ id: uid(), name, targetAmount, envelopeKey, manualAmount: 0, deadline });
  save();
  e.target.reset();
  renderGoals();
});

// ---------- Créances ----------
function renderReceivables() {
  const el = document.getElementById("receivablesList");
  if (!el) return;
  el.innerHTML = "";
  if (receivables.length === 0) { el.innerHTML = `<div class="empty sans">Aucune créance enregistrée.</div>`; return; }
  receivables.forEach((r) => {
    const div = document.createElement("div");
    div.className = "env sans";
    div.style.marginBottom = "10px";
    const paid = r.status === "payee";
    div.innerHTML = `
      <div class="top">
        <span class="name">${esc(r.name)}${r.dueDate ? ` <span style="color:var(--muted);font-weight:400;font-size:11px;">— échéance ${esc(r.dueDate)}</span>` : ""}</span>
        <span class="mono" style="color:${paid ? COLORS.teal : COLORS.ink}">${fmt(r.amount)}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${paid
          ? `<span class="target sans">Encaissée le ${r.paidDate}</span>`
          : `<select class="receivable-account" data-id="${r.id}" style="max-width:180px;">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
             <button type="button" class="primary receivable-pay" data-id="${r.id}" style="font-size:12px;padding:7px 12px;">Marquer payée</button>`
        }
        <button type="button" class="ghost receivable-del" data-id="${r.id}" style="font-size:11px;padding:5px 10px;margin-left:auto;">Supprimer</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".receivable-pay").forEach((btn) => {
    btn.addEventListener("click", () => {
      const accSel = el.querySelector(`.receivable-account[data-id="${btn.dataset.id}"]`);
      if (!confirm("Confirmer l'encaissement ? Une entrée sera créée sur le compte choisi et répartie dans tes enveloppes.")) return;
      markReceivablePaid(btn.dataset.id, accSel.value);
      renderAll();
    });
  });
  el.querySelectorAll(".receivable-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      receivables = receivables.filter((r) => r.id !== btn.dataset.id);
      save();
      renderReceivables();
      renderPatrimoine();
    });
  });
}

document.getElementById("receivableForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("receivableName").value.trim();
  const amount = parseFloat(document.getElementById("receivableAmount").value);
  const dueDate = document.getElementById("receivableDue").value || null;
  if (!name || !amount) return;
  receivables.push({ id: uid(), name, amount, dueDate, status: "en_attente" });
  save();
  e.target.reset();
  renderReceivables();
  renderPatrimoine();
});

// ---------- Dettes ----------
function renderDebts() {
  const el = document.getElementById("debtsList");
  if (!el) return;
  el.innerHTML = "";
  if (debts.length === 0) { el.innerHTML = `<div class="empty sans">Aucune dette enregistrée.</div>`; return; }
  debts.forEach((d) => {
    const div = document.createElement("div");
    div.className = "env sans";
    div.style.marginBottom = "10px";
    const paid = d.status === "remboursee";
    div.innerHTML = `
      <div class="top">
        <span class="name">${esc(d.name)}${d.dueDate ? ` <span style="color:var(--muted);font-weight:400;font-size:11px;">— échéance ${d.dueDate}</span>` : ""}</span>
        <span class="mono" style="color:${paid ? COLORS.teal : COLORS.rust}">${fmt(d.amount)}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${paid
          ? `<span class="target sans">Remboursée le ${d.paidDate}</span>`
          : `<select class="debt-account" data-id="${d.id}" style="max-width:180px;">${accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
             <button type="button" class="primary debt-pay" data-id="${d.id}" style="font-size:12px;padding:7px 12px;">Marquer remboursée</button>`
        }
        <button type="button" class="ghost debt-del" data-id="${d.id}" style="font-size:11px;padding:5px 10px;margin-left:auto;">Supprimer</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".debt-pay").forEach((btn) => {
    btn.addEventListener("click", () => {
      const accSel = el.querySelector(`.debt-account[data-id="${btn.dataset.id}"]`);
      if (!confirm("Confirmer le remboursement ? Une dépense sera créée sur le compte choisi.")) return;
      markDebtPaid(btn.dataset.id, accSel.value, "imprevu");
      renderAll();
    });
  });
  el.querySelectorAll(".debt-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      debts = debts.filter((d) => d.id !== btn.dataset.id);
      save();
      renderDebts();
      renderPatrimoine();
    });
  });
}

document.getElementById("debtForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("debtName").value.trim();
  const amount = parseFloat(document.getElementById("debtAmount").value);
  const dueDate = document.getElementById("debtDue").value || null;
  if (!name || !amount) return;
  debts.push({ id: uid(), name, amount, dueDate, status: "en_attente" });
  save();
  e.target.reset();
  renderDebts();
  renderPatrimoine();
});

// ---------- Investissements ----------
function renderInvestments() {
  const el = document.getElementById("investmentsList");
  if (!el) return;
  el.innerHTML = "";
  if (investments.length === 0) { el.innerHTML = `<div class="empty sans">Aucun investissement enregistré.</div>`; return; }
  investments.forEach((inv) => {
    const perf = investmentPerformance(inv);
    const div = document.createElement("div");
    div.className = "env sans";
    div.style.marginBottom = "10px";
    div.innerHTML = `
      <div class="top">
        <span class="name">${inv.name} <span style="color:var(--muted);font-weight:400;font-size:11px;">— ${inv.type}</span></span>
        <span class="mono" style="color:${perf >= 0 ? COLORS.teal : COLORS.rust}">${fmt(inv.valeurActuelle)}</span>
      </div>
      <div class="target sans" style="margin-top:4px;">Investi : ${fmt(inv.montantInvesti)} · Performance : ${perf >= 0 ? "+" : ""}${perf.toFixed(1)}%</div>
      <div style="margin-top:8px;">
        <button type="button" class="ghost investment-del" data-id="${inv.id}" style="font-size:11px;padding:5px 10px;">Supprimer</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".investment-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      investments = investments.filter((i) => i.id !== btn.dataset.id);
      save();
      renderInvestments();
      renderPatrimoine();
    });
  });
}

document.getElementById("investmentForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("investmentName").value.trim();
  const type = document.getElementById("investmentType").value.trim() || "Autre";
  const montantInvesti = parseFloat(document.getElementById("investmentMontant").value);
  const valeurActuelle = parseFloat(document.getElementById("investmentValeur").value);
  if (!name || !montantInvesti || !valeurActuelle) return;
  investments.push({ id: uid(), name, type, montantInvesti, valeurActuelle, date: new Date().toISOString().slice(0, 10) });
  save();
  e.target.reset();
  renderInvestments();
  renderPatrimoine();
});

// ---------- Biens & Stocks (ex-patrimoine manuel) ----------
function renderBiensStocks() {
  const el = document.getElementById("patrimoineList");
  if (!el) return;
  el.innerHTML = "";
  if (patrimoine.length === 0) { el.innerHTML = `<div class="empty sans">Aucun bien ou stock enregistré.</div>`; return; }
  patrimoine.forEach((p) => {
    const div = document.createElement("div");
    div.className = "txn sans";
    div.innerHTML = `
      <div class="left">
        <div class="desc">
          <div class="t">${esc(p.label)}</div>
          <div class="d">${p.category === "stocks" ? "Stock" : "Bien"}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="amt mono">${fmt(p.amount)}</span>
        <button class="del" data-id="${esc(p.id)}">✕</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".del").forEach((btn) => {
    btn.addEventListener("click", () => {
      patrimoine = patrimoine.filter((p) => p.id !== btn.dataset.id);
      save();
      renderBiensStocks();
      renderPatrimoine();
    });
  });
}

// ---------- Dashboard (Phase 8) ----------
function renderDashboard() {
  const el = document.getElementById("dashboardCards");
  if (!el) return;
  const d = computeDashboard();
  const cards = [
    ["Argent total (comptes)", fmt(d.totalComptes), COLORS.ink],
    ["Disponible", fmt(d.disponible), COLORS.indigo],
    ["Dépenses du mois", fmt(d.depensesMois), COLORS.rust],
    ["Revenus du mois", fmt(d.revenusMois), COLORS.teal],
    ["Objectifs en cours", d.objectifsCount, COLORS.forest],
    ["Fonds d'urgence (imprévu)", fmt(d.fondsUrgence), COLORS.mustard],
    ["Investissements", fmt(d.investissementsTotal), COLORS.sienna],
    ["Patrimoine net", fmt(d.patrimoineNet), d.patrimoineNet >= 0 ? COLORS.indigo : COLORS.rust],
  ];
  el.innerHTML = cards.map(([label, value, color]) => `
    <div class="card"><div class="label sans">${label}</div><div class="value mono" style="color:${color}">${value}</div></div>
  `).join("");
}

function updatePctTotal() {
  const el = document.getElementById("pctTotal");
  if (settings.incomeMode === "irregular") {
    const total = envelopes.reduce((s, e) => s + Number(e.percent), 0);
    el.textContent = `Total actuel : ${total}%${total !== 100 ? " (devrait faire 100%)" : ""}`;
    el.style.color = total === 100 ? COLORS.teal : COLORS.rust;
  } else {
    const total = envelopes.reduce((s, e) => s + Number(e.monthlyAmount || 0), 0);
    el.textContent = `Budget mensuel total alloué : ${fmt(total)}`;
    el.style.color = COLORS.ink;
  }
}

function renderAll() {
  renderResume();
  renderJournal();
  renderEnvelopeDetail();
  renderSliders();
  renderPatrimoine();
  renderAccounts();
  renderDashboard();
  refreshGoalEnvelopeOptions();
  renderReminderBanner();
  renderReminderSettings();
}

// ---------- Rappel quotidien ----------
function hasLoggedToday() {
  const today = new Date().toISOString().slice(0, 10);
  return transactions.some((t) => t.date === today);
}

function renderReminderSettings() {
  const enabled = settings.reminderEnabled === true;
  document.querySelectorAll("#reminderToggle button").forEach((b) => {
    b.classList.toggle("active", (b.dataset.reminder === "on") === enabled);
  });
  document.getElementById("reminderTimeBlock").style.display = enabled ? "flex" : "none";
  document.getElementById("reminderTime").value = settings.reminderTime || "20:00";
}

function renderReminderBanner() {
  const el = document.getElementById("reminderBanner");
  if (!settings.reminderEnabled) { el.innerHTML = ""; return; }

  const now = new Date();
  const [h, m] = (settings.reminderTime || "20:00").split(":").map(Number);
  const pastTime = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);

  if (pastTime && !hasLoggedToday()) {
    el.innerHTML = `
      <div class="reminder-banner sans">
        <span>🐷 Tu n'as encore rien noté aujourd'hui — un petit point avant la fin de la journée ?</span>
        <button type="button" onclick="document.getElementById('fAmount').focus()">Faire mon point</button>
      </div>`;
    if (Notification && Notification.permission === "granted" && !sessionStorage.getItem("eq_reminder_shown")) {
      new Notification("SmartG", { body: "N'oublie pas ton point du jour.", icon: "icons/icon-192.png" });
      sessionStorage.setItem("eq_reminder_shown", "1");
    }
  } else {
    el.innerHTML = "";
  }
}

document.getElementById("reminderToggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  const on = e.target.dataset.reminder === "on";
  settings.reminderEnabled = on;
  if (on && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
  saveSettings();
  renderReminderSettings();
  renderReminderBanner();
});
document.getElementById("reminderTime").addEventListener("change", (e) => {
  settings.reminderTime = e.target.value;
  saveSettings();
  renderReminderBanner();
});

// ---------- Tabs ----------
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const tab = btn.dataset.tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  ["resume", "journal", "enveloppes", "patrimoine", "reglages"].forEach((t) => {
    document.getElementById("tab-" + t).style.display = t === tab ? "block" : "none";
  });
});

// ---------- Theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#1B1917" : "#35407A");
  document.querySelectorAll("#themeToggle button").forEach((b) => b.classList.toggle("active", b.dataset.theme === theme));
  localStorage.setItem("eq_theme", theme);
}
applyTheme(localStorage.getItem("eq_theme") || "light");
document.getElementById("themeToggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  applyTheme(e.target.dataset.theme);
});

// ---------- Income mode ----------
function applyModeUI() {
  const irregular = settings.incomeMode === "irregular";
  document.querySelectorAll("#modeToggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === settings.incomeMode));
  document.getElementById("modeHint").textContent = irregular
    ? "Chaque entrée d'argent est répartie automatiquement selon les % ci-dessous — idéal pour des revenus qui varient."
    : "Chaque enveloppe a un budget fixe qui se renouvelle chaque mois — idéal pour un revenu régulier.";
  document.getElementById("reglagesRepartitionTitle").textContent = irregular ? "Répartition par entrée d'argent" : "Budgets mensuels par catégorie";
  document.getElementById("headerTagline").textContent = irregular
    ? "Chaque entrée se répartit automatiquement dans vos enveloppes."
    : "Un budget fixe par catégorie, renouvelé chaque mois.";
  document.getElementById("newEnvPercent").style.display = irregular ? "block" : "none";
  document.getElementById("newEnvMonthly").style.display = irregular ? "none" : "block";
  document.getElementById("newEnvHint").textContent = irregular
    ? "Le pourcentage est prélevé sur chaque entrée d'argent — ajustez le total ci-dessus à 100 % ensuite."
    : "Le budget mensuel se renouvelle automatiquement chaque mois.";
}
document.getElementById("modeToggle").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  settings.incomeMode = e.target.dataset.mode;
  saveSettings();
  applyModeUI();
  renderAll();
});

// ---------- Face ID / biométrie (WebAuthn) ----------
// Utilisé uniquement comme verrou LOCAL de l'appareil (aucun serveur) : on ne vérifie pas
// une signature à distance, on demande juste au téléphone de prouver via son capteur
// biométrique que c'est bien le même appareil/propriétaire qui a activé l'option.
function buf2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b642buf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}
function biometricAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}
async function setupBiometric() {
  if (!biometricAvailable()) { alert("Face ID / biométrie non disponible sur cet appareil ou ce navigateur."); return; }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "SmartG" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "smartg", displayName: "SmartG" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    settings.webauthnId = buf2b64(cred.rawId);
    saveSettings();
    renderPinStatus();
    alert("Face ID / biométrie activé.");
  } catch (err) {
    alert("Impossible d'activer la biométrie : " + err.message);
  }
}
async function verifyBiometric() {
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: b642buf(settings.webauthnId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return true;
  } catch (err) {
    return false;
  }
}
document.getElementById("biometricSetup")?.addEventListener("click", setupBiometric);
document.getElementById("biometricRemove")?.addEventListener("click", () => {
  if (!confirm("Désactiver Face ID / biométrie ?")) return;
  settings.webauthnId = null;
  saveSettings();
  renderPinStatus();
});
document.getElementById("lockBiometricBtn")?.addEventListener("click", async () => {
  const ok = await verifyBiometric();
  if (ok) {
    sessionStorage.setItem("eq_unlocked", "1");
    document.getElementById("lockScreen").classList.remove("show");
    document.getElementById("lockError").textContent = "";
  } else {
    document.getElementById("lockError").textContent = "Échec de la vérification biométrique — utilise ton code.";
  }
});

// ---------- Coffre chiffré, activation et PIN ----------
function renderPinStatus() {
  const el = document.getElementById("pinStatus");
  if (el) el.textContent = settings.pinHash ? "Coffre chiffré et verrouillage activé." : "Coffre chiffré actif. Aucun PIN secondaire défini.";
  document.getElementById("biometricSetup")?.style && (document.getElementById("biometricSetup").style.display = "none");
  document.getElementById("biometricRemove")?.style && (document.getElementById("biometricRemove").style.display = "none");
}
async function unlockVault(pin) {
  const record = JSON.parse(localStorage.getItem(VAULT_KEY) || "null");
  if (!record) throw new Error("no vault");
  const salt = fromB64(record.salt); const key = await deriveVaultKey(pin, salt); const data = await decryptVault(key, record);
  transactions=Array.isArray(data.transactions)?data.transactions:[]; envelopes=Array.isArray(data.envelopes)?data.envelopes:DEFAULT_ENVELOPES.map(e=>({...e})); patrimoine=Array.isArray(data.patrimoine)?data.patrimoine:[]; accounts=Array.isArray(data.accounts)?data.accounts:[]; goals=Array.isArray(data.goals)?data.goals:[]; receivables=Array.isArray(data.receivables)?data.receivables:[]; debts=Array.isArray(data.debts)?data.debts:[]; investments=Array.isArray(data.investments)?data.investments:[]; settings=data.settings||{incomeMode:"irregular",schemaVersion:SCHEMA_VERSION};
  vaultSalt=salt; vaultKey=key; migrateEnvelopes(); migrateToV2(); migrateToV3(); revealApp();
}
async function createVault(pin) {
  const legacy = { transactions: localStorage.getItem("eq_transactions"), envelopes: localStorage.getItem("eq_envelopes"), patrimoine: localStorage.getItem("eq_patrimoine"), accounts: localStorage.getItem("eq_accounts"), goals: localStorage.getItem("eq_goals"), receivables: localStorage.getItem("eq_receivables"), debts: localStorage.getItem("eq_debts"), investments: localStorage.getItem("eq_investments"), settings: localStorage.getItem("eq_settings") };
  try {
    if (legacy.transactions) transactions=JSON.parse(legacy.transactions)||[];
    if (legacy.envelopes) envelopes=JSON.parse(legacy.envelopes)||envelopes;
    if (legacy.patrimoine) patrimoine=JSON.parse(legacy.patrimoine)||[];
    if (legacy.accounts) accounts=JSON.parse(legacy.accounts)||[];
    if (legacy.goals) goals=JSON.parse(legacy.goals)||[];
    if (legacy.receivables) receivables=JSON.parse(legacy.receivables)||[];
    if (legacy.debts) debts=JSON.parse(legacy.debts)||[];
    if (legacy.investments) investments=JSON.parse(legacy.investments)||[];
    if (legacy.settings) settings={...settings,...JSON.parse(legacy.settings)};
  } catch { /* corrupted legacy values are ignored */ }
  vaultSalt=crypto.getRandomValues(new Uint8Array(16)); vaultKey=await deriveVaultKey(pin,vaultSalt); settings.pinHash=await sha256(pin); settings.schemaVersion=SCHEMA_VERSION;
  migrateEnvelopes(); migrateToV2(); migrateToV3(); await persistVault();
  ["eq_transactions","eq_envelopes","eq_patrimoine","eq_accounts","eq_goals","eq_receivables","eq_debts","eq_investments","eq_settings","cc_transactions","cc_envelopes","cc_patrimoine","cc_accounts","cc_goals","cc_receivables","cc_debts","cc_investments"].forEach(k=>localStorage.removeItem(k));
  revealApp();
}
function startSecurity() {
  if (!localStorage.getItem(VAULT_KEY)) { showSecurity("setupScreen"); return; }
  // lockScreen lives inside appShell; reveal the shell before showing it,
  // otherwise reopening the installed PWA leaves a completely white page.
  document.getElementById("appShell").classList.add("ready");
  showSecurity("lockScreen");
}
document.getElementById("setupSubmit")?.addEventListener("click",async()=>{const a=document.getElementById("setupPin").value,b=document.getElementById("setupPinConfirm").value,err=document.getElementById("setupError");if(a.length<6||a.length>64||a!==b){err.textContent="Choisissez deux fois un mot de passe de 6 à 64 caractères.";return;}try{await createVault(a);}catch(e){err.textContent="Impossible de créer le coffre local.";}});
document.getElementById("lockSubmit")?.addEventListener("click",async()=>{try{await unlockVault(document.getElementById("lockInput").value);}catch{document.getElementById("lockError").textContent="Code incorrect ou coffre illisible.";}});
document.getElementById("lockInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("lockSubmit").click();});
document.getElementById("pinForm")?.addEventListener("submit",async e=>{e.preventDefault();const a=document.getElementById("pinNew").value,b=document.getElementById("pinConfirm").value;if(a.length<6||a.length>64||a!==b){alert("Le mot de passe doit contenir entre 6 et 64 caractères.");return;}vaultSalt=crypto.getRandomValues(new Uint8Array(16));vaultKey=await deriveVaultKey(a,vaultSalt);settings.pinHash=await sha256(a);await persistVault();renderPinStatus();e.target.reset();});
document.getElementById("pinRemove")?.addEventListener("click",()=>{alert("Le PIN principal du coffre ne peut pas être retiré sans recréer le coffre.");});

// ---------- Sauvegarde chiffrée ----------
document.getElementById("exportBtn").addEventListener("click",async()=>{const password=prompt("Mot de passe de sauvegarde (8 caractères minimum) :");if(!password||password.length<8){alert("Sauvegarde annulée.");return;}const oldSalt=vaultSalt;vaultSalt=crypto.getRandomValues(new Uint8Array(16));const key=await deriveVaultKey(password,vaultSalt);const data={kind:"smartg-encrypted-backup",version:4,exportedAt:new Date().toISOString(),vault:await encryptVault(key,{transactions,envelopes,patrimoine,accounts,goals,receivables,debts,investments,settings})};vaultSalt=oldSalt;const blob=new Blob([JSON.stringify(data)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`smartg-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);});
document.getElementById("importBtn").addEventListener("click",()=>document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change",e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{try{let data=JSON.parse(reader.result);if(data?.kind==="smartg-encrypted-backup"&&data.vault){const password=prompt("Mot de passe de la sauvegarde :");if(!password)return;data=await decryptVault(await deriveVaultKey(password,fromB64(data.vault.salt)),data.vault);}if(!data||!Array.isArray(data.transactions))throw new Error("invalid");if(!confirm("Importer ce fichier remplacera toutes les données de cet appareil. Continuer ?"))return;transactions=data.transactions||[];envelopes=data.envelopes||DEFAULT_ENVELOPES.map(x=>({...x}));patrimoine=data.patrimoine||[];accounts=data.accounts||[];goals=data.goals||[];receivables=data.receivables||[];debts=data.debts||[];investments=data.investments||[];settings=data.settings||settings;migrateEnvelopes();migrateToV2();migrateToV3();await persistVault();applyTheme(localStorage.getItem("eq_theme")||"light");applyModeUI();refreshCategoryOptions();refreshAccountOptions();renderAll();alert("Import réussi.");}catch{alert("Ce fichier n'est pas une sauvegarde valide.");}};reader.readAsText(file);e.target.value="";});

// ---------- Patrimoine form ----------
document.getElementById("patrimoineForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const label = document.getElementById("pLabel").value.trim();
  const amount = parseFloat(document.getElementById("pAmount").value);
  if (!label || !amount || amount <= 0) return;
  patrimoine.push({ id: uid(), label, category: document.getElementById("pType").value, amount });
  save();
  document.getElementById("pLabel").value = "";
  document.getElementById("pAmount").value = "";
  renderBiensStocks();
  renderPatrimoine();
});

// ---------- Comptes (Phase 1) ----------
const fAccount = document.getElementById("fAccount");
const fAccountFrom = document.getElementById("fAccountFrom");
const fAccountTo = document.getElementById("fAccountTo");
function refreshAccountOptions() {
  const opts = accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  fAccount.innerHTML = opts;
  fAccountFrom.innerHTML = opts;
  fAccountTo.innerHTML = opts;
  if (accounts.length > 1) fAccountTo.selectedIndex = 1;
}
refreshAccountOptions();

function accountTypeLabel(key) {
  return ACCOUNT_TYPES.find((t) => t.key === key)?.label || key;
}

function renderAccounts() {
  const balances = computeAccountBalances();
  const el = document.getElementById("accountsList");
  el.innerHTML = "";
  accounts.forEach((a) => {
    const bal = balances[a.id] || 0;
    const div = document.createElement("div");
    div.className = "env sans";
    div.style.marginBottom = "10px";
    div.innerHTML = `
      <div class="top">
        <span class="name">${esc(a.name)} <span style="color:var(--muted);font-weight:400;font-size:11px;">— ${accountTypeLabel(a.type)}</span></span>
        <span class="mono" style="color:${bal < 0 ? COLORS.rust : COLORS.ink}">${fmt(bal)}</span>
      </div>
      <div style="margin-top:6px;">
        <button type="button" class="ghost account-del" data-id="${esc(a.id)}" style="font-size:11px;padding:5px 10px;">Supprimer</button>
      </div>
    `;
    el.appendChild(div);
  });
  el.querySelectorAll(".account-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (accounts.length <= 1) { alert("Il faut garder au moins un compte."); return; }
      const id = btn.dataset.id;
      const used = transactions.some((t) => t.accountId === id || t.fromAccountId === id || t.toAccountId === id);
      if (used && !confirm("Ce compte contient des transactions. Elles seront transférées vers un autre compte. Continuer ?")) return;
      const fallback = accounts.find((a) => a.id !== id).id;
      transactions.forEach((t) => {
        if (t.accountId === id) t.accountId = fallback;
        if (t.fromAccountId === id) t.fromAccountId = fallback;
        if (t.toAccountId === id) t.toAccountId = fallback;
      });
      accounts = accounts.filter((a) => a.id !== id);
      save();
      refreshAccountOptions();
      renderAccounts();
      renderAll();
    });
  });
}

document.getElementById("newAccountForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("newAccountName").value.trim();
  const type = document.getElementById("newAccountType").value;
  if (!name) return;
  accounts.push({ id: uid(), name, type });
  save();
  refreshAccountOptions();
  renderAccounts();
  document.getElementById("newAccountName").value = "";
  e.target.reset();
});

// ---------- Form ----------
const fType = document.getElementById("fType");
const fCategory = document.getElementById("fCategory");
function refreshCategoryOptions() {
  fCategory.innerHTML = envelopes.map((e) => `<option value="${esc(e.key)}">${esc(e.label)}</option>`).join("");
}
refreshCategoryOptions();
fType.addEventListener("change", () => {
  const isTransfer = fType.value === "transfer";
  fCategory.style.display = fType.value === "depense" ? "block" : "none";
  document.getElementById("singleAccountRow").style.display = isTransfer ? "none" : "grid";
  document.getElementById("transferAccountsRow").style.display = isTransfer ? "grid" : "none";
});
document.getElementById("fDate").value = new Date().toISOString().slice(0, 10);

document.getElementById("entryForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById("fAmount").value);
  if (!amount || amount <= 0) return;
  const type = fType.value;
  const label = document.getElementById("fLabel").value;
  const date = document.getElementById("fDate").value;

  if (type === "transfer") {
    const from = fAccountFrom.value;
    const to = fAccountTo.value;
    if (!from || !to || from === to) {
      alert("Choisis deux comptes différents pour le transfert.");
      return;
    }
    transactions.unshift({
      id: uid(),
      type: "transfer",
      amount,
      label: label || "Transfert",
      fromAccountId: from,
      toAccountId: to,
      date,
    });
  } else {
    transactions.unshift({
      id: uid(),
      type,
      amount,
      label: label || (type === "entree" ? "Entrée" : "Dépense"),
      category: fCategory.value,
      accountId: fAccount.value,
      date,
    });
  }
  save();
  document.getElementById("fAmount").value = "";
  document.getElementById("fLabel").value = "";
  renderAll();
});

// ---------- New envelope form ----------
renderNewEnvSwatches();
document.getElementById("newEnvForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const label = document.getElementById("newEnvLabel").value.trim();
  if (!label) return;
  const targetVal = document.getElementById("newEnvTarget").value;
  const note = document.getElementById("newEnvNote").value.trim();
  const selSwatch = document.querySelector("#newEnvSwatches .swatch.sel");
  const color = selSwatch ? selSwatch.dataset.color : ENVELOPE_COLORS[envelopes.length % ENVELOPE_COLORS.length];

  const env = {
    key: slugify(label),
    label,
    color,
    target: targetVal ? Number(targetVal) : null,
    note: note || null,
    percent: 0,
    monthlyAmount: 0,
  };
  if (settings.incomeMode === "irregular") {
    env.percent = Number(document.getElementById("newEnvPercent").value) || 0;
  } else {
    env.monthlyAmount = Number(document.getElementById("newEnvMonthly").value) || 0;
  }

  envelopes.push(env);
  save();
  refreshCategoryOptions();
  renderAll();
  renderNewEnvSwatches();
  e.target.reset();
  document.getElementById("newEnvPercent").value = 5;
  document.getElementById("newEnvMonthly").value = 0;
  applyModeUI();
});

// ---------- Init ----------
applyTheme(localStorage.getItem("eq_theme") || "light");
startSecurity();
