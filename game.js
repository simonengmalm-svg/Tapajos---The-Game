// ==================== TAPAJOS – GAME LOGIC ====================

// ---- Version ----
const GAME_VERSION = '1.1';

// ------- Starta spelet (splash) -------
function startGame() {
  const s = document.getElementById('splash'); // vissa html-versioner har "startScreen" – hanteras i showAppHideSplash()
  const app = document.getElementById('appWrap');
  if (s) s.style.display = 'none';
  if (app) app.style.display = 'grid';
}

// --------- Data & helpers ---------
const fmt = n => new Intl.NumberFormat('sv-SE').format(Math.round(n));
const pick = a => a[Math.floor(Math.random() * a.length)];
const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : ('id-' + Math.random().toString(36).slice(2));

const CONDITIONS = ['ny', 'sliten', 'forfallen'];

// Hyresmodell: baseras på kvm * kr/kvm/år => normaliserat till månadsnivå per lgh.
// maintUnit = drift/mån/lgh. location-multipliers ger liten centrumpremium / förortsavdrag.
const TYPES = {
  landsh: { name: 'Landshövding', sqmPerUnit: 55, rentPerSqmYr: 1400, maintUnit: 2000, price: [8000000, 15000000], units: [6, 18], cls: 'T-landsh', centralMult: 1.06, suburbMult: 0.98 },
  funkis: { name: 'Funkis',       sqmPerUnit: 62, rentPerSqmYr: 1450, maintUnit: 2300, price: [12000000, 20000000], units: [8, 24], cls: 'T-funkis',  centralMult: 1.08, suburbMult: 0.97 },
  miljon: { name: 'Miljonprogram',sqmPerUnit: 70, rentPerSqmYr: 1350, maintUnit: 2600, price: [25000000, 50000000], units: [24, 80], cls: 'T-miljon',  centralMult: 1.03, suburbMult: 0.96 },
  nyprod: { name: 'Nyproduktion', sqmPerUnit: 70, rentPerSqmYr: 1600, maintUnit: 2900, price: [35000000, 80000000], units: [20, 60], cls: 'T-nyprod',  centralMult: 1.10, suburbMult: 0.98 },
  gamlastan:{name:'Gamla stan',   sqmPerUnit: 52, rentPerSqmYr: 1550, maintUnit: 2700, price: [15000000, 30000000], units: [6, 20],  cls: 'T-gamlastan', centralMult: 1.12, suburbMult: 1.00 }
};

const ANEKD = [
  'Gamla brev hittades på vinden – hyresgästerna ordnar utställning.',
  'En pensionerad snickare i huset hjälper grannar med småfix.',
  'Gården fick egen bokbytarlåda – oväntad succé.',
  'Huskatten “Sotis” patrullerar källargången.',
  'Whatsapp-gruppen löste tvättstugetider utan bråk i en månad (!).',
  'Granne spelade dragspel på gårdsfesten – blev tradition.'
];

let state = {
  cash: 10000000,
  month: 1,
  rate: 0.03,
  market: 1.00,
  capRate: 0.045,
  owned: [],
  loans: [],
  pendingCash: []
};

function currentYear() { return state.month; }
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function condFactor(c) { return c === 'ny' ? 1.0 : c === 'sliten' ? 0.85 : 0.7; }
function condMaintMult(c) { return c === 'forfallen' ? 1.3 : c === 'sliten' ? 1.0 : 0.8; }

function queueCash(amount, label) {
  state.pendingCash.push({
    amount: Math.max(0, Math.round(amount)),
    year: state.month + 1,    // betalas ut nästa år
    label: label || 'Likvid'
  });
}

function priceOf(tid, cond, central) {
  const [min, max] = TYPES[tid].price;
  const condF = cond === 'ny' ? 1.0 : cond === 'sliten' ? 0.85 : 0.7;
  const centF = central ? 1.2 : 0.9;
  const base = min + Math.random() * (max - min);
  return Math.round(base * condF * centF * state.market);
}

function valuation(b) {
  const base = (b.basePrice || priceOf(b.tid, b.cond, b.central));
  const fCond = condFactor(b.cond) / condFactor(b.baseCond || b.cond);
  const fMkt  = state.market / (b.baseMarket || 1.0);
  const baseVal = Math.round(base * fCond * fMkt * (1 + (b.valueBoost || 0)));

  const t = TYPES[b.tid];
  const units = b.units || b.baseUnits || 10;
  const condMult = condMaintMult(b.cond);

  // Energioptimering -> värde via årlig besparing / cap rate
  const baseMaintAnnual   = t.maintUnit * units * condMult * 12;
  const withEnergyAnnual  = baseMaintAnnual * (b.maintMult || 1.0);
  const savingsAnnual     = Math.max(0, baseMaintAnnual - withEnergyAnnual);
  const energyUpliftValue = Math.round(savingsAnnual / (state.capRate || 0.045));

  // Extra lägenheter -> kassaflödesvärde
  const baseUnits   = b.baseUnits ?? units;
  const extraUnits  = Math.max(0, units - baseUnits);
  const condF       = b.cond === 'ny' ? 1 : b.cond === 'sliten' ? 0.85 : 0.7;
  const basePerUnit = baseMonthlyPerUnit(t);
  const locF        = b.central ? (t.centralMult || 1.06) : (t.suburbMult || 0.98);
  const annualNetPerUnit =
    (basePerUnit * (1 + (b.rentBoost || 0)) * condF * locF * 12)
    - (t.maintUnit * (b.maintMult || 1) * condMult * 12);
  const unitUpliftValue = Math.round(Math.max(0, annualNetPerUnit * extraUnits) / (state.capRate || 0.045));

  return baseVal + energyUpliftValue + unitUpliftValue;
}

function note(msg) { const el = document.getElementById('notes'); if (el) el.textContent = msg; }

// --------- Nöjdhet & status ---------
function initSocial(b) {
  b.sat = Math.floor(60 + (b.cond === 'ny' ? +15 : b.cond === 'sliten' ? -10 : -20) + (b.central ? +5 : 0));
  b.consent = Math.max(0, Math.min(100, Math.floor(b.sat - 10 + (b.cond === 'ny' ? +10 : 0))));
  b.status = statusOf(b);

  b.maintMult = 1.0;
  b.rentBoost = 0;
  b.valueBoost = 0;
  b.project = null;

  b.anekdot = pick(ANEKD);
  b.nextRenovTick = 0;
  b.converting = null;

  // Årsräknare
  b.eventYear = currentYear();
  b.eventsUsed = 0;
  b.eventsCap = (Math.random() < 0.35 ? 2 : 1);

  // Energi
  b.energyUpgrades = 0;
  b.energyUpgradesMax = 3;

  // --- Förhandlingslås per år ---
  b.negYear = currentYear();
  b.negUsed = false;
}

function statusOf(b) {
  if (b.consent >= 70 && b.sat >= 70 && b.cond === 'ny') return 'Klar för ombildning';
  if (b.sat < 40) return 'Oro i föreningen';
  if (b.sat < 60) return 'Skört läge';
  return 'Stabilt';
}
function condScore(b) { return b.cond === 'ny' ? 100 : b.cond === 'sliten' ? 60 : 30; }

// --------- DOM refs ---------
const cashEl   = document.getElementById('cash');
const debtTopEl= document.getElementById('debtTop');
const marketEl = document.getElementById('market');
const rateEl   = document.getElementById('rate');
const pnlEl    = document.getElementById('pnl');
const rentEl   = document.getElementById('rent');
const maintEl  = document.getElementById('maint');
const propsEl  = document.getElementById('props');

const marketModal = document.getElementById('marketModal');
const offersEl    = document.getElementById('offers');

const negModal = document.getElementById('negModal');
const adj      = document.getElementById('adj');
const comp     = document.getElementById('comp');
const adjLbl   = document.getElementById('adjLbl');
const compLbl  = document.getElementById('compLbl');
const negProb  = document.getElementById('negProb');

const eventModal = document.getElementById('eventModal');
const evTitle    = document.getElementById('evTitle');
const evText     = document.getElementById('evText');
const evActions  = document.getElementById('evActions');
const evPixel    = document.getElementById('evPixel');

let negIdx = null;

function barFillClass(v) { return v >= 70 ? 'good' : v >= 40 ? 'mid' : 'bad'; }

// --------- Kostnader ---------
function renovateCost(b) { const t = TYPES[b.tid]; return Math.round(t.maintUnit * (b.units || b.baseUnits || 10) * 6); }
function careCost()      { return 25000; }
function energyCost(b)   { const t = TYPES[b.tid]; return Math.round(150000 * ((b.units || b.baseUnits || 10) / 20)); }
function atticCost(b)    { const units = b.units || b.baseUnits || 10; return Math.round((1800000 + 50000 * units) * (b.central ? 1.15 : 1.0)); }
function amortCost()     { return 200000; }
function canAfford(cost) { return state.cash >= cost; }
function labelWithCost(label, cost) { return `${label} (${fmt(cost)} kr)`; }
function setAffordStyle(btn, ok) { btn.style.color = ok ? 'var(--good)' : 'var(--cant)'; }

// --------- Beräkningar ---------
function baseMonthlyPerUnit(t) {
  if (typeof t.rentUnit === 'number' && t.rentUnit > 0) return t.rentUnit;
  const sqm = t.sqmPerUnit || 65;
  const krYr = t.rentPerSqmYr || 1400;
  return Math.round((sqm * krYr) / 12);
}

function effectiveRent(b) { // per månad totalt för huset
  const t = TYPES[b.tid];
  const units = (b.units || b.baseUnits || 10);
  const basePerUnit = baseMonthlyPerUnit(t);
  const condF = b.cond === 'ny' ? 1 : b.cond === 'sliten' ? 0.85 : 0.7;
  const locF  = b.central ? (t.centralMult || 1.06) : (t.suburbMult || 0.98);
  const boostF = 1 + (b.rentBoost || 0);
  return Math.round(basePerUnit * condF * locF * boostF * units);
}

function effectiveMaint(b) { // per månad totalt för huset
  const t = TYPES[b.tid];
  const mult = (b.maintMult || 1) * (b.cond === 'forfallen' ? 1.3 : b.cond === 'sliten' ? 1 : 0.8);
  return Math.round(t.maintUnit * mult * (b.units || b.baseUnits || 10));
}

// --------- Render fastigheter ---------
function renderOwned() {
  if (!propsEl) return;
  propsEl.innerHTML = '';
  if (state.owned.length === 0) {
    propsEl.innerHTML = '<div class="meta">Du äger inga fastigheter ännu. Klicka på “Fastighetsmarknad”.</div>';
    return;
  }
  state.owned.forEach((b, idx) => {
    const t = TYPES[b.tid];
    const icon = document.createElement('div'); icon.className = `icon ${t.cls} C-${b.cond}`;
    const card = document.createElement('div'); card.className = 'card';
    const text = document.createElement('div');
    const condTxt = b.cond === 'forfallen' ? 'förfallen' : b.cond;
    const value = valuation(b);

    const barSat  = document.createElement('div'); barSat.className = 'bar';
    const f1 = document.createElement('div'); f1.className = 'fill ' + barFillClass(b.sat); f1.style.width = b.sat + '%'; barSat.appendChild(f1);

    const barCond = document.createElement('div'); barCond.className = 'bar';
    const f2 = document.createElement('div'); const cs = condScore(b); f2.className = 'fill ' + barFillClass(cs); f2.style.width = cs + '%'; barCond.appendChild(f2);

    const chips = document.createElement('div'); chips.className = 'chips';
    const chip  = document.createElement('span'); chip.className = 'chip ' + (b.status === 'Klar för ombildning' ? 'status-ok' : b.status.includes('Oro') ? 'status-bad' : 'status-warn'); chip.textContent = b.status; chips.appendChild(chip);
    if (b.project)    { const c = document.createElement('span'); c.className = 'chip';        c.textContent = `Projekt: ${b.project.name} (${b.project.duration} kvar)`; chips.appendChild(c); }
    if (b.converting) { const c = document.createElement('span'); c.className = 'chip status-ok'; c.textContent = `Ombildning pågår (${b.converting.duration} kvar)`; chips.appendChild(c); }
    if (b.loanId)     { const c = document.createElement('span'); c.className = 'chip'; const loan = state.loans.find(l => l.id === b.loanId); c.textContent = `Lån: ${fmt(loan?.balance || 0)} kr`; chips.appendChild(c); }

    text.innerHTML =
      `<div class="row"><b>${t.name}</b> ${b.central ? '• Centralt' : '• Förort'} • Lgh: <b>${b.units || b.baseUnits || '? '}</b></div>` +
      `<div class="meta">Skick: ${condTxt} • ${b.anekdot || ''}</div>` +
      `<div class="meta">Hyra/år ~ ${fmt(effectiveRent(b) * 12)} kr • Drift/år ~ ${fmt(effectiveMaint(b) * 12)} kr</div>` +
      `<div class="price">Värde ~ ${fmt(value)} kr</div>` +
      (b.nextRenovTick > state.month ? `<div class="meta">Renovering möjlig igen: år ${b.nextRenovTick}</div>` : '') +
      `<div class="meta">Gårdsevent: ${b.eventsUsed}/${b.eventsCap} i år • Energioptimering: ${b.energyUpgrades}/${b.energyUpgradesMax}</div>`;

    // Knappar
    const actions  = document.createElement('div'); actions.className = 'actions';
    const ren      = document.createElement('button'); ren.className = 'btn mini';
    const neg      = document.createElement('button'); neg.className = 'btn mini alt';
    const brf      = document.createElement('button'); brf.className = 'btn mini';
    const sell     = document.createElement('button'); sell.className = 'btn mini';
    const care     = document.createElement('button'); care.className = 'btn mini';
    const proj     = document.createElement('button'); proj.className = 'btn mini';
    const opt      = document.createElement('button'); opt.className = 'btn mini';
    const amortBtn = document.createElement('button'); amortBtn.className = 'btn mini';

    const rc = renovateCost(b); ren.textContent   = labelWithCost('Renovera', rc); setAffordStyle(ren,   canAfford(rc));
    const cc = careCost(b);     care.textContent  = labelWithCost('Gårdsevent', cc); setAffordStyle(care, canAfford(cc)); if (b.eventsUsed >= b.eventsCap) { care.style.color = 'var(--disabled)'; care.title = 'Årstak uppnått'; }
    const ec = energyCost(b);   opt.textContent   = labelWithCost('Energiopt.', ec); setAffordStyle(opt,  canAfford(ec)); if (b.energyUpgrades >= b.energyUpgradesMax) { opt.style.color = 'var(--disabled)'; opt.title = 'Max energioptimeringar uppnått'; }
    const ac = atticCost(b);    proj.textContent  = labelWithCost('Vindskonv.', ac); setAffordStyle(proj, canAfford(ac)); if (b.project) { proj.style.color = 'var(--disabled)'; proj.title = 'Projekt pågår'; }
    const amc = amortCost();    amortBtn.textContent = labelWithCost('Amortera', amc); setAffordStyle(amortBtn, canAfford(amc)); if (!b.loanId) { amortBtn.style.color = 'var(--disabled)'; amortBtn.title = 'Inget lån kopplat'; }

    neg.textContent = 'Förhandla'; brf.textContent = 'Ombilda BRF'; sell.textContent = 'Sälj';

    ren.onclick      = () => doRenovate(idx);
    neg.onclick      = () => openNegotiation(idx);
    brf.onclick      = () => startBRF(idx);
    sell.onclick     = () => doSell(idx);
    care.onclick     = () => doCare(idx);
    proj.onclick     = () => doAttic(idx);
    opt.onclick      = () => doEnergy(idx);
    amortBtn.onclick = () => extraAmort(idx, 200000);

    actions.append(ren, neg, brf, sell, care, proj, opt, amortBtn);

    card.append(icon, text, chips, document.createElement('div'));
    card.appendChild(document.createTextNode('Nöjdhet')); card.appendChild(barSat);
    card.appendChild(document.createTextNode('Skick'));   card.appendChild(barCond);
    card.append(actions);
    propsEl.appendChild(card);
  });
}

// --------- Marknad (4 fasta per år) ---------
state.marketPool = [];     // årets utbud
state.marketYear = 0;      // vilket år utbudet skapades

function makeOffer(tid, cond, central){
  const price = priceOf(tid, cond, central);
  const [umin, umax] = TYPES[tid].units;
  const units = randInt(umin, umax);
  return { id: uuid(), tid, cond, central, price, units };
}

function generateYearMarket(n = 4){
  const keys = Object.keys(TYPES);
  const arr = [];
  for (let i = 0; i < n; i++){
    const tid = pick(keys);
    const cond = pick(CONDITIONS);
    const central = Math.random() < 0.5;
    arr.push(makeOffer(tid, cond, central));
  }
  // sortera billigast först för läsbarhet
  state.marketPool = arr.sort((a,b)=> a.price - b.price);
  state.marketYear = currentYear();
}

function ensureMarketForThisYear(){
  if (state.marketYear !== currentYear()){
    generateYearMarket(4);
  }
}

function removeOfferById(id){
  state.marketPool = state.marketPool.filter(o => o.id !== id);
}

function renderMarket(){
  if (!offersEl) return;
  offersEl.innerHTML = '';

  if (!state.marketPool.length){
    offersEl.innerHTML =
      `<div class="meta">Inga fler objekt till salu i år. Tryck “Nästa år” för nytt utbud.</div>`;
  } else {
    state.marketPool.forEach(off => {
      const t = TYPES[off.tid];

      const box = document.createElement('div'); box.className = 'offer';
      const ic  = document.createElement('div'); ic.className = `small ${t.cls} C-${off.cond}`;

      const left = document.createElement('div');
      left.innerHTML =
        `<div><b>${t.name}</b> ${off.central ? '• Centralt' : '• Förort'} • Lgh: <b>${off.units}</b></div>
         <div class="meta">Skick: ${off.cond === 'forfallen' ? 'förfallen' : off.cond}</div>
         <div class="price">Pris: ${fmt(off.price)} kr</div>`;

      // Köp kontant
      const buyCash = document.createElement('button');
      buyCash.className = 'btn mini';
      buyCash.textContent = 'Köp kontant';
      buyCash.onclick = () => {
        if (state.cash < off.price){ alert('Otillräcklig kassa'); return; }
        state.cash -= off.price;
        const b = { ...off }; initSocial(b);
        b.basePrice  = off.price;
        b.baseCond   = off.cond;
        b.baseMarket = state.market;
        b.baseUnits  = off.units;
        state.owned.push(b);
        removeOfferById(off.id);
        updateTop(); renderOwned(); renderMarket(); // lämna fönstret öppet
      };

      // Köp med lån
      const buyLoan = document.createElement('button');
      buyLoan.className = 'btn mini alt';
      buyLoan.textContent = 'Köp med lån';
      buyLoan.onclick = () => {
        const downPct = 0.30;
        const down = Math.round(off.price * downPct);
        if (state.cash < down){ alert('Behöver kontantinsats: ' + fmt(down) + ' kr'); return; }
        state.cash -= down;
        const loan = createLoan(off.price - down, off);
        const b = { ...off, loanId: loan.id }; initSocial(b);
        b.basePrice  = off.price;
        b.baseCond   = off.cond;
        b.baseMarket = state.market;
        b.baseUnits  = off.units;
        state.owned.push(b);
        removeOfferById(off.id);
        updateTop(); renderOwned(); renderMarket();
      };

      const right = document.createElement('div');
      right.style.display = 'grid';
      right.style.gap = '6px';
      right.appendChild(buyCash);
      right.appendChild(buyLoan);

      box.append(ic, left, right);
      offersEl.appendChild(box);
    });
  }

  if (marketModal) marketModal.style.display = 'flex';
}

function openMarket(){
  ensureMarketForThisYear();
  renderMarket();
}

function closeMarket(){
  if (marketModal) marketModal.style.display = 'none';
}

// --------- Actions ---------
function ensureYearCounters(b) {
  const cy = currentYear();
  if (b.eventYear !== cy) {
    b.eventYear = cy;
    b.eventsUsed = 0;
    b.eventsCap = (Math.random() < 0.35 ? 2 : 1);
  }
  // nollställ förhandlingslås vid nytt år
  if (b.negYear !== cy) {
    b.negYear = cy;
    b.negUsed = false;
  }
}

function doRenovate(idx) {
  const b = state.owned[idx];
  if (b.nextRenovTick && state.month < b.nextRenovTick) { alert('Renovering redan utförd denna årscykel.'); return; }
  const cost = renovateCost(b); if (state.cash < cost) { alert('Otillräcklig kassa för renovering'); return; }
  state.cash -= cost;
  if (b.cond === 'forfallen') b.cond = 'sliten'; else if (b.cond === 'sliten') b.cond = 'ny';
  b.sat = Math.min(100, b.sat + 8); b.consent = Math.min(100, b.consent + 5); b.status = statusOf(b);
  b.nextRenovTick = state.month + 1;
  updateTop(); renderOwned(); note('Renovering genomförd.');
}

function doCare(idx) {
  const b = state.owned[idx]; ensureYearCounters(b);
  if (b.eventsUsed >= b.eventsCap) { alert('Gårdsevent-taket för i år är nått.'); return; }
  const cost = careCost(b); if (state.cash < cost) { alert('Otillräcklig kassa.'); return; }
  state.cash -= cost; b.sat = Math.min(100, b.sat + 12); b.consent = Math.min(100, b.consent + 5); b.eventsUsed++;
  b.status = statusOf(b); updateTop(); renderOwned(); note('Gårdsevent genomfört.');
}

function doEnergy(idx) {
  const b = state.owned[idx];
  if (b.energyUpgrades >= b.energyUpgradesMax) { alert('Max antal energioptimeringar uppnått.'); return; }
  const cost = energyCost(b); if (state.cash < cost) { alert('Otillräcklig kassa.'); return; }
  state.cash -= cost; b.maintMult = Math.max(0.75, (b.maintMult || 1) * 0.92); b.energyUpgrades++;
  b.sat = Math.min(100, b.sat + 2); b.status = statusOf(b);
  updateTop(); renderOwned(); note('Energioptimering installerad.');
}

function doAttic(idx) {
  const b = state.owned[idx];
  if (b.project) { alert('Ett projekt pågår redan.'); return; }
  const cost = atticCost(b); if (state.cash < cost) { alert('Otillräcklig kassa.'); return; }
  state.cash -= cost;
  const units = b.units || b.baseUnits || 10;
  const addUnits = Math.min(8, Math.max(2, Math.round(units * 0.15)));
  b.project = { name: 'Vindskonvertering', duration: 2, addUnits };
  b.sat = Math.max(0, b.sat - 4);
  updateTop(); renderOwned(); note('Vindskonvertering startad.');
}

function startBRF(idx) {
  const b = state.owned[idx];
  if (b.converting) { alert('Ombildning pågår redan.'); return; }
  if (b.project)    { alert('Projekt pågår. Slutför projektet före ombildning.'); return; }
  if (!(b.consent >= 70 && b.sat >= 70 && b.cond === 'ny')) { alert('Krav BRF: Nöjdhet ≥70, Samtycke ≥70, Skick: Ny.'); return; }
  b.converting = { duration: 1 }; renderOwned(); note('Ombildning startad. Tillträde nästa år – likvid vid tillträde.');
}

function completeBRF(i, b) {
  const premium = 1.35;
  let proceeds = Math.round(valuation(b) * premium);
  proceeds = settleLoanOnExit(b, proceeds);
  state.cash += proceeds;
  if (b.loanId) { state.loans = state.loans.filter(l => l.id !== b.loanId); }
  state.owned.splice(i, 1);
  note('Ombildning klar. Likvid insatt.');
}

function doSell(idx) {
  const b = state.owned[idx];
  if (b.project) { alert('Projekt pågår. Kan inte sälja just nu.'); return; }
  let proceeds = Math.round(valuation(b) * 0.95);
  proceeds = settleLoanOnExit(b, proceeds);
  state.cash += proceeds;
  if (b.loanId) { state.loans = state.loans.filter(l => l.id !== b.loanId); }
  state.owned.splice(idx, 1);
  updateTop(); renderOwned(); note('Fastighet såld.');
}

// --------- Förhandling ---------

// Bind förhandlingsreglagen exakt en gång
function bindNegControlsOnce() {
  if (adj && !adj.dataset.bound) {
    adj.addEventListener('input', updateNegProb);
    adj.addEventListener('change', updateNegProb);
    adj.dataset.bound = '1';
  }
  if (comp && !comp.dataset.bound) {
    comp.addEventListener('input', updateNegProb);
    comp.addEventListener('change', updateNegProb);
    comp.dataset.bound = '1';
  }
}

function openNegotiation(idx) {
  negIdx = idx;
  const b = state.owned[idx];
  if (!b) { alert('Ingen fastighet vald.'); return; }

  // Respektera "max 1 gång per år"
  ensureYearCounters(b);
  if (b.negUsed) { alert('Förhandling är redan gjord för denna fastighet i år.'); return; }

  const titleEl = document.getElementById('negTitle');
  if (titleEl) {
    titleEl.textContent = `Förhandling — ${TYPES[b.tid].name} ${b.central ? '(Centralt)' : '(Förort)'} • Lgh: ${b.units || b.baseUnits || '? '}`;
  }

  if (adj) adj.value = 0;
  if (comp) comp.value = 0;

  bindNegControlsOnce();
  updateNegProb();

  if (negModal) negModal.style.display = 'flex';
}

function updateNegProb() {
  if (negIdx == null) { if (negProb) negProb.textContent = '—%'; return 0; }
  const b = state.owned[negIdx]; if (!b) { if (negProb) negProb.textContent = '—%'; return 0; }

  const a = Number((adj && adj.value) || 0);
  const c = Number((comp && comp.value) || 0);

  if (adjLbl)  adjLbl.textContent  = a;
  if (compLbl) compLbl.textContent = fmt(c);

  const condF = b.cond === 'ny' ? +10 : b.cond === 'sliten' ? -10 : -20;
  let p = 40 + (b.sat - 50) / 2 + condF;
  p -= Math.max(0, a - 2) * 3; // större höjning -> svårare
  p += c / 1500;               // högre komp -> lättare
  p = Math.max(5, Math.min(95, Math.round(p)));

  if (negProb) negProb.textContent = p + '%';
  return p;
}

function runNegotiation() {
  if (negIdx == null) return;
  const b = state.owned[negIdx];

  // Säkerställ att vi inte kan köra flera gånger i samma år
  ensureYearCounters(b);
  if (b.negUsed) { alert('Förhandling är redan gjord för denna fastighet i år.'); return; }

  const a = Number((adj && adj.value) || 0);
  const c = Number((comp && comp.value) || 0);
  const p = updateNegProb();

  const win = Math.random() * 100 < p;
  if (win) {
    b.rentBoost = (b.rentBoost || 0) + (a / 100); // a% -> 0.00–?
    state.cash -= Math.round(c * (b.units || b.baseUnits || 10));
    b.sat = Math.min(100, b.sat + 8);
    b.consent = Math.min(100, b.consent + 10);
    note('Avtal klart. Hyresnivå uppdaterad.');
  } else {
    b.sat = Math.max(0, b.sat - 8);
    b.consent = Math.max(0, b.consent - 6);
    note('Förhandling misslyckades. Nöjdhet sjönk.');
  }

  // Lås för resten av året
  b.negUsed = true;
  b.negYear = currentYear();

  b.status = statusOf(b);
  renderOwned(); updateTop();
  if (negModal) negModal.style.display = 'none';
}

// --------- Lån ---------
function perPeriodRate() { return state.rate; } // årsränta, eftersom 1 period = 1 år
function termPeriods() { return 30; }          // 30 år
function annuityPayment(P, r, n) { if (r <= 0) return Math.round(P / Math.max(1, n)); const a = P * r / (1 - Math.pow(1 + r, -n)); return Math.round(a); }
function createLoan(principal, off) {
  const r = perPeriodRate() + 0.015; // liten påslag över styrräntan
  const n = termPeriods();
  const pmt = annuityPayment(principal, r, n); // årlig betalning
  const loan = { id: uuid(), principal, balance: principal, rate: r, term: n, payment: pmt, propHint: TYPES[off.tid].name + (off.central ? ' (C)' : ' (F)') };
  state.loans.push(loan); return loan;
}
function totalDebt() { return state.loans.reduce((s, l) => s + l.balance, 0); }
function extraAmort(idx, amt = 200000) {
  const b = state.owned[idx]; if (!b?.loanId) { alert('Inget lån kopplat.'); return; }
  const loan = state.loans.find(l => l.id === b.loanId); if (!loan) { alert('Lån saknas.'); return; }
  if (state.cash < amt) { alert('Otillräcklig kassa.'); return; }
  state.cash -= amt; loan.balance = Math.max(0, loan.balance - amt);
  note('Amorterade ' + fmt(amt) + ' kr.'); renderOwned(); updateTop();
}
function settleLoanOnExit(b, proceeds) {
  if (!b.loanId) return proceeds;
  const loan = state.loans.find(l => l.id === b.loanId); if (!loan) return proceeds;
  const payoff = loan.balance; loan.balance = 0;
  return Math.max(0, proceeds - payoff);
}

// --------- Omvärldshändelser ---------
const EVENTS = [
  { id: 'water', name: 'Vattenläcka', pixel: 'ev-water', prob: 0.18,
    pick: (st) => st.owned.length ? randInt(0, st.owned.length - 1) : null,
    text: (b) => `Vattenläcka i ${TYPES[b.tid].name}. Risk för följdskador och missnöje.`,
    actions: (idx) => {
      const b = state.owned[idx]; const cost = Math.round(60000 * ((b.units || b.baseUnits || 10) / 10));
      return [
        { label: `Åtgärda nu (${fmt(cost)} kr)`, run: () => { if (state.cash < cost) { alert('Otillräcklig kassa.'); return; } state.cash -= cost; b.sat = Math.min(100, b.sat + 4); b.status = statusOf(b); note('Läckan åtgärdad — mindre påverkan.'); closeEvent(); renderOwned(); updateTop(); } },
        { label: 'Vänta (risk)', run: () => { if (Math.random() < 0.6) { if (b.cond === 'ny') b.cond = 'sliten'; else b.cond = 'forfallen'; b.sat = Math.max(0, b.sat - 10); note('Skadorna förvärrades — skick nedgraderat.'); } else { note('Tur! Ingen större skada denna gång.'); } closeEvent(); renderOwned(); updateTop(); } }
      ];
    }
  },
  { id: 'union', name: 'Hyresgästföreningsärende', pixel: 'ev-union', prob: 0.14,
    pick: (st) => st.owned.length ? randInt(0, st.owned.length - 1) : null,
    text: (b) => `Missnöjda hyresgäster driver ärende i ${TYPES[b.tid].name}.`,
    actions: (idx) => {
      const b = state.owned[idx]; const comp = 5000;
      return [
        { label: `Kompensation (${fmt(comp)} kr/lgh)`, run: () => { const tot = Math.round(comp * (b.units || b.baseUnits || 10)); if (state.cash < tot) { alert('Otillräcklig kassa.'); return; } state.cash -= tot; b.sat = Math.min(100, b.sat + 10); b.consent = Math.min(100, b.consent + 6); note('Konflikten dämpad med kompensation.'); closeEvent(); renderOwned(); updateTop(); } },
        { label: 'Ta förhandling', run: () => { closeEvent(); openNegotiation(idx); } }
      ];
    }
  },
  { id: 'market', name: 'Marknadschock', pixel: 'ev-market', prob: 0.12,
    pick: () => null,
    text: () => 'Rörelser på kapitalmarknaden påverkar värderingar.',
    actions: () => { const d = (Math.random() < 0.5 ? -1 : +1) * (0.02 + Math.random() * 0.04); return [{ label: (d > 0 ? `Boom +${(d * 100).toFixed(1)}%` : `Nedgång ${(d * 100).toFixed(1)}%`), run: () => { state.market = Math.max(0.80, Math.min(1.35, state.market * (1 + d))); note('Marknad nu: ' + state.market.toFixed(2) + '×'); closeEvent(); renderOwned(); updateTop(); } }]; }
  },
  { id: 'press', name: 'Positiv press', pixel: 'ev-press', prob: 0.12,
    pick: (st) => st.owned.length ? randInt(0, st.owned.length - 1) : null,
    text: (b) => `Lokaltidningen hyllar ${TYPES[b.tid].name}.`,
    actions: (idx) => { const b = state.owned[idx]; return [{ label: 'Härligt', run: () => { b.valueBoost = (b.valueBoost || 0) + 0.03; b.sat = Math.min(100, b.sat + 5); note('Positiv press – värdeboost.'); closeEvent(); renderOwned(); updateTop(); } }]; }
  },
  { id: 'policy', name: 'Policyförändring', pixel: 'ev-policy', prob: 0.10,
    pick: () => null,
    text: () => 'Regelförändring påverkar direktavkastningskravet.',
    actions: () => { const shift = (Math.random() < 0.5 ? -1 : +1) * 0.005; return [{ label: (shift < 0 ? `Lägre cap rate ${(Math.abs(shift) * 100).toFixed(1)} bps` : `Högre cap rate ${(Math.abs(shift) * 100).toFixed(1)} bps`), run: () => { state.capRate = Math.max(0.02, Math.min(0.08, state.capRate + shift)); note('Cap rate: ' + (state.capRate * 100).toFixed(2) + '%'); closeEvent(); renderOwned(); updateTop(); } }]; }
  }
];

function openEvent(ev, idx) {
  if (!eventModal) return;
  evTitle.textContent = ev.name;
  evPixel.className = 'ev-pixel ' + ev.pixel;
  const b = (idx != null && state.owned[idx]) ? state.owned[idx] : null;
  evText.textContent = b ? ev.text(b) : (typeof ev.text === 'function' ? ev.text() : (ev.text || ''));
  evActions.innerHTML = '';
  const acts = ev.actions(idx);
  acts.forEach(a => { const btn = document.createElement('button'); btn.className = 'btn mini'; btn.textContent = a.label; btn.onclick = a.run; evActions.appendChild(btn); });
  note('📣 ' + ev.name);
  eventModal.style.display = 'flex';
}
function closeEvent() { if (eventModal) eventModal.style.display = 'none'; }

function rollEvent() {
  const baseP = 0.35; if (Math.random() > baseP) return;
  const pool = EVENTS.filter(e => Math.random() < e.prob);
  const ev = pool.length ? pick(pool) : pick(EVENTS);
  let target = (typeof ev.pick === 'function') ? ev.pick(state) : null;
  if (target === null && ev.pick) return;
  openEvent(ev, target);
}

// --------- Årstick ---------
function updateTop() {
  if (cashEl)    cashEl.textContent    = fmt(state.cash);
  if (marketEl)  marketEl.textContent  = state.market.toFixed(2) + '×';
  if (rateEl)    rateEl.textContent    = (state.rate * 100).toFixed(1);
  if (debtTopEl) debtTopEl.textContent = fmt(totalDebt());
  const y = document.getElementById('yearNow'); if (y) { y.textContent = Math.min(15, currentYear()); }
}

function nextPeriod() {
  state.month++;

  // Betala ut likvider som förfaller detta år
  if (Array.isArray(state.pendingCash) && state.pendingCash.length) {
    const y = state.month;
    let total = 0;
    const rest = [];
    const paidLabels = [];
    for (const p of state.pendingCash) {
      if (p.year <= y) { total += p.amount; paidLabels.push(p.label || 'Likvid'); }
      else { rest.push(p); }
    }
    state.pendingCash = rest;
    if (total > 0) {
      state.cash += total;
      note(`Inkommande likvid: ${fmt(total)} kr${paidLabels.length ? ' (' + paidLabels.join(', ') + ')' : ''}`);
    }
  }

  // Marknadsdrift
  const drift = (Math.random() - 0.5) * 0.06;
  state.market = Math.max(0.85, Math.min(1.25, state.market * (1 + drift)));

  // Årets utbud genereras exakt en gång vid årsskiftet
  generateYearMarket(4);

  let rent = 0, maint = 0, interest = 0, amort = 0;

  for (let i = state.owned.length - 1; i >= 0; i--) {
    const b = state.owned[i];

    // nollställ årsräknare där det behövs
    ensureYearCounters(b);

    if (b.converting) { b.converting.duration--; if (b.converting.duration <= 0) { completeBRF(i, b); continue; } }
    if (b.project) {
      b.project.duration--;
      if (b.project.duration <= 0) {
        if (b.project.name === 'Vindskonvertering') {
          const add = b.project.addUnits || 0;
          b.units = (b.units || b.baseUnits || 0) + add;
          b.rentBoost = (b.rentBoost || 0) + 0.05;
          b.valueBoost = (b.valueBoost || 0) + 0.05;
          b.sat = Math.min(100, b.sat + 6); b.consent = Math.min(100, b.consent + 3);
        }
        b.project = null;
      }
    }

    // Årets hyra och drift (per månad * 12)
    rent  += effectiveRent(b)  * 12;
    maint += effectiveMaint(b) * 12;

    // Naturligt slitage
    if (Math.random() < 0.12 && b.cond !== 'forfallen') { b.cond = b.cond === 'ny' ? 'sliten' : 'forfallen'; b.sat = Math.max(0, b.sat - 6); }

    // Liten drift i nöjdhet/samtycke
    b.sat     = Math.max(0, Math.min(100, Math.round(b.sat + (b.cond === 'ny' ? +1 : b.cond === 'sliten' ? 0 : -1))));
    b.consent = Math.max(0, Math.min(100, Math.round(b.consent + (b.sat - 50) / 200)));
    b.status  = statusOf(b);
  }

  // Låneräkning (årsränta)
  state.loans.forEach(l => {
    if (l.balance <= 0) return;
    const r = l.rate;
    const int = Math.round(l.balance * r);     // årlig ränta
    let princ = Math.min(l.payment - int, l.balance);
    if (princ < 0) princ = 0;
    l.balance = Math.max(0, l.balance - princ);
    interest += int; amort += princ;
  });

  const pnl = rent - maint - interest - amort; state.cash += pnl;

  if (pnlEl)   pnlEl.textContent   = fmt(pnl)   + ' kr';
  if (rentEl)  rentEl.textContent  = fmt(rent)  + ' kr';
  if (maintEl) maintEl.textContent = fmt(maint) + ' kr';
  const intEl = document.getElementById('interest'); if (intEl) intEl.textContent = fmt(interest) + ' kr';
  const amoEl = document.getElementById('amort');    if (amoEl) amoEl.textContent = fmt(amort)    + ' kr';
  const debEl = document.getElementById('debt');     if (debEl) debEl.textContent = fmt(totalDebt()) + ' kr';

  updateTop(); renderOwned();
  note('Marknad nu: ' + state.market.toFixed(2) + '×');
  rollEvent();
  if (currentYear() > 15) { endGame(); }
}

// === Slutberäkningar & slutskärm ===
function calcNetWorth() {
  const propVal = state.owned.reduce((s, b) => s + valuation(b), 0);
  return Math.round(state.cash + propVal - totalDebt());
}
function summarizeEnd() {
  const worth  = calcNetWorth();
  const props  = state.owned.length;
  const avgSat = props ? Math.round(state.owned.reduce((s, b) => s + b.sat, 0) / props) : 0;
  return { worth, props, avgSat, year: Math.min(15, currentYear()) };
}
function endGame() {
  const s = summarizeEnd();
  const sumEl = document.getElementById('endSummary');
  if (sumEl) {
    sumEl.innerHTML =
      `Nettoförmögenhet: <b>${fmt(s.worth)}</b> kr<br>` +
      `Fastigheter: <b>${s.props}</b> • Snittnöjdhet: <b>${s.avgSat}%</b>`;
  }
  try { renderHighscores(); } catch {}
  try { renderHSBoard(); }   catch {}
  try { renderHSStats?.(); } catch {}
  const end = document.getElementById('endModal');
  if (end) end.style.display = 'flex';
}

/* ==================== HIGHSCORE (via Vercel-proxy) ==================== */

// 1) Proxy-URL (CSV som text)
const SHEET_CSV_URL = 'https://score-proxy.vercel.app/api/sheet';

// 2) LocalStorage-nycklar
const HS_KEY     = (window.HS_KEY || 'tapajos-highscores-v1');
const HS_RAW_KEY = 'tapajos-highscores-raw-v1';

// 3) CSV utils
function csvSplit(line) {
  const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/g);
  return parts.map(s => {
    s = (s ?? '').trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
    return s;
  });
}

// 4) Header-index
function buildIndex(headerCells) {
  const norm = s => (s || '').toString().trim().toLowerCase();
  const find = (...patterns) => headerCells.findIndex(h => {
    const x = norm(h);
    return patterns.some(p => p.test(x));
  });
  return {
    ts:     find(/tidst[aä]mpel|timestamp|time/i),
    name:   find(/^name$/i),
    score:  find(/^score$/i),
    props:  find(/^props?$/i),
    avgSat: find(/^avgsat$|avg.?sat|snittn[oö]jd/i),
    year:   find(/^year$|[aå]r/i),
    ver:    find(/^ver$|version/i),
  };
}
const normName = n => (n || '').trim().toLowerCase();

// Robust parser för tidsstämpel (undvik att falla tillbaka till "nu")
function parseTimestamp(tsStr) {
  if (!tsStr) return null;

  // Normalize: "2025-08-22 00.14.31" -> "2025-08-22 00:14:31"
  const normalized = tsStr.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2})\.(\d{2})\.(\d{2})$/,
    (_m, d, hh, mm, ss) => `${d} ${hh}:${mm}:${ss}`
  );

  // 1) Try native parse
  let t = Date.parse(normalized);
  if (!Number.isNaN(t)) return t;

  // 2) Try with 'T'
  t = Date.parse(normalized.replace(' ', 'T'));
  if (!Number.isNaN(t)) return t;

  // 3) Manual fallback: "YYYY-MM-DD HH:MM[:SS]"
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [_, y, mo, d, h, mi, s] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  }

  return null;
}

// Behåll högsta poäng per namn (vid lika poäng: senaste vinner)
function topPerName(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = normName(r.name);
    const cur = best.get(k);
    if (!cur || r.score > cur.score || (r.score === cur.score && (r.tsMs ?? 0) > (cur.tsMs ?? 0))) {
      best.set(k, r);
    }
  }
  return Array.from(best.values());
}

// 5) Läs från proxy + bygg cache (filtrera bara version GAME_VERSION)
async function hsReadFromSheet() {
  const r = await fetch(`${SHEET_CSV_URL}?_=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HS fetch failed: ${r.status}`);
  const text = await r.text();

  const lines = text.replace(/^\uFEFF/, '').trim().split('\n');
  if (lines.length === 0) {
    localStorage.setItem(HS_RAW_KEY, '[]');
    localStorage.setItem(HS_KEY, '[]');
    return { raw: [], unique: [] };
  }

  const header = csvSplit(lines[0]);
  const ix = buildIndex(header);

  const body = lines.slice(1);
  const rawAll = body.map(line => {
    const c = csvSplit(line);
    const get = i => (i >= 0 && i < c.length) ? c[i] : '';

    const tsStr   = get(ix.ts);
    const scoreStr= String(get(ix.score)  || '').replace(/[\s,]/g, '');
    const propsStr= String(get(ix.props)  || '').replace(/[\s,]/g, '');
    const avgStr  = String(get(ix.avgSat) || '').replace(/[\s,]/g, '');
    const yearStr = String(get(ix.year)   || '').replace(/[\s,]/g, '');
    const verStr  = String(get(ix.ver)    || '').trim();

    return {
      ts:    tsStr,
      tsMs:  parseTimestamp(tsStr),
      name:  get(ix.name) || 'Spelare',
      score: Number(scoreStr) || 0,
      props: Number(propsStr) || 0,
      avgSat:Number(avgStr)   || 0,
      year:  Number(yearStr)  || 0,
      ver:   verStr
    };
  }).filter(r => r.name && Number.isFinite(r.score));

  // Filtrera endast nuvarande version
  const raw = rawAll.filter(r => (r.ver || '').toString().trim() === GAME_VERSION);

  try { localStorage.setItem(HS_RAW_KEY, JSON.stringify(raw)); } catch {}

  const unique = topPerName(raw)
    .sort((a,b)=> b.score - a.score || (b.tsMs ?? 0) - (a.tsMs ?? 0))
    .map(x => ({ name: x.name, score: x.score, ts: x.ts, tsMs: x.tsMs }));

  try { localStorage.setItem(HS_KEY, JSON.stringify(unique)); } catch {}

  return { raw, unique };
}

// 6) Getter för visning (fallback från cache)
function getDisplayList() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(HS_KEY) || '[]'); } catch {}
  if (!Array.isArray(list)) list = [];
  const topped = topPerName(list.map(x => ({
      ...x,
      tsMs: (typeof x.tsMs === 'number' && !Number.isNaN(x.tsMs))
              ? x.tsMs
              : (x.ts ? parseTimestamp(x.ts) : null)
    })))
    .sort((a,b)=> b.score - a.score || (b.tsMs ?? 0) - (a.tsMs ?? 0));
  return topped;
}

// 7) Renderers
function renderHighscores() {
  const box = document.getElementById('hsList');
  if (!box) return;
  const top = getDisplayList().slice(0, 10);
  box.innerHTML = top.length
    ? '<ol>' + top.map(it => {
        const dateStr = it.tsMs ? new Date(it.tsMs).toLocaleDateString('sv-SE') : 'okänt datum';
        return `<li><b>${fmt(it.score)}</b> kr — ${it.name} <span class="meta">(${dateStr})</span></li>`;
      }).join('') + '</ol>'
    : 'Inga resultat sparade ännu (v' + GAME_VERSION + ').';
}

function renderHSBoard() {
  const host = document.getElementById('hsBoard');
  if (!host) return;
  const top = getDisplayList().slice(0, 10);
  if (top.length === 0) {
    host.innerHTML = `<div class="meta" style="padding:8px 4px">Inga resultat sparade ännu (v${GAME_VERSION}).</div>`;
    return;
  }
  host.innerHTML = top.map((it, i) => {
    const medal = i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : '⬤';
    const dateStr = it.tsMs ? new Date(it.tsMs).toLocaleDateString('sv-SE') : 'okänt datum';
    const safe  = (it.name || 'Spelare').toString().slice(0, 24);
    return `
      <div class="hs-row">
        <div class="hs-rank"><span class="hs-medal">${medal}</span></div>
        <div class="hs-name">${safe}</div>
        <div class="hs-score">${fmt(Math.round(it.score))} kr</div>
        <div class="hs-date">${dateStr}</div>
      </div>`;
  }).join('');
}

function hsStatsFromRaw() {
  let raw = [];
  try { raw = JSON.parse(localStorage.getItem(HS_RAW_KEY) || '[]'); } catch {}
  if (!Array.isArray(raw)) raw = [];
  const totalGames   = raw.length;
  const uniqueNames  = new Set(raw.map(r => normName(r.name))).size;
  const scores       = raw.map(r => r.score).filter(n => Number.isFinite(n)).sort((a,b)=>a-b);
  const mean         = scores.length ? Math.round(scores.reduce((s,n)=>s+n,0)/scores.length) : 0;
  const median       = scores.length ? Math.round(scores[Math.floor(scores.length/2)]) : 0;
  const topScore     = scores.length ? scores[scores.length-1] : 0;
  return { totalGames, uniqueNames, mean, median, topScore };
}

function renderHSStats() {
  const el = document.getElementById('hsStats'); if (!el) return;
  const s = hsStatsFromRaw();
  el.innerHTML =
    `Spel (v${GAME_VERSION}): <b>${fmt(s.totalGames)}</b> • Unika spelare: <b>${fmt(s.uniqueNames)}</b> ` +
    `• Snitt: <b>${fmt(s.mean)}</b> • Median: <b>${fmt(s.median)}</b> • Bästa: <b>${fmt(s.topScore)}</b>`;
}

// 8) Säker refresh
async function refreshHighscoresSafe(){
  try {
    try { localStorage.removeItem(HS_KEY);     } catch {}
    try { localStorage.removeItem(HS_RAW_KEY); } catch {}
    await hsReadFromSheet();
  } catch (e) {
    console.warn('[HS] Kunde inte läsa CSV efter spar: ', e);
  } finally {
    try { renderHighscores(); } catch {}
    try { renderHSBoard();   } catch {}
    try { renderHSStats?.(); } catch {}
  }
}

// 9) Highscore-modal
async function openHSModal(){
  try { await hsReadFromSheet(); } catch {}
  try { renderHSBoard(); } catch {}
  const m = document.getElementById('hsModal');
  if (m) m.style.display = 'flex';
}
function closeHSModal(){
  const m = document.getElementById('hsModal');
  if (m) m.style.display = 'none';
}

// 10) Google Form-post (med version)
function postToGoogleForm(FORM_ACTION, params) {
  return new Promise((resolve, reject) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.name = 'hs_hidden_iframe';
      iframe.style.display = 'none';

      const form = document.createElement('form');
      form.action = FORM_ACTION;
      form.method = 'POST';
      form.target = 'hs_hidden_iframe';
      form.style.display = 'none';

      for (const [k, v] of params.entries()) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k;
        inp.value = v;
        form.appendChild(inp);
      }

      let settled = false;
      const done = (ok = true) => { if (!settled) { settled = true; ok ? resolve() : reject(new Error('Form submit failed')); } };
      const tId = setTimeout(() => { console.warn('[HS] Form submit timeout – går vidare ändå'); done(true); }, 2500);
      iframe.addEventListener('load', () => { clearTimeout(tId); done(true); });

      document.body.appendChild(iframe);
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      reject(e);
    }
  });
}

// 11) Spara highscore (med version 1.1)
async function saveHighscore(){
  const nameEl = document.getElementById('playerName');
  const name = (nameEl?.value || 'Spelare').slice(0, 24);
  const s = summarizeEnd(); // { worth, props, avgSat, year }

  const btn = document.getElementById('saveScore');
  const oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sparar…'; }

  // Byt till din faktiska Form ACTION om du ändrat formuläret.
  const FORM_ACTION = 'https://docs.google.com/forms/d/e/1FAIpQLSek9RtCyZUpHmAgBm8L0ymRtJIqZ7Qxm-yZpU9BGQM5LMoOMA/formResponse';

  // OBS: entry.* måste matcha ditt uppdaterade formulär.
  const params = new URLSearchParams();
  params.append('entry.1521025478', name);            // Namn
  params.append('entry.1264246447', String(s.worth)); // Nettoförmögenhet
  params.append('entry.1926418411', String(s.props)); // Fastigheter
  params.append('entry.1041530574', String(s.avgSat)); // Snittnöjdhet
  params.append('entry.1154333964', String(s.year));   // År
  params.append('entry.143904483', GAME_VERSION);      // Version

  try {
    await postToGoogleForm(FORM_ACTION, params);
    await new Promise(res => setTimeout(res, 2800));
    await refreshHighscoresSafe();
    if (btn) btn.textContent = 'Sparat!';
  } catch (e) {
    console.error('Kunde inte spara till Google Form', e);
    alert('Hoppsan! Kunde inte spara till highscore just nu.');
  } finally {
    setTimeout(()=>{ if (btn) { btn.disabled = false; btn.textContent = oldText || 'Spara highscore'; } }, 800);
  }
}

// Delningshjälp (om knappar finns)
function mailScore() {
  const s = summarizeEnd();
  const subject = encodeURIComponent('Mitt TAPAJOS-resultat');
  const body = encodeURIComponent(
    `Nettoförmögenhet: ${fmt(s.worth)} kr\n` +
    `Fastigheter: ${s.props}\n` +
    `Snittnöjdhet: ${s.avgSat}%\n` +
    `År: ${s.year}/15`
  );
  location.href = `mailto:?subject=${subject}&body=${body}`;
}

async function copyScore() {
  const s = summarizeEnd();
  const text =
    `Nettoförmögenhet: ${fmt(s.worth)} kr\n` +
    `Fastigheter: ${s.props}\n` +
    `Snittnöjdhet: ${s.avgSat}%\n` +
    `År: ${s.year}/15`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      note('Resultat kopierat till urklipp!');
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      note('Resultat kopierat till urklipp!');
    }
  } catch {
    alert('Kunde inte kopiera till urklipp.');
  }
}

/* ==================== INIT: bindningar & laddning (robust) ==================== */
function bindNegControlsOnce() {
  if (adj && !adj.dataset.bound) {
    adj.addEventListener('input', updateNegProb);
    adj.addEventListener('change', updateNegProb);
    adj.dataset.bound = '1';
  }
  if (comp && !comp.dataset.bound) {
    comp.addEventListener('input', updateNegProb);
    comp.addEventListener('change', updateNegProb);
    comp.dataset.bound = '1';
  }
}

function bindCoreButtonsOnce() {
  function once(id, handler) {
    var el = document.getElementById(id);
    if (el && !el.dataset.bound) {
      el.addEventListener('click', handler);
      el.dataset.bound = '1';
      try { console.debug('[Tapajos] Bound -> #' + id); } catch(e){}
    }
  }

  // Huvud-UI
  once('openMarket', openMarket);
  once('mClose', function () {
    if (typeof marketModal !== 'undefined' && marketModal) marketModal.style.display = 'none';
  });
  once('next', nextPeriod);

  // Förhandling
  once('negRun', runNegotiation);
  once('negClose', function () {
    if (typeof negModal !== 'undefined' && negModal) negModal.style.display = 'none';
  });
  bindNegControlsOnce(); // säkerställ att reglagen lever

  // Events
  once('evClose', function () {
    if (typeof eventModal !== 'undefined' && eventModal) eventModal.style.display = 'none';
  });

  // Slutskärm
  once('saveScore', saveHighscore);
  once('playAgain', function () {
    var end = document.getElementById('endModal');
    if (end) end.style.display = 'none';
    location.reload();
  });
  once('mailScore', mailScore);
  once('copyScore', copyScore);

  // Highscore-modal
  once('openHS', openHSModal);
  once('hsClose', closeHSModal);
}

function showAppHideSplash() {
  var splash = document.getElementById('startScreen');
  if (splash) splash.style.display = 'none';
  var app = document.getElementById('appWrap');
  if (app) app.style.display = 'block'; // (eller 'grid' om din layout kräver)
}

window.addEventListener('DOMContentLoaded', function () {
  // Versionsmärkning (om elementet finns)
  try {
    var verTag = document.getElementById('hsVersionTag');
    if (verTag) verTag.textContent = 'Version ' + GAME_VERSION;
  } catch (e) {}

  // Startknapp
  try {
    var startBtn = document.getElementById('startBtn');
    if (startBtn && !startBtn.dataset.bound) {
      startBtn.addEventListener('click', function () {
        showAppHideSplash();
        try { if (typeof startGame === 'function') startGame(); } catch(e){}
        bindCoreButtonsOnce(); // säkerställ att allt är bundet efter splash
      });
      startBtn.dataset.bound = '1';
    }
  } catch (e) {}

  // Binda allt redan nu (om man hoppar över splash eller laddar om mitt i)
  bindCoreButtonsOnce();

  // Init UI
  try { updateTop(); } catch (e) {}
  try { renderOwned(); } catch (e) {}

  // Highscore (tål nätfel)
  (async function(){
    try { if (typeof hsReadFromSheet === 'function') await hsReadFromSheet(); } catch (e) {}
    try { if (typeof renderHighscores === 'function') renderHighscores(); } catch (e) {}
    try { if (typeof renderHSBoard === 'function') renderHSBoard(); } catch (e) {}
    try { if (typeof renderHSStats === 'function') renderHSStats(); } catch (e) {}

    // Andra pass i bakgrunden
    try {
      if (typeof hsReadFromSheet === 'function') {
        hsReadFromSheet()
          .catch(function(){})
          .finally(function(){
            try { if (typeof renderHighscores === 'function') renderHighscores(); } catch (e) {}
            try { if (typeof renderHSBoard === 'function') renderHSBoard(); } catch (e) {}
            try { if (typeof renderHSStats === 'function') renderHSStats(); } catch (e) {}
          });
      }
    } catch (e) {}
  })();
});