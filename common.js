/* ============================================================
   common.js — লেনদেন খাতা (shared: login, per-user DB, drawer, sync)
   ============================================================ */
(function(){
'use strict';

/* ================== কনফিগ ================== */
const CFG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyZnIeZvuDSMK1JLPseCacLXDv7cpsm4pfjBsElm9SwBecj0oipx8O3aHS1PeA_FQvZ/exec',
  // Google Cloud Console → Credentials → OAuth client ID (Web) থেকে পাওয়া Client ID এখানে বসান।
  // খালি/PASTE_ থাকলে লগইন বন্ধ থাকবে এবং অ্যাপ আগের মতোই চলবে।
  GOOGLE_CLIENT_ID: 'PASTE_YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  // false = শুধু প্রথম লগইন করা (মালিক) অ্যাকাউন্ট বর্তমান Google Sheet-এর সাথে সিঙ্ক হবে।
  // Apps Script-এ per-user ব্যাকএন্ড করার পর true করুন।
  SYNC_NON_OWNERS: false,
  WEEK_START: 6 // 6 = শনিবার, 0 = রবিবার
};

const CATEGORIES = [
  ['Food','খাবার'], ['Gifts','উপহার'], ['Health/Medical','স্বাস্থ্য/চিকিৎসা'],
  ['Transportation','যাতায়াত'], ['Personal','ব্যক্তিগত'],
  ['Giving Loan','ঋণ দেওয়া'], ['Taking Loan','ঋণ নেওয়া'],
  ['Loan Repaid','ঋণ ফেরত পাওয়া'], ['Loan Paid','ঋণ পরিশোধ'],
  ['Credit Purchase','বাকিতে ক্রয়'], ['Credit Purchase Loan Paid','বাকি পরিশোধ'],
  ['Net & Electricity Bill','নেট ও বিদ্যুৎ বিল'], ['Travel','ভ্রমণ'],
  ['Donate','দান'], ['Savings','সঞ্চয়'], ['Other','অন্যান্য']
];
const CAT_BN = Object.fromEntries(CATEGORIES);

const LS_USER = 'ldk_user', LS_OWNER = 'ldk_owner';
const state = { user: null };
let db = null;
let gateResolve = null;

/* ================== হেল্পার ================== */
const bn = (n) => Number(n).toLocaleString('bn-BD');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ymd(v){
  const d = new Date(v);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function makeUid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'u' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
let toastTimer;
function toast(msg){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================== Auth (Google Identity Services) ================== */
const hasAuth = () => !!CFG.GOOGLE_CLIENT_ID && !CFG.GOOGLE_CLIENT_ID.includes('PASTE_');
function getUser(){ try{ return JSON.parse(localStorage.getItem(LS_USER) || 'null'); }catch(e){ return null; } }
function ownerSub(){ return localStorage.getItem(LS_OWNER) || ''; }
function isOwner(){ return !state.user || state.user.sub === ownerSub(); }

function decodeJwt(t){
  const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(b).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  return JSON.parse(json);
}
function loadGIS(){
  return new Promise((res, rej) => {
    if(window.google && google.accounts && google.accounts.id) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('gis'));
    document.head.appendChild(s);
  });
}
function onCredential(resp){
  try{
    const p = decodeJwt(resp.credential);
    const prev = getUser();
    if(!ownerSub()) localStorage.setItem(LS_OWNER, p.sub); // প্রথম অ্যাকাউন্টই বর্তমান ডেটার মালিক
    const user = { sub: p.sub, email: p.email || '', name: p.name || p.email || '', picture: p.picture || '', token: resp.credential, exp: p.exp || 0 };
    localStorage.setItem(LS_USER, JSON.stringify(user));
    state.user = user;
    if(gateResolve){
      const g = document.getElementById('loginGate'); if(g) g.remove();
      const r = gateResolve; gateResolve = null; r(user);
    } else if(prev && prev.sub !== user.sub){
      location.reload();
    }
  }catch(e){}
}
function showGate(){
  return new Promise(resolve => {
    gateResolve = resolve;
    const g = document.createElement('div');
    g.id = 'loginGate';
    g.innerHTML = `<div class="lg-card">
      <div class="lg-logo">৳</div>
      <h1>লেনদেন খাতা</h1>
      <p>Gmail / Google Account দিয়ে Login করুন</p>
      <div id="gBtn" class="lg-btn"></div>
      <div id="lgMsg" class="lg-msg"></div>
      <button type="button" id="lgRetry" class="lg-retry" style="display:none;">আবার চেষ্টা করুন</button>
      <small>প্রত্যেক ইউজারের ডেটা আলাদা থাকে</small>
    </div>`;
    document.body.appendChild(g);
    const init = () => {
      const msg = g.querySelector('#lgMsg'), retry = g.querySelector('#lgRetry');
      msg.textContent = ''; retry.style.display = 'none';
      loadGIS().then(() => {
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: false });
        google.accounts.id.renderButton(g.querySelector('#gBtn'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 280, locale: 'bn' });
      }).catch(() => {
        msg.textContent = 'প্রথমবার Login-এর জন্য ইন্টারনেট প্রয়োজন।';
        retry.style.display = '';
      });
    };
    g.querySelector('#lgRetry').addEventListener('click', init);
    init();
  });
}
// টোকেন মেয়াদ শেষের কাছাকাছি হলে অনলাইনে থাকলে নীরবে নতুন টোকেন আনার চেষ্টা
function refreshTokenSoon(){
  const u = state.user;
  if(!u || !navigator.onLine) return;
  if((u.exp || 0) * 1000 > Date.now() + 5 * 60 * 1000) return;
  loadGIS().then(() => {
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: true });
    google.accounts.id.prompt();
  }).catch(() => {});
}
function logout(){
  try{ if(window.google && google.accounts) google.accounts.id.disableAutoSelect(); }catch(e){}
  localStorage.removeItem(LS_USER);
  location.href = './index.html';
}

/* ================== IndexedDB (ইউজার অনুযায়ী আলাদা) ================== */
// মালিকের ডেটা আগের 'ledgerDB'-তেই থাকে (কিছুই মাইগ্রেট/মুছতে হয় না)
function dbName(){
  const u = state.user;
  if(!u || u.sub === ownerSub()) return 'ledgerDB';
  return 'ledgerDB_' + u.sub;
}
function openDB(name){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains('entries')){
        const store = d.createObjectStore('entries', {keyPath:'id', autoIncrement:true});
        store.createIndex('synced', 'synced');
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
const txStore = (mode = 'readonly') => db.transaction('entries', mode).objectStore('entries');
function addEntry(entry){
  return new Promise((res, rej) => {
    const r = txStore('readwrite').add(entry);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function getAllEntries(){
  return new Promise((res, rej) => {
    const r = txStore().getAll();
    r.onsuccess = () => res(r.result.sort((a, b) => (Date.parse(b.dateTime) || 0) - (Date.parse(a.dateTime) || 0)));
    r.onerror = () => rej(r.error);
  });
}
function markSynced(id){
  return new Promise((res, rej) => {
    const store = txStore('readwrite');
    const g = store.get(id);
    g.onsuccess = () => {
      const val = g.result;
      if(!val) return res();
      val.synced = true;
      const p = store.put(val);
      p.onsuccess = () => res();
      p.onerror = () => rej(p.error);
    };
    g.onerror = () => rej(g.error);
  });
}
function replaceSynced(rows){
  return new Promise((res, rej) => {
    const tx = db.transaction('entries', 'readwrite');
    const store = tx.objectStore('entries');
    const req = store.getAll();
    req.onsuccess = () => {
      req.result.forEach(e => { if(e.synced) store.delete(e.id); });
      rows.forEach(r => store.add({
        dateTime: r.dateTime || new Date(0).toISOString(),
        category: r.category || '',
        name: r.name || '',
        phone: r.phone || '',
        takeAmount: r.takeAmount === '' || r.takeAmount == null ? '' : String(r.takeAmount),
        giveAmount: r.giveAmount === '' || r.giveAmount == null ? '' : String(r.giveAmount),
        reason: r.reason || '',
        synced: true,
        fromSheet: true
      }));
    };
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

/* ================== Sync ================== */
function canSync(){
  if(!navigator.onLine || CFG.APPS_SCRIPT_URL.includes('PASTE_')) return false;
  if(hasAuth() && state.user && !isOwner() && !CFG.SYNC_NON_OWNERS) return false;
  return true;
}
const authQS = () => (hasAuth() && state.user) ? '&idToken=' + encodeURIComponent(state.user.token) : '';

let lockChain = Promise.resolve();
function withLock(fn){
  const p = lockChain.then(fn, fn);
  lockChain = p.catch(() => {});
  return p;
}
let lastPull = 0;
async function _syncAll(){
  const all = await getAllEntries();
  const pending = all.filter(x => !x.synced);
  if(api.onPending) api.onPending(pending.length);
  if(!canSync()) return;
  for(const entry of pending){
    try{
      const res = await fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({
          action: 'submitForm', ...entry, clientId: entry.uid || '',
          idToken: state.user ? state.user.token : '', userEmail: state.user ? state.user.email : ''
        })
      });
      const data = await res.json();
      if(data && data.success) await markSynced(entry.id);
    }catch(err){ break; }
  }
  if(api.onChange) await api.onChange();
}
async function _pullFromSheet(){
  if(!canSync()) return false;
  try{
    const res = await fetch(`${CFG.APPS_SCRIPT_URL}?action=getEntries${authQS()}`);
    const data = await res.json();
    if(!data || !data.success || !Array.isArray(data.entries)) return false;
    await replaceSynced(data.entries);
    lastPull = Date.now();
    if(api.onChange) await api.onChange();
    return true;
  }catch(err){ return false; }
}
const syncAll = () => withLock(_syncAll);
const pullFromSheet = () => withLock(_pullFromSheet);
async function syncAndPull(){ await syncAll(); await pullFromSheet(); }
function startAutoSync(){
  window.addEventListener('online', syncAndPull);
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && navigator.onLine && Date.now() - lastPull > 60000) syncAndPull();
  });
  if(navigator.onLine) syncAndPull();
}

/* ================== Hamburger Drawer ================== */
function buildDrawer(){
  if(document.getElementById('drawer')) return;
  const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const qs = new URLSearchParams(location.search);
  const curType = qs.get('type') === 'receivable' ? 'receivable' : 'payable';
  const curTab = qs.get('tab') || 'active';
  const items = [
    {ico:'🏠', label:'Home', file:'index.html', href:'./index.html'},
    {ico:'💰', label:'Need to Pay', file:'people.html', type:'payable', href:'./people.html?type=payable',
      subs:[['Pending','pending'],['Partially Paid','partial'],['Paid','paid'],['All','all']]},
    {ico:'💵', label:'Need to Receive', file:'people.html', type:'receivable', href:'./people.html?type=receivable',
      subs:[['Pending','pending'],['Partially Received','partial'],['Received','paid'],['All','all']]},
    {ico:'📁', label:'Recent Records', file:'records.html', href:'./records.html',
      subs:[['Date Filter','#filter'],['Search','#search'],['Transaction History','#history']]},
    {ico:'⚙️', label:'Settings', file:'settings.html', href:'./settings.html'}
  ];
  const u = state.user;
  let h = `<div class="dr-head">
    <div class="dr-avatar">${u && u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc((u && u.name ? u.name : '৳').trim().charAt(0).toUpperCase())}</div>
    <div class="dr-who"><b>${u ? esc(u.name) : 'লেনদেন খাতা'}</b><span>${u ? esc(u.email) : 'ব্যক্তিগত হিসাব'}</span></div>
  </div><nav class="dr-nav">`;
  items.forEach(it => {
    const here = file === it.file && (!it.type || it.type === curType);
    h += `<div class="dr-item${here ? ' active' : ''}${here && it.subs ? ' open' : ''}">
      <div class="dr-row"><a class="dr-link" href="${it.href}"><span class="dr-ico">${it.ico}</span>${it.label}</a>${it.subs ? '<button type="button" class="dr-chev" aria-label="সাবমেনু">▾</button>' : ''}</div>`;
    if(it.subs){
      h += '<div class="dr-subs">' + it.subs.map(([l, v]) => {
        const href = it.file === 'records.html' ? './records.html' + v : './people.html?type=' + it.type + '&tab=' + v;
        const act = here && (it.file === 'people.html' ? curTab === v : location.hash === v);
        return `<a class="dr-sub${act ? ' active' : ''}" href="${href}">${l}</a>`;
      }).join('') + '</div>';
    }
    h += '</div>';
  });
  h += '</nav>';
  if(hasAuth() && u) h += '<div class="dr-foot"><button type="button" id="drLogout">↪ Logout</button></div>';

  const ov = document.createElement('div'); ov.id = 'drawerOverlay';
  const dr = document.createElement('aside'); dr.id = 'drawer'; dr.innerHTML = h;
  document.body.appendChild(ov); document.body.appendChild(dr);

  const close = () => document.body.classList.remove('drawer-open');
  ov.addEventListener('click', close);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') close(); });
  dr.querySelectorAll('.dr-chev').forEach(b => b.addEventListener('click', () => b.closest('.dr-item').classList.toggle('open')));
  dr.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setTimeout(close, 60)));
  const lo = dr.querySelector('#drLogout'); if(lo) lo.addEventListener('click', logout);
}
function initMenu(){
  buildDrawer();
  document.querySelectorAll('.menu-btn').forEach(b => b.addEventListener('click', () => document.body.classList.add('drawer-open')));
}

/* ================== Boot ================== */
let bootP = null;
function boot(){
  if(bootP) return bootP;
  bootP = (async () => {
    if(hasAuth()){
      let u = getUser();
      if(!u) u = await showGate();
      state.user = u;
      refreshTokenSoon();
    }
    await openDB(dbName());
    initMenu();
    return state.user;
  })();
  return bootP;
}

/* ================== Export ================== */
const api = {
  CFG, CATEGORIES, CAT_BN, bn, esc, ymd, makeUid, toast,
  boot, hasAuth, getUser: () => state.user, isOwner, logout,
  addEntry, getAllEntries, markSynced, syncAll, pullFromSheet, syncAndPull, startAutoSync,
  canSync, authQS, getLastPull: () => lastPull,
  onChange: null, onPending: null
};
window.LDK = api;
})();
