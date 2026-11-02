// ====================== Firebase config ======================
// Login chalu karna ho to Firebase Console -> Project settings -> Your apps -> Web app se
// keys copy karke yahan paste karo. Jab tak YOUR_API_KEY hai, app Guest mode me chalega
// (data isi browser me save hoga, login nahi).
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

// ====================== Helpers ======================
const $ = (id) => document.getElementById(id);
const CATEGORIES = ["Food", "Travel", "Shopping", "Bills", "Health", "Rent", "Salary", "Other"];
const fmt = (n) => (n < 0 ? "-" : "") + "₹" + Math.abs(Number(n)).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const esc = (s) => { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; };

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());

function addWeekly(iso) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + 7);
  return toISO(d);
}
function addMonthly(iso, anchorDay) {
  const d = fromISO(iso);
  const y = d.getFullYear();
  const nextMonth = d.getMonth() + 1;
  const lastDay = new Date(y, nextMonth + 1, 0).getDate();
  return toISO(new Date(y, nextMonth, Math.min(anchorDay, lastDay)));
}

// ====================== State ======================
let transactions = [];
let settings = { budget: 0, recurring: [] };
let store = null;
let editingId = null;
let app, auth, db;

// ====================== Storage layers ======================
// Guest mode: localStorage
function localStore(key) {
  const persist = () => localStorage.setItem(key, JSON.stringify({ transactions, settings }));
  return {
    async load() {
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      if (raw) return raw;
      // purane version (v1) ka data migrate karo
      const old = JSON.parse(localStorage.getItem("transactions") || "null");
      if (Array.isArray(old)) {
        return {
          transactions: old.map((t) => ({ ...t, id: String(t.id) })),
          settings: { budget: 0, recurring: [] },
        };
      }
      return { transactions: [], settings: { budget: 0, recurring: [] } };
    },
    async saveTx() { persist(); },
    async deleteTx() { persist(); },
    async saveSettings() { persist(); },
  };
}

// Login mode: Firestore, har user ka apna data (users/{uid}/...)
let authLib = null; // firebase-auth module (login mode me load hota hai)
let fs = null;      // firebase-firestore module

function cloudStore(uid) {
  return {
    async load() {
      const snap = await fs.getDocs(fs.collection(db, "users", uid, "transactions"));
      const txs = snap.docs.map((d) => d.data());
      const s = await fs.getDoc(fs.doc(db, "users", uid, "meta", "settings"));
      return {
        transactions: txs,
        settings: { budget: 0, recurring: [], ...(s.exists() ? s.data() : {}) },
      };
    },
    saveTx: (tx) => fs.setDoc(fs.doc(db, "users", uid, "transactions", tx.id), tx),
    deleteTx: (id) => fs.deleteDoc(fs.doc(db, "users", uid, "transactions", id)),
    saveSettings: () => fs.setDoc(fs.doc(db, "users", uid, "meta", "settings"), settings),
  };
}

// ====================== Startup / Auth ======================
async function start(label, s, cloud) {
  store = s;
  $("auth").hidden = true;
  $("userLabel").textContent = label;
  $("logoutBtn").hidden = !cloud;
  $("userLabel").title = cloud ? "" : "Guest mode: data sirf is browser me save hota hai";

  const data = await store.load();
  transactions = data.transactions || [];
  settings = { budget: 0, recurring: [], ...data.settings };
  $("budget").value = settings.budget || "";
  await runRecurring();
  render();
}

function startGuest() {
  start("Guest", localStore("expense-tracker-guest"), false);
}

function authMessage(e) {
  const code = e.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Email ya password galat hai.";
  if (code.includes("email-already-in-use")) return "Ye email pehle se registered hai. Login karo.";
  if (code.includes("weak-password")) return "Password kam se kam 6 characters ka rakho.";
  if (code.includes("invalid-email")) return "Email sahi nahi hai.";
  return e.message || "Kuch gadbad ho gayi.";
}

async function doAuth(fnName) {
  $("authError").hidden = true;
  try {
    await authLib[fnName](auth, $("authEmail").value.trim(), $("authPass").value);
  } catch (e) {
    $("authError").textContent = authMessage(e);
    $("authError").hidden = false;
  }
}

// Firebase sirf tab load hota hai jab keys daali ho. Isse Guest mode kabhi internet/CDN par depend nahi karta.
async function initFirebase() {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  let appLib;
  try {
    [appLib, authLib, fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);
  } catch (e) {
    console.error(e);
    alert("Firebase load nahi ho paya (internet check karo). Abhi Guest mode me chal raha hai.");
    startGuest();
    return;
  }

  app = appLib.initializeApp(firebaseConfig);
  auth = authLib.getAuth(app);
  db = fs.getFirestore(app);

  authLib.onAuthStateChanged(auth, (user) => {
    if (user) {
      start(user.email, cloudStore(user.uid), true);
    } else {
      transactions = [];
      settings = { budget: 0, recurring: [] };
      $("auth").hidden = false;
      render();
    }
  });

  $("authForm").addEventListener("submit", (e) => {
    e.preventDefault();
    doAuth("signInWithEmailAndPassword");
  });
  $("signupBtn").addEventListener("click", () => {
    if (!$("authForm").reportValidity()) return;
    doAuth("createUserWithEmailAndPassword");
  });
  $("logoutBtn").addEventListener("click", () => authLib.signOut(auth));
}

// ====================== Feature 5: Recurring ======================
async function runRecurring() {
  const today = todayISO();
  let changed = false;
  for (const r of settings.recurring) {
    let guard = 0;
    while (r.nextDue <= today && guard++ < 120) {
      const tx = {
        id: `r_${r.id}_${r.nextDue}`, // fixed id => duplicate nahi banega
        desc: r.desc, amount: r.amount, type: r.type,
        category: r.category, date: r.nextDue, recurringId: r.id,
      };
      if (!transactions.some((t) => t.id === tx.id)) {
        transactions.push(tx);
        await store.saveTx(tx);
      }
      r.nextDue = r.frequency === "weekly" ? addWeekly(r.nextDue) : addMonthly(r.nextDue, r.anchorDay);
      changed = true;
    }
  }
  if (changed) await store.saveSettings();
}

$("rForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const start = $("rStart").value;
  settings.recurring.push({
    id: String(Date.now()),
    desc: $("rDesc").value.trim(),
    amount: parseFloat($("rAmount").value),
    type: $("rType").value,
    category: $("rCategory").value,
    frequency: $("rFreq").value,
    anchorDay: fromISO(start).getDate(),
    nextDue: start,
  });
  await store.saveSettings();
  await runRecurring();
  $("rForm").reset();
  $("rStart").value = todayISO();
  render();
});

async function stopRecurring(id) {
  settings.recurring = settings.recurring.filter((r) => r.id !== id);
  await store.saveSettings();
  render();
}

function renderRecurring() {
  const ul = $("rList");
  ul.innerHTML = "";
  $("rEmpty").hidden = settings.recurring.length > 0;
  settings.recurring.forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="info">
        <strong>${esc(r.desc)} <span class="badge">${r.frequency}</span></strong>
        <small>${esc(r.category)} • next: ${r.nextDue}</small>
      </div>
      <div class="right">
        <span class="amt ${r.type}">${r.type === "income" ? "+" : "-"}${fmt(r.amount)}</span>
        <button class="small-btn del" title="Stop">Stop</button>
      </div>`;
    li.querySelector(".del").addEventListener("click", () => stopRecurring(r.id));
    ul.appendChild(li);
  });
}

// ====================== Feature 1: Add / Edit / Delete ======================
function resetForm() {
  editingId = null;
  $("form").reset();
  $("date").value = todayISO();
  $("submitBtn").textContent = "Add";
  $("formTitle").textContent = "Add Transaction";
  $("cancelEdit").hidden = true;
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    desc: $("desc").value.trim(),
    amount: parseFloat($("amount").value),
    type: $("type").value,
    category: $("category").value,
    date: $("date").value,
  };
  if (!data.desc || !(data.amount > 0)) return;

  let tx;
  if (editingId) {
    tx = transactions.find((t) => t.id === editingId);
    Object.assign(tx, data);
  } else {
    tx = { id: String(Date.now()), ...data };
    transactions.push(tx);
  }
  await store.saveTx(tx);
  resetForm();
  render();
});

function startEdit(id) {
  const t = transactions.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $("desc").value = t.desc;
  $("amount").value = t.amount;
  $("type").value = t.type;
  $("category").value = t.category;
  $("date").value = t.date;
  $("submitBtn").textContent = "Update";
  $("formTitle").textContent = "Edit Transaction";
  $("cancelEdit").hidden = false;
  $("form").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("cancelEdit").addEventListener("click", resetForm);

async function deleteTx(id) {
  if (!confirm("Is transaction ko delete karna hai?")) return;
  transactions = transactions.filter((t) => t.id !== id);
  await store.deleteTx(id);
  if (editingId === id) resetForm();
  render();
}

// ====================== Feature 4: Date range ======================
const inRange = (t) => {
  const from = $("from").value, to = $("to").value;
  return (!from || t.date >= from) && (!to || t.date <= to);
};
const visibleTx = () => transactions.filter(inRange);

let activePreset = "all";

function niceDate(iso) {
  return fromISO(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function monthBounds(offset) {
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const last = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  return [toISO(first), toISO(last)];
}

function periodLabel() {
  const from = $("from").value, to = $("to").value;
  if (!from && !to) return "Sab entries (All time)";
  if (from && to && from > to) return "⚠️ From date, To date se badi hai";
  const names = { month: "Is mahine", last: "Pichla mahina", 30: "Last 30 din" };
  const range = from && to ? `${niceDate(from)} – ${niceDate(to)}` : from ? `${niceDate(from)} se aage` : `${niceDate(to)} tak`;
  return names[activePreset] ? `${names[activePreset]} (${range})` : range;
}

function syncChips() {
  document.querySelectorAll("#presets .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.range === activePreset)
  );
}

function setPreset(key) {
  let from = "", to = "";
  if (key === "month") [from, to] = monthBounds(0);
  else if (key === "last") [from, to] = monthBounds(-1);
  else if (key === "30") {
    const d = new Date();
    to = toISO(d);
    d.setDate(d.getDate() - 29);
    from = toISO(d);
  }
  $("from").value = from;
  $("to").value = to;
  activePreset = key;
  syncChips();
  render();
}

function onCustomChange() {
  activePreset = !$("from").value && !$("to").value ? "all" : "custom";
  syncChips();
  render();
}

$("presets").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-range]");
  if (btn) setPreset(btn.dataset.range);
});
$("from").addEventListener("change", onCustomChange);
$("to").addEventListener("change", onCustomChange);
$("clearRange").addEventListener("click", () => setPreset("all"));

// ====================== Feature 2: Budget ======================
$("saveBudget").addEventListener("click", async () => {
  settings.budget = Math.max(0, parseFloat($("budget").value) || 0);
  await store.saveSettings();
  renderBudget();
});

function renderBudget() {
  $("budgetMonth").textContent = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const b = Number(settings.budget) || 0;
  const box = $("budgetStatus");
  if (!b) { box.hidden = true; return; }

  const month = todayISO().slice(0, 7);
  const spent = transactions
    .filter((t) => t.type === "expense" && t.date.startsWith(month))
    .reduce((s, t) => s + t.amount, 0);
  const pct = (spent / b) * 100;

  box.hidden = false;
  box.className = "budget-status " + (pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok");
  $("barFill").style.width = Math.min(pct, 100) + "%";
  $("budgetText").textContent =
    pct >= 100
      ? `⚠️ Budget cross ho gaya! ${fmt(spent)} / ${fmt(b)} (${fmt(spent - b)} zyada)`
      : pct >= 80
      ? `⚠️ Dhyan do: budget ka ${pct.toFixed(0)}% use ho gaya (${fmt(spent)} / ${fmt(b)})`
      : `${fmt(spent)} kharch hua, budget ${fmt(b)} (${pct.toFixed(0)}%)`;
}

// ====================== Render ======================
function renderSummary() {
  const sum = (arr, type) => arr.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);

  // Total balance: hamesha sab entries (date filter se alag)
  const total = sum(transactions, "income") - sum(transactions, "expense");
  $("total").textContent = fmt(total);
  $("total").className = total < 0 ? "neg" : "";

  // Cards: sirf chune hue period ke
  const list = visibleTx();
  const inc = sum(list, "income");
  const exp = sum(list, "expense");
  $("income").textContent = fmt(inc);
  $("expense").textContent = fmt(exp);
  $("balance").textContent = fmt(inc - exp);
  $("balance").className = inc - exp < 0 ? "neg" : "";

  const label = periodLabel();
  document.querySelectorAll(".ptag").forEach((el) => (el.textContent = label));
  $("rangeLabel").textContent = `Dikh raha hai: ${label} • ${list.length} entries`;
}

function getFiltered() {
  const q = $("search").value.toLowerCase();
  const type = $("filterType").value;
  return visibleTx()
    .filter((t) => type === "all" || t.type === type)
    .filter((t) => t.desc.toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function renderList() {
  const items = getFiltered();
  const ul = $("list");
  ul.innerHTML = "";
  $("empty").hidden = items.length > 0;
  items.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="info">
        <strong>${esc(t.desc)}${t.recurringId ? ' <span class="badge">auto</span>' : ""}</strong>
        <small>${esc(t.category)} • ${t.date}</small>
      </div>
      <div class="right">
        <span class="amt ${t.type}">${t.type === "income" ? "+" : "-"}${fmt(t.amount)}</span>
        <button class="small-btn edit" title="Edit">✎</button>
        <button class="small-btn del" title="Delete">✕</button>
      </div>`;
    li.querySelector(".edit").addEventListener("click", () => startEdit(t.id));
    li.querySelector(".del").addEventListener("click", () => deleteTx(t.id));
    ul.appendChild(li);
  });
}

let pieChart, barChart;
function renderCharts() {
  if (typeof Chart === "undefined") return; // offline
  const list = visibleTx();

  const byCat = {};
  list.filter((t) => t.type === "expense")
    .forEach((t) => (byCat[t.category] = (byCat[t.category] || 0) + t.amount));

  if (pieChart) pieChart.destroy();
  pieChart = new Chart($("pieChart"), {
    type: "doughnut",
    data: {
      labels: Object.keys(byCat),
      datasets: [{
        data: Object.values(byCat),
        backgroundColor: ["#4f46e5", "#16a34a", "#f59e0b", "#dc2626", "#0ea5e9", "#a855f7", "#14b8a6", "#64748b"],
      }],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });

  const months = {};
  list.forEach((t) => {
    const m = t.date.slice(0, 7);
    months[m] = months[m] || { income: 0, expense: 0 };
    months[m][t.type] += t.amount;
  });
  const labels = Object.keys(months).sort();

  if (barChart) barChart.destroy();
  barChart = new Chart($("barChart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Income", data: labels.map((m) => months[m].income), backgroundColor: "#16a34a" },
        { label: "Expense", data: labels.map((m) => months[m].expense), backgroundColor: "#dc2626" },
      ],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });
}

function render() {
  renderSummary();
  renderBudget();
  renderList();
  renderCharts();
  renderRecurring();
}

// ====================== Search / filter / CSV ======================
$("search").addEventListener("input", renderList);
$("filterType").addEventListener("change", renderList);

$("exportBtn").addEventListener("click", () => {
  const items = getFiltered();
  if (!items.length) return alert("Export karne ke liye data nahi hai.");
  const rows = [["Date", "Description", "Category", "Type", "Amount"]];
  items.forEach((t) =>
    rows.push([t.date, `"${t.desc.replace(/"/g, '""')}"`, t.category, t.type, t.amount])
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
  a.download = "transactions.csv";
  a.click();
});

// ====================== Theme ======================
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  $("themeBtn").textContent = dark ? "☀️" : "🌙";
  localStorage.setItem("dark", dark);
  if (typeof Chart !== "undefined") {
    Chart.defaults.color = dark ? "#e5e7eb" : "#374151";
    if (store) renderCharts();
  }
}
$("themeBtn").addEventListener("click", () => applyTheme(!document.body.classList.contains("dark")));

// ====================== Init ======================
CATEGORIES.forEach((c) => {
  $("category").add(new Option(c, c));
  $("rCategory").add(new Option(c, c));
});
$("date").value = todayISO();
$("rStart").value = todayISO();
applyTheme(localStorage.getItem("dark") === "true");

if (isConfigured) initFirebase();
else startGuest();
