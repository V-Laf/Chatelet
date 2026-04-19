/* =============================================================================
   Le Châtelet — Logique frontend
   - Authentification famille / admin
   - Formulaire de réservation
   - Affichage calendriers (Petit + Grand)
   - Gestion "Mes réservations" et "Toutes les demandes"
   - Intégration Google Apps Script Web App
   ============================================================================= */
/* -----------------------------------------------------------------------------
   CONFIGURATION
   -----------------------------------------------------------------------------
   ⚠️  REMPLACEZ la valeur de SCRIPT_URL ci-dessous par l'URL de votre
        déploiement "Web App" de Google Apps Script.
        (Voir instructions de déploiement en fin de Code.gs)
   ----------------------------------------------------------------------------- */
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyxUD0_I1_hYs4YF6NDmcJnCoFOVwnvCi2-pOlq_T4fSdQO1KaiPfAy4Yg7GR5zVy8/exec',
  FAMILY_PASSWORD: 'BecRouge',
  ADMIN_PASSWORD: 'Tempete',
  STORAGE_KEY_USER: 'chatelet_user',
  STORAGE_KEY_AUTH: 'chatelet_auth',
  STORAGE_KEY_ADMIN: 'chatelet_admin',
};

/* =============================================================================
   ÉTAT GLOBAL
   ============================================================================= */
const state = {
  familyAuth: false,
  adminAuth: false,
  userName: '',
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

/* =============================================================================
   API — Google Apps Script Web App
   =============================================================================
   Convention :
   - POST  { action: 'list' }                   → renvoie toutes les réservations
   - POST  { action: 'create', booking: {...} } → ajoute une réservation
   - POST  { action: 'updateStatus', id, status } → change le statut
   - POST  { action: 'delete', id }             → supprime définitivement

   Notes :
   - On utilise text/plain pour éviter la requête CORS preflight (OPTIONS).
   - Apps Script reçoit quand même le body brut via e.postData.contents.
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
    chambres: r.chambres || null,
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
  if (state.userName) $('user-name').value = state.userName;
}

function showAuth() {
  $('auth-section').classList.remove('hidden');
  $('app-section').classList.add('hidden');
}

function updateUserBar() {
  const greet = state.userName ? `Bonjour, ${state.userName}` : 'Connecté';
  $('user-greet').textContent = greet;
  $('admin-indicator').classList.toggle('hidden', !state.adminAuth);
  $('admin-login-btn').textContent = state.adminAuth ? 'Désactiver admin' : 'Mode admin';
}

function setupAuthHandlers() {
  // Famille
  $('family-auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = $('family-password').value;
    const msgEl = $('family-auth-msg');
    if (pwd === CONFIG.FAMILY_PASSWORD) {
      state.familyAuth = true;
      sessionStorage.setItem(CONFIG.STORAGE_KEY_AUTH, 'ok');
      showApp();
      refreshAll();
    } else {
      showMsg(msgEl, 'Mot de passe incorrect.', 'error');
    }
  });

  // Admin toggle
  $('admin-login-btn').addEventListener('click', () => {
    if (state.adminAuth) {
      state.adminAuth = false;
      sessionStorage.removeItem(CONFIG.STORAGE_KEY_ADMIN);
      updateUserBar();
      renderAll();
    } else {
      showAdminModal();
    }
  });

  // Admin form
  $('admin-auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = $('admin-password').value;
    const msgEl = $('admin-auth-msg');
    if (pwd === CONFIG.ADMIN_PASSWORD) {
      state.adminAuth = true;
      sessionStorage.setItem(CONFIG.STORAGE_KEY_ADMIN, 'ok');
      hideAdminModal();
      updateUserBar();
      renderAll();
    } else {
      showMsg(msgEl, 'Mot de passe admin incorrect.', 'error');
    }
  });

  $('admin-modal-cancel').addEventListener('click', hideAdminModal);

  // Logout
  $('logout-btn').addEventListener('click', () => {
    sessionStorage.clear();
    state.familyAuth = false;
    state.adminAuth = false;
    state.userName = '';
    showAuth();
  });
}

function showAdminModal() {
  const modal = $('admin-modal');
  modal.style.display = 'flex';
  modal.classList.remove('hidden');
  $('admin-password').value = '';
  $('admin-password').focus();
  $('admin-auth-msg').innerHTML = '';
}

function hideAdminModal() {
  const modal = $('admin-modal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
}

/* =============================================================================
   FORMULAIRE DE RÉSERVATION
   ============================================================================= */

function setupBookingForm() {
  const grandCheckbox = $('grand-chalet');
  const grandOptions = $('grand-options');
  const chambresField = $('chambres-field');
  const radioEntier = document.querySelector('input[name="grand-type"][value="entier"]');
  const radioChambres = document.querySelector('input[name="grand-type"][value="chambres"]');

  // Show/hide Grand options
  grandCheckbox.addEventListener('change', () => {
    grandOptions.classList.toggle('hidden', !grandCheckbox.checked);
  });

  // Show/hide chambres detail
  [radioEntier, radioChambres].forEach(r => {
    r.addEventListener('change', () => {
      chambresField.classList.toggle('hidden', radioChambres.checked === false);
    });
  });

  // Submit
  $('booking-form').addEventListener('submit', handleBookingSubmit);

  // Date validation
  $('start-date').addEventListener('change', () => {
    const sd = $('start-date').value;
    $('end-date').min = sd;
    if ($('end-date').value && $('end-date').value < sd) {
      $('end-date').value = sd;
    }
  });

  // Today min
  const todayStr = formatDateISO(new Date());
  $('start-date').min = todayStr;
  $('end-date').min = todayStr;
}

async function handleBookingSubmit(e) {
  e.preventDefault();

  const msgEl = $('booking-msg');
  const submitBtn = $('submit-booking-btn');

  const userName = $('user-name').value.trim();
  const email = $('user-email').value.trim();
  const startDate = $('start-date').value;
  const endDate = $('end-date').value;
  const numPeople = parseInt($('num-people').value, 10);
  const phone = $('user-phone').value.trim();
  const petit = $('petit-chalet').checked;
  const grand = $('grand-chalet').checked;

  // Validation
  if (!userName || !email || !startDate || !endDate || !numPeople) {
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
  let chambres = null;
  if (grand) {
    grandType = document.querySelector('input[name="grand-type"]:checked').value;
    if (grandType === 'chambres') {
      chambres = $('chambres').value.trim();
      if (!chambres) {
        showMsg(msgEl, 'Précisez les chambres souhaitées.', 'error');
        return;
      }
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
    chambres,
    status: 'pending',
    requestDate: new Date().toISOString(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Envoi...';
  showMsg(msgEl, 'Envoi de la demande...', 'info');

  try {
    await createReservation(booking);
    state.userName = userName;
    sessionStorage.setItem(CONFIG.STORAGE_KEY_USER, userName);
    showMsg(msgEl, 'Demande envoyée ! Vous recevrez un email de confirmation après approbation.', 'success');
    $('booking-form').reset();
    $('user-name').value = userName; // keep name
    $('grand-options').classList.add('hidden');
    $('chambres-field').classList.add('hidden');
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
      const cal = btn.dataset.cal; // 'petit' or 'grand'
      const dir = btn.dataset.nav; // 'prev' or 'next'
      const key = cal === 'petit' ? 'petitMonth' : 'grandMonth';
      const d = new Date(state[key]);
      d.setMonth(d.getMonth() + (dir === 'next' ? 1 : -1));
      state[key] = d;
      renderCalendar(cal);
    });
  });
}

function reservationsOverlappingDay(dayDate, chaletFilter) {
  // chaletFilter: 'petit' or 'grand'
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
  // Monday start: 0=Monday ... 6=Sunday
  let firstDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = '';

  // empty slots before first
  for (let i = 0; i < firstDow; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    dayDate.setHours(0, 0, 0, 0);
    const reservations = reservationsOverlappingDay(dayDate, which);

    let cls = 'calendar-day';
    if (dayDate.getTime() === today.getTime()) cls += ' today';
    if (reservations.some(r => r.status === 'approved')) cls += ' approved';
    else if (reservations.some(r => r.status === 'pending')) cls += ' pending';

    // Pills — max 3, then "+X"
    const pills = reservations.slice(0, 3).map(r => {
      const pCls = r.status === 'pending' ? 'res-pill pending' : 'res-pill';
      const tip = buildTooltip(r, which);
      return `<span class="${pCls}" title="${tip}">${escapeHtml(r.userName)}</span>`;
    }).join('');
    const more = reservations.length > 3
      ? `<span class="res-more">+${reservations.length - 3}</span>`
      : '';

    html += `
      <div class="${cls}">
        <span class="day-number">${day}</span>
        <div class="day-reservations">${pills}${more}</div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function buildTooltip(r, which) {
  const parts = [r.userName, `${r.numPeople} pers.`];
  if (which === 'grand' && r.grandChaletType === 'chambres' && r.chambres) {
    parts.push(r.chambres);
  } else if (which === 'grand' && r.grandChaletType === 'entier') {
    parts.push('(Entier)');
  }
  parts.push(`${formatDateHuman(r.startDate)} → ${formatDateHuman(r.endDate)}`);
  return escapeHtml(parts.join(' · '));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* =============================================================================
   TABLEAUX — Mes réservations & Toutes les demandes
   ============================================================================= */

function renderMyReservations() {
  const container = $('my-reservations-container');
  const mine = state.reservations.filter(r =>
    r.userName.toLowerCase() === state.userName.toLowerCase() && state.userName
  );

  if (!state.userName) {
    container.innerHTML = '<div class="empty-state">Envoyez votre première demande pour voir vos réservations ici.</div>';
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
    // Sort: pending first, then by start date asc
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
      if (r.grandChaletType === 'chambres' && r.chambres) label += ` (${escapeHtml(r.chambres)})`;
      else if (r.grandChaletType === 'entier') label += ' (Entier)';
      chalets.push(`<span class="chalet-tag">${label}</span>`);
    }

    const statusLabel = {
      pending: 'En attente',
      approved: 'Approuvée',
      denied: 'Refusée',
      cancelled: 'Annulée',
    }[r.status] || r.status;

    // Actions
    const actions = [];
    if (opts.showAdmin && r.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-approve" data-action="approve" data-id="${r.id}">Approuver</button>`);
      actions.push(`<button class="btn btn-sm btn-deny" data-action="deny" data-id="${r.id}">Refuser</button>`);
    }
    if (opts.showAdmin) {
      actions.push(`<button class="btn btn-sm btn-delete" data-action="delete" data-id="${r.id}">Effacer</button>`);
    }
    if (opts.showOwnerCancel && (r.status === 'pending' || r.status === 'approved')) {
      actions.push(`<button class="btn btn-sm btn-cancel" data-action="cancel" data-id="${r.id}">Annuler</button>`);
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
          <th>Nom</th>
          <th>Dates</th>
          <th>Pers.</th>
          <th>Chalet(s)</th>
          <th>Statut</th>
          <th>Actions</th>
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
   RAFRAÎCHISSEMENT & RENDU
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
}

/* =============================================================================
   INITIALISATION
   ============================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  setupAuthHandlers();
  setupBookingForm();
  setupCalendarNav();
  checkStoredAuth();
});
