/* =============================================================================
   Le Châtelet — Logique frontend
   - Authentification famille / admin (avec prénom)
   - Formulaire de réservation avec chambres nommées et lits
   - Affichage calendriers (Petit + Grand)
   - Détection de partage de chambres (warnings)
   - Intégration Google Apps Script Web App
   ============================================================================= */

/* -----------------------------------------------------------------------------
   CONFIGURATION
   -----------------------------------------------------------------------------
   ⚠️  REMPLACEZ la valeur de SCRIPT_URL ci-dessous par l'URL de votre
        déploiement "Web App" de Google Apps Script.
   ----------------------------------------------------------------------------- */
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/VOTRE_DEPLOYMENT_ID/exec',
  FAMILY_PASSWORD: 'BecRouge',
  ADMIN_PASSWORD: 'Tempete',
  ADMIN_NAME: 'Severine',           // case-insensitive, accent-insensitive
  STORAGE_KEY_USER: 'chatelet_user',
  STORAGE_KEY_AUTH: 'chatelet_auth',
  STORAGE_KEY_ADMIN: 'chatelet_admin',
};

/* Grand Chalet rooms — id, label, bed capacity */
const ROOMS = [
  { id: 'mezz_double',  name: 'Chambre Mezzanine Lit Double',         beds: 1 },
  { id: 'mezz_simples', name: 'Chambre Mezzanine Deux Lits Simples',  beds: 2 },
  { id: 'mezzanine',    name: 'Mezzanine',                            beds: 4 },
  { id: 'rdc',          name: 'Chambre Rez-de-Chaussée',              beds: 1 },
  { id: 'cave',         name: 'Chambre Cave',                         beds: 4 },
];

/* =============================================================================
   ÉTAT GLOBAL
   ============================================================================= */
const state = {
  familyAuth: false,
  adminAuth: false,
  userName: '',                // exact display name as entered
  reservations: [],
  petitMonth: new Date(),
  grandMonth: new Date(),
};

/* =============================================================================
   UTILITAIRES
   ============================================================================= */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

/* Normalize a name for case- and accent-insensitive comparison */
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')              // separate accents
    .replace(/[\u0300-\u036f]/g, '')  // remove combining marks
    .toLowerCase()
    .trim();
}

function namesMatch(a, b) {
  return normalizeName(a) === normalizeName(b);
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISO(isoStr) {
  if (!isoStr) return null;
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateHuman(isoStr) {
  const d = parseISO(isoStr);
  if (!d) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showMsg(el, text, type = 'info') {
  el.innerHTML = `<div class="msg ${type}">${text}</div>`;
  if (type === 'success') setTimeout(() => { el.innerHTML = ''; }, 4000);
}

function truthy(v) {
  if (v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1') return true;
  return false;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getRoom(id) {
  return ROOMS.find(r => r.id === id);
}

/* Parse the chambres field — supports both new JSON format and legacy text */
function parseChambres(raw) {
  if (!raw) return [];
  if (typeof raw === 'object') return Array.isArray(raw) ? raw : [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }
  // Legacy / free-text: store as-is in a single pseudo-room
  return [{ legacy: s }];
}

function chambresToLabel(chambres) {
  if (!chambres || !chambres.length) return '';
  return chambres.map(c => {
    if (c.legacy) return c.legacy;
    const r = getRoom(c.room);
    if (!r) return '';
    if (r.beds === 1) return r.name;
    return `${r.name} (${c.beds} lit${c.beds > 1 ? 's' : ''})`;
  }).filter(Boolean).join(', ');
}

/* =============================================================================
   API — Google Apps Script Web App
   ============================================================================= */

async function apiCall(payload) {
  try {
    const response = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Erreur inconnue');
    return data;
  } catch (err) {
    console.error('API error:', err);
    throw err;
  }
}

async function fetchReservations() {
  const data = await apiCall({ action: 'list' });
  state.reservations = (data.reservations || []).map(r => ({
    id: String(r.id),
    userName: r.userName || '',
    email: r.email || '',
    startDate: r.startDate || '',
    endDate: r.endDate || '',
    numPeople: Number(r.numPeople) || 0,
    petitChalet: truthy(r.petitChalet),
    grandChalet: truthy(r.grandChalet),
    grandChaletType: r.grandChaletType || null,
    chambres: parseChambres(r.chambres),
    status: r.status || 'pending',
    requestDate: r.requestDate || '',
    phone: r.phone || '',
  }));
  return state.reservations;
}

async function createReservation(booking) {
  return await apiCall({ action: 'create', booking });
}

async function updateStatus(id, status) {
  return await apiCall({ action: 'updateStatus', id, status });
}

async function deleteReservation(id) {
  return await apiCall({ action: 'delete', id });
}

/* =============================================================================
   AUTHENTIFICATION
   ============================================================================= */

function checkStoredAuth() {
  if (sessionStorage.getItem(CONFIG.STORAGE_KEY_AUTH) === 'ok') {
    state.familyAuth = true;
    state.userName = sessionStorage.getItem(CONFIG.STORAGE_KEY_USER) || '';
    if (sessionStorage.getItem(CONFIG.STORAGE_KEY_ADMIN) === 'ok') {
      state.adminAuth = true;
    }
    showApp();
    refreshAll();
  }
}

function showApp() {
  $('auth-section').classList.add('hidden');
  $('app-section').classList.remove('hidden');
  updateUserBar();
}

function showAuth() {
  $('auth-section').classList.remove('hidden');
  $('app-section').classList.add('hidden');
}

function updateUserBar() {
  const greet = state.userName ? `Bonjour, ${state.userName}` : 'Connecté';
  $('user-greet').textContent = greet;
  $('admin-indicator').classList.toggle('hidden', !state.adminAuth);
}

function setupAuthHandlers() {
  // Toggle admin password field visibility based on checkbox
  $('admin-checkbox').addEventListener('change', (e) => {
    const f = $('admin-password-field');
    f.classList.toggle('hidden', !e.target.checked);
    if (e.target.checked) {
      $('admin-password').focus();
    } else {
      $('admin-password').value = '';
    }
  });

  // Family/admin login submit
  $('family-auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('login-name').value.trim();
    const familyPwd = $('family-password').value;
    const isAdmin = $('admin-checkbox').checked;
    const adminPwd = $('admin-password').value;
    const msgEl = $('family-auth-msg');

    if (!name) {
      showMsg(msgEl, 'Veuillez renseigner votre prénom.', 'error');
      return;
    }
    if (familyPwd !== CONFIG.FAMILY_PASSWORD) {
      showMsg(msgEl, 'Mot de passe famille incorrect.', 'error');
      return;
    }

    // Admin path: name must match Severine AND admin password must be valid
    if (isAdmin) {
      if (!namesMatch(name, CONFIG.ADMIN_NAME)) {
        showMsg(msgEl, `Seule ${CONFIG.ADMIN_NAME} peut se connecter en tant qu'admin.`, 'error');
        return;
      }
      if (adminPwd !== CONFIG.ADMIN_PASSWORD) {
        showMsg(msgEl, 'Mot de passe admin incorrect.', 'error');
        return;
      }
      state.adminAuth = true;
      sessionStorage.setItem(CONFIG.STORAGE_KEY_ADMIN, 'ok');
    } else {
      state.adminAuth = false;
      sessionStorage.removeItem(CONFIG.STORAGE_KEY_ADMIN);
    }

    state.familyAuth = true;
    state.userName = name;
    sessionStorage.setItem(CONFIG.STORAGE_KEY_AUTH, 'ok');
    sessionStorage.setItem(CONFIG.STORAGE_KEY_USER, name);

    showApp();
    refreshAll();
  });

  // Logout
  $('logout-btn').addEventListener('click', () => {
    sessionStorage.clear();
    state.familyAuth = false;
    state.adminAuth = false;
    state.userName = '';
    // Reset the form
    $('login-name').value = '';
    $('family-password').value = '';
    $('admin-checkbox').checked = false;
    $('admin-password').value = '';
    $('admin-password-field').classList.add('hidden');
    showAuth();
  });
}

/* =============================================================================
   FORMULAIRE DE RÉSERVATION
   ============================================================================= */

function buildRoomsList() {
  const container = $('rooms-list');
  if (!container) return;
  container.innerHTML = ROOMS.map(r => {
    const bedsOptions = Array.from({ length: r.beds }, (_, i) =>
      `<option value="${i + 1}">${i + 1}</option>`
    ).join('');
    const showBeds = r.beds > 1;
    return `
      <div class="room-row" data-room-id="${r.id}">
        <label class="room-row-header">
          <input type="checkbox" data-room-check="${r.id}" />
          <span class="room-row-name">${r.name}</span>
          <span class="room-row-capacity">${r.beds} lit${r.beds > 1 ? 's' : ''}</span>
        </label>
        ${showBeds ? `
        <div class="room-row-beds hidden" data-room-beds-wrapper="${r.id}">
          <label for="beds-${r.id}">Lits demandés :</label>
          <select id="beds-${r.id}" data-room-beds="${r.id}">${bedsOptions}</select>
        </div>` : ''}
      </div>
    `;
  }).join('');
}

function setupBookingForm() {
  buildRoomsList();

  const grandCheckbox = $('grand-chalet');
  const grandOptions = $('grand-options');
  const roomsSelector = $('rooms-selector');
  const radioEntier = document.querySelector('input[name="grand-type"][value="entier"]');
  const radioChambres = document.querySelector('input[name="grand-type"][value="chambres"]');

  // Show/hide Grand options
  grandCheckbox.addEventListener('change', () => {
    grandOptions.classList.toggle('hidden', !grandCheckbox.checked);
    updateSharingWarning();
  });

  // Show/hide rooms selector when "chambres" radio chosen
  [radioEntier, radioChambres].forEach(r => {
    r.addEventListener('change', () => {
      roomsSelector.classList.toggle('hidden', !radioChambres.checked);
      updateSharingWarning();
    });
  });

  // Per-room checkbox + bed-count selector wiring
  document.querySelectorAll('[data-room-check]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.roomCheck;
      const row = document.querySelector(`.room-row[data-room-id="${id}"]`);
      const bedsWrap = document.querySelector(`[data-room-beds-wrapper="${id}"]`);
      row.classList.toggle('selected', cb.checked);
      if (bedsWrap) bedsWrap.classList.toggle('hidden', !cb.checked);
      updateSharingWarning();
    });
  });

  document.querySelectorAll('[data-room-beds]').forEach(sel => {
    sel.addEventListener('change', updateSharingWarning);
  });

  // Submit
  $('booking-form').addEventListener('submit', handleBookingSubmit);

  // Date validation + recompute warning on date change
  $('start-date').addEventListener('change', () => {
    const sd = $('start-date').value;
    $('end-date').min = sd;
    if ($('end-date').value && $('end-date').value < sd) {
      $('end-date').value = sd;
    }
    updateSharingWarning();
  });
  $('end-date').addEventListener('change', updateSharingWarning);

  // Today min
  const todayStr = formatDateISO(new Date());
  $('start-date').min = todayStr;
  $('end-date').min = todayStr;
}

/* Read currently-selected rooms from the form */
function getSelectedRooms() {
  const result = [];
  ROOMS.forEach(r => {
    const cb = document.querySelector(`[data-room-check="${r.id}"]`);
    if (cb && cb.checked) {
      let beds = 1;
      if (r.beds > 1) {
        const sel = document.querySelector(`[data-room-beds="${r.id}"]`);
        beds = sel ? parseInt(sel.value, 10) : 1;
      }
      result.push({ room: r.id, beds });
    }
  });
  return result;
}

/* =============================================================================
   DÉTECTION DE PARTAGE / CONFLIT DE CHAMBRES
   ============================================================================= */

/* Two date ranges overlap if startA <= endB && startB <= endA (inclusive) */
function rangesOverlap(s1, e1, s2, e2) {
  if (!s1 || !e1 || !s2 || !e2) return false;
  return s1 <= e2 && s2 <= e1;
}

/* Build a map: room id → array of {beds, by, status, range} for reservations
   that overlap the given date range and book that room */
function getRoomOccupancy(startDate, endDate) {
  const occupancy = {};
  ROOMS.forEach(r => { occupancy[r.id] = []; });

  state.reservations.forEach(res => {
    if (res.status === 'cancelled' || res.status === 'denied') return;
    if (!res.grandChalet) return;
    if (!rangesOverlap(startDate, endDate, res.startDate, res.endDate)) return;

    if (res.grandChaletType === 'entier') {
      // Entire chalet — occupies all rooms fully
      ROOMS.forEach(r => {
        occupancy[r.id].push({
          beds: r.beds,
          by: res.userName,
          status: res.status,
          entire: true,
        });
      });
    } else if (res.grandChaletType === 'chambres') {
      (res.chambres || []).forEach(c => {
        if (!c.room) return;
        if (occupancy[c.room]) {
          occupancy[c.room].push({
            beds: c.beds || 1,
            by: res.userName,
            status: res.status,
            entire: false,
          });
        }
      });
    }
  });
  return occupancy;
}

/* Compute warnings for the current form state */
function computeSharingInfo() {
  const startDate = $('start-date').value;
  const endDate = $('end-date').value;
  const grand = $('grand-chalet').checked;
  const grandType = document.querySelector('input[name="grand-type"]:checked')?.value;

  if (!grand || grandType !== 'chambres' || !startDate || !endDate) {
    return { warnings: [], hasOverbook: false };
  }

  const selected = getSelectedRooms();
  if (!selected.length) return { warnings: [], hasOverbook: false };

  const occupancy = getRoomOccupancy(startDate, endDate);
  const warnings = [];
  let hasOverbook = false;

  selected.forEach(sel => {
    const room = getRoom(sel.room);
    if (!room) return;
    const others = occupancy[room.id] || [];
    if (!others.length) return;

    const totalUsed = others.reduce((sum, o) => sum + o.beds, 0);
    const wouldUse = totalUsed + sel.beds;

    // If anyone has the entire chalet, that's a hard conflict
    if (others.some(o => o.entire)) {
      const who = others.filter(o => o.entire).map(o => o.by).join(', ');
      warnings.push({
        room: room.name,
        kind: 'entire',
        message: `${room.name} : ${who} a réservé le chalet entier sur ces dates.`,
      });
      hasOverbook = true;
      return;
    }

    if (wouldUse > room.beds) {
      hasOverbook = true;
      const namesList = others.map(o => `${o.by} (${o.beds} lit${o.beds > 1 ? 's' : ''})`).join(', ');
      warnings.push({
        room: room.name,
        kind: 'overbook',
        message: `${room.name} : surréservation. ${namesList} occupent déjà ${totalUsed}/${room.beds} lits, vous demandez ${sel.beds} de plus.`,
      });
    } else {
      const namesList = others.map(o => `${o.by} (${o.beds} lit${o.beds > 1 ? 's' : ''})`).join(', ');
      warnings.push({
        room: room.name,
        kind: 'share',
        message: `${room.name} : partagée avec ${namesList}.`,
      });
    }
  });

  return { warnings, hasOverbook };
}

function updateSharingWarning() {
  const el = $('sharing-warning');
  if (!el) return;
  const info = computeSharingInfo();
  if (!info.warnings.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const title = info.hasOverbook
    ? '⚠ Attention — conflit ou surréservation'
    : 'ⓘ Cette demande implique un partage de chambre';
  el.innerHTML = `
    <strong>${title}</strong>
    <ul>${info.warnings.map(w => `<li>${escapeHtml(w.message)}</li>`).join('')}</ul>
  `;
  el.classList.remove('hidden');
}

/* =============================================================================
   SUBMIT
   ============================================================================= */

async function handleBookingSubmit(e) {
  e.preventDefault();

  const msgEl = $('booking-msg');
  const submitBtn = $('submit-booking-btn');

  const userName = state.userName; // from session
  const email = $('user-email').value.trim();
  const startDate = $('start-date').value;
  const endDate = $('end-date').value;
  const numPeople = parseInt($('num-people').value, 10);
  const phone = $('user-phone').value.trim();
  const petit = $('petit-chalet').checked;
  const grand = $('grand-chalet').checked;

  // Validation
  if (!email || !startDate || !endDate || !numPeople) {
    showMsg(msgEl, 'Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }
  if (!petit && !grand) {
    showMsg(msgEl, 'Sélectionnez au moins un chalet.', 'error');
    return;
  }
  if (endDate < startDate) {
    showMsg(msgEl, 'La date de départ doit être après la date d\'arrivée.', 'error');
    return;
  }

  let grandType = null;
  let chambres = [];
  if (grand) {
    grandType = document.querySelector('input[name="grand-type"]:checked').value;
    if (grandType === 'chambres') {
      chambres = getSelectedRooms();
      if (!chambres.length) {
        showMsg(msgEl, 'Sélectionnez au moins une chambre.', 'error');
        return;
      }
    }
  }

  // If there's a sharing/overbook warning, ask for confirmation but allow submission
  if (grand && grandType === 'chambres') {
    const info = computeSharingInfo();
    if (info.hasOverbook) {
      const ok = confirm(
        'Attention : votre demande implique une surréservation ou un conflit.\n\n' +
        info.warnings.map(w => '— ' + w.message).join('\n') +
        '\n\nVous pouvez continuer ; un administrateur examinera la demande. Confirmer ?'
      );
      if (!ok) return;
    }
  }

  const booking = {
    userName,
    email,
    startDate,
    endDate,
    numPeople,
    phone,
    petitChalet: petit,
    grandChalet: grand,
    grandChaletType: grandType,
    chambres: JSON.stringify(chambres), // store as JSON string
    status: 'pending',
    requestDate: new Date().toISOString(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi...';
  showMsg(msgEl, 'Envoi de la demande...', 'info');

  try {
    await createReservation(booking);
    showMsg(msgEl, 'Demande envoyée ! Vous recevrez un email de confirmation après approbation.', 'success');
    // Reset form but keep email if user wants to re-book
    $('booking-form').reset();
    $('grand-options').classList.add('hidden');
    $('rooms-selector').classList.add('hidden');
    document.querySelectorAll('.room-row').forEach(r => r.classList.remove('selected'));
    document.querySelectorAll('[data-room-beds-wrapper]').forEach(w => w.classList.add('hidden'));
    $('sharing-warning').classList.add('hidden');
    await refreshAll();
  } catch (err) {
    showMsg(msgEl, `Erreur : ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Envoyer la demande';
  }
}

/* =============================================================================
   CALENDRIERS
   ============================================================================= */

function setupCalendarNav() {
  $$('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cal = btn.dataset.cal;
      const dir = btn.dataset.nav;
      const key = cal === 'petit' ? 'petitMonth' : 'grandMonth';
      const d = new Date(state[key]);
      d.setMonth(d.getMonth() + (dir === 'next' ? 1 : -1));
      state[key] = d;
      renderCalendar(cal);
    });
  });
}

function reservationsOverlappingDay(dayDate, chaletFilter) {
  return state.reservations.filter(r => {
    if (r.status === 'cancelled' || r.status === 'denied') return false;
    if (chaletFilter === 'petit' && !r.petitChalet) return false;
    if (chaletFilter === 'grand' && !r.grandChalet) return false;
    const s = parseISO(r.startDate);
    const e = parseISO(r.endDate);
    if (!s || !e) return false;
    return dayDate >= s && dayDate <= e;
  });
}

function renderCalendar(which) {
  const monthDate = which === 'petit' ? state.petitMonth : state.grandMonth;
  const containerId = which === 'petit' ? 'petit-days' : 'grand-days';
  const labelId = which === 'petit' ? 'petit-month-label' : 'grand-month-label';
  const container = $(containerId);
  const label = $(labelId);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  label.textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let firstDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '';
  for (let i = 0; i < firstDow; i++) html += '<div class="calendar-day empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    dayDate.setHours(0, 0, 0, 0);
    const reservations = reservationsOverlappingDay(dayDate, which);

    let cls = 'calendar-day';
    if (dayDate.getTime() === today.getTime()) cls += ' today';

    // Deeper green when an APPROVED "Grand Chalet entier" overlaps (Grand only)
    const hasApprovedEntire = which === 'grand'
      && reservations.some(r => r.status === 'approved' && r.grandChaletType === 'entier');

    if (hasApprovedEntire) cls += ' approved approved-entire';
    else if (reservations.some(r => r.status === 'approved')) cls += ' approved';
    else if (reservations.some(r => r.status === 'pending')) cls += ' pending';

    const pills = reservations.slice(0, 3).map(r => {
      const pCls = r.status === 'pending' ? 'res-pill pending' : 'res-pill';
      const tip = buildTooltip(r, which);
      return `<span class="${pCls}" title="${tip}">${escapeHtml(r.userName)}</span>`;
    }).join('');
    const more = reservations.length > 3
      ? `<span class="res-more">+${reservations.length - 3}</span>`
      : '';

    // Day-level tooltip — shows ALL reservations on that day, including room details
    const dayTip = buildDayTooltip(reservations, which);

    html += `
      <div class="${cls}"${dayTip ? ` title="${dayTip}"` : ''}>
        <span class="day-number">${day}</span>
        <div class="day-reservations">${pills}${more}</div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/* Build a tooltip listing all reservations on a given day, with room details */
function buildDayTooltip(reservations, which) {
  if (!reservations.length) return '';
  const lines = reservations.map(r => {
    let line = `${r.userName} (${r.numPeople} pers.)`;
    if (which === 'grand') {
      if (r.grandChaletType === 'entier') {
        line += ' — Chalet entier';
      } else if (r.grandChaletType === 'chambres') {
        const lbl = chambresToLabel(r.chambres);
        line += lbl ? ` — Chambres : ${lbl}` : ' — Chambres seulement';
      }
    }
    if (r.status === 'pending') line += ' [en attente]';
    return line;
  });
  return escapeHtml(lines.join('\n'));
}

function buildTooltip(r, which) {
  const parts = [r.userName, `${r.numPeople} pers.`];
  if (which === 'grand') {
    if (r.grandChaletType === 'entier') {
      parts.push('Chalet entier');
    } else if (r.grandChaletType === 'chambres') {
      const lbl = chambresToLabel(r.chambres);
      if (lbl) parts.push(`Chambres seulement : ${lbl}`);
      else parts.push('Chambres seulement');
    }
  }
  parts.push(`${formatDateHuman(r.startDate)} → ${formatDateHuman(r.endDate)}`);
  return escapeHtml(parts.join(' · '));
}

/* =============================================================================
   TABLEAUX — Mes réservations & Toutes les demandes
   ============================================================================= */

function renderMyReservations() {
  const container = $('my-reservations-container');
  const mine = state.reservations.filter(r =>
    state.userName && namesMatch(r.userName, state.userName)
  );

  if (!state.userName) {
    container.innerHTML = '<div class="empty-state">Connectez-vous pour voir vos réservations.</div>';
    return;
  }

  if (mine.length === 0) {
    container.innerHTML = '<div class="empty-state">Vous n\'avez aucune réservation pour le moment.</div>';
    return;
  }

  container.innerHTML = renderReservationsTable(mine, { showOwnerCancel: true });
  attachTableActions(container);
}

function renderAllReservations() {
  const container = $('all-reservations-container');
  const all = [...state.reservations].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return (a.startDate || '').localeCompare(b.startDate || '');
  });

  if (all.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune demande enregistrée.</div>';
    return;
  }

  container.innerHTML = renderReservationsTable(all, { showAdmin: state.adminAuth });
  attachTableActions(container);
}

function renderReservationsTable(list, opts = {}) {
  const rows = list.map(r => {
    const chalets = [];
    if (r.petitChalet) chalets.push('<span class="chalet-tag">Petit</span>');
    if (r.grandChalet) {
      let label = 'Grand';
      if (r.grandChaletType === 'entier') {
        label += ' (Entier)';
      } else if (r.grandChaletType === 'chambres') {
        const lbl = chambresToLabel(r.chambres);
        label += lbl ? ` (${escapeHtml(lbl)})` : ' (Chambres)';
      }
      chalets.push(`<span class="chalet-tag">${label}</span>`);
    }

    const statusLabel = {
      pending: 'En attente',
      approved: 'Approuvée',
      denied: 'Refusée',
      cancelled: 'Annulée',
    }[r.status] || r.status;

    const actions = [];
    if (opts.showAdmin && r.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-approve" data-action="approve" data-id="${r.id}">Approuver</button>`);
      actions.push(`<button class="btn btn-sm btn-deny" data-action="deny" data-id="${r.id}">Refuser</button>`);
    }
    if (opts.showAdmin) {
      actions.push(`<button class="btn btn-sm btn-delete" data-action="delete" data-id="${r.id}">Effacer</button>`);
    }
    // Owner-cancel: only on "Mes réservations" panel, only for pending/approved
    if (opts.showOwnerCancel && (r.status === 'pending' || r.status === 'approved')) {
      // Extra safety check: must be owner
      if (namesMatch(r.userName, state.userName)) {
        actions.push(`<button class="btn btn-sm btn-cancel" data-action="cancel" data-id="${r.id}">Annuler</button>`);
      }
    }

    return `
      <tr>
        <td data-label="Nom">${escapeHtml(r.userName)}</td>
        <td data-label="Dates">${formatDateHuman(r.startDate)}<br><span style="color:var(--muted);font-size:0.85em;">→ ${formatDateHuman(r.endDate)}</span></td>
        <td data-label="Pers.">${r.numPeople}</td>
        <td data-label="Chalet(s)">${chalets.join(' ')}</td>
        <td data-label="Statut"><span class="status-tag ${r.status}">${statusLabel}</span></td>
        <td data-label="Actions"><div class="actions">${actions.join('')}</div></td>
      </tr>
    `;
  }).join('');

  return `
    <table class="res-table">
      <thead>
        <tr>
          <th>Nom</th><th>Dates</th><th>Pers.</th>
          <th>Chalet(s)</th><th>Statut</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function attachTableActions(container) {
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      await handleTableAction(action, id, btn);
    });
  });
}

async function handleTableAction(action, id, btn) {
  const confirmMsgs = {
    approve: 'Approuver cette réservation ?',
    deny: 'Refuser cette réservation ?',
    delete: 'Effacer définitivement cette réservation ? (irréversible)',
    cancel: 'Annuler cette réservation ?',
  };
  if (!confirm(confirmMsgs[action])) return;

  // Extra safety: cancel only if owner (or admin)
  if (action === 'cancel') {
    const res = state.reservations.find(r => r.id === id);
    if (res && !state.adminAuth && !namesMatch(res.userName, state.userName)) {
      alert('Vous ne pouvez annuler que vos propres réservations.');
      return;
    }
  }

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    if (action === 'approve') await updateStatus(id, 'approved');
    else if (action === 'deny') await updateStatus(id, 'denied');
    else if (action === 'cancel') await updateStatus(id, 'cancelled');
    else if (action === 'delete') await deleteReservation(id);
    await refreshAll();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* =============================================================================
   RAFRAÎCHISSEMENT
   ============================================================================= */

async function refreshAll() {
  try {
    await fetchReservations();
    renderAll();
  } catch (err) {
    console.error(err);
    $('my-reservations-container').innerHTML =
      `<div class="msg error">Impossible de charger les réservations : ${err.message}</div>`;
    $('all-reservations-container').innerHTML = '';
  }
}

function renderAll() {
  renderCalendar('petit');
  renderCalendar('grand');
  renderMyReservations();
  renderAllReservations();
  updateSharingWarning();
}

/* =============================================================================
   INIT
   ============================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  setupAuthHandlers();
  setupBookingForm();
  setupCalendarNav();
  checkStoredAuth();
});
