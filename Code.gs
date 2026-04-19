/* =============================================================================
   Le Châtelet — Google Apps Script Backend
   =============================================================================

   This script exposes a single Web App URL that the frontend (app.js) calls
   via POST. It handles:
   - Listing all reservations
   - Creating a new reservation (+ emails admin)
   - Updating a reservation's status (+ emails user)
   - Deleting a reservation (admin only — frontend gates this)

   -----------------------------------------------------------------------------
   DEPLOYMENT INSTRUCTIONS
   -----------------------------------------------------------------------------
   1. Open your Google Sheet (the one with the "Reservations" tab).
   2. Extensions > Apps Script.
   3. Replace the default code with this file's contents.
   4. Update the CONFIG section below:
        - ADMIN_EMAIL: the email that should receive booking alerts
        - SHEET_NAME: the name of the tab (default: "Reservations")
   5. Save the project (name it "Le Châtelet Backend" or similar).
   6. Click "Deploy" > "New deployment".
        - Select type: "Web app"
        - Description: anything
        - Execute as: "Me"
        - Who has access: "Anyone"
   7. Click Deploy. Authorize the script when prompted.
   8. Copy the Web App URL that appears.
   9. Paste it into app.js → CONFIG.SCRIPT_URL.

   -----------------------------------------------------------------------------
   GOOGLE SHEET STRUCTURE
   -----------------------------------------------------------------------------
   Create a sheet tab called "Reservations" with this header row (row 1):

   ID | Nom | Email | DateDebut | DateFin | NbPersonnes | PetitChalet |
   GrandChalet | TypeGrandChalet | Chambres | Statut | DateDemande | Telephone

   That's columns A through M. The order MUST match.
   ============================================================================= */

// ========================= CONFIGURATION ======================================
const CONFIG = {
  ADMIN_EMAIL: 'ADMIN_EMAIL_HERE@example.com',   // ⚠️ REPLACE WITH YOUR EMAIL
  SHEET_NAME: 'Reservations',
  SITE_NAME: 'Le Châtelet',
  SITE_URL: 'https://YOUR_GITHUB_USERNAME.github.io/chatelet/reservation.html', // optional
};

// ========================= COLUMN INDICES (1-based) ===========================
const COL = {
  ID: 1,
  NOM: 2,
  EMAIL: 3,
  DATE_DEBUT: 4,
  DATE_FIN: 5,
  NB_PERSONNES: 6,
  PETIT_CHALET: 7,
  GRAND_CHALET: 8,
  TYPE_GRAND: 9,
  CHAMBRES: 10,
  STATUT: 11,
  DATE_DEMANDE: 12,
  TELEPHONE: 13,
};
const LAST_COL = 13;

/* =============================================================================
   ENTRY POINT — doPost
   ============================================================================= */

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    let result;
    switch (action) {
      case 'list':
        result = { ok: true, reservations: listReservations() };
        break;
      case 'create':
        result = { ok: true, booking: createReservation(payload.booking) };
        break;
      case 'updateStatus':
        result = { ok: true, booking: updateStatus(payload.id, payload.status) };
        break;
      case 'delete':
        result = { ok: true, id: deleteReservation(payload.id) };
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

// Also allow GET for a health check / browser test
function doGet(e) {
  return jsonResponse({
    ok: true,
    message: 'Le Châtelet backend is alive.',
    timestamp: new Date().toISOString(),
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =============================================================================
   SHEET HELPERS
   ============================================================================= */

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" not found.');
  return sheet;
}

function findRowById(id) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      return i + 2; // row number (1-based, +1 for header)
    }
  }
  return null;
}

function nextId() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const ids = sheet.getRange(2, COL.ID, lastRow - 1, 1).getValues();
  let max = 0;
  ids.forEach(row => {
    const n = parseInt(row[0], 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}

function rowToReservation(row) {
  return {
    id: row[COL.ID - 1],
    userName: row[COL.NOM - 1],
    email: row[COL.EMAIL - 1],
    startDate: formatDate(row[COL.DATE_DEBUT - 1]),
    endDate: formatDate(row[COL.DATE_FIN - 1]),
    numPeople: row[COL.NB_PERSONNES - 1],
    petitChalet: boolFromCell(row[COL.PETIT_CHALET - 1]),
    grandChalet: boolFromCell(row[COL.GRAND_CHALET - 1]),
    grandChaletType: row[COL.TYPE_GRAND - 1] || null,
    chambres: row[COL.CHAMBRES - 1] || null,
    status: row[COL.STATUT - 1] || 'pending',
    requestDate: row[COL.DATE_DEMANDE - 1]
      ? (row[COL.DATE_DEMANDE - 1] instanceof Date
          ? row[COL.DATE_DEMANDE - 1].toISOString()
          : String(row[COL.DATE_DEMANDE - 1]))
      : '',
    phone: row[COL.TELEPHONE - 1] || '',
  };
}

function formatDate(cell) {
  if (!cell) return '';
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  return String(cell);
}

function boolFromCell(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'oui' || s === 'yes';
}

/* =============================================================================
   ACTIONS
   ============================================================================= */

function listReservations() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, LAST_COL).getValues();
  return data.map(rowToReservation).filter(r => r.id); // drop empty rows
}

function createReservation(booking) {
  const sheet = getSheet();
  const id = nextId();

  const row = new Array(LAST_COL).fill('');
  row[COL.ID - 1] = id;
  row[COL.NOM - 1] = booking.userName || '';
  row[COL.EMAIL - 1] = booking.email || '';
  row[COL.DATE_DEBUT - 1] = booking.startDate || '';
  row[COL.DATE_FIN - 1] = booking.endDate || '';
  row[COL.NB_PERSONNES - 1] = booking.numPeople || 0;
  row[COL.PETIT_CHALET - 1] = booking.petitChalet === true;
  row[COL.GRAND_CHALET - 1] = booking.grandChalet === true;
  row[COL.TYPE_GRAND - 1] = booking.grandChaletType || '';
  row[COL.CHAMBRES - 1] = booking.chambres || '';
  row[COL.STATUT - 1] = booking.status || 'pending';
  row[COL.DATE_DEMANDE - 1] = new Date();
  row[COL.TELEPHONE - 1] = booking.phone || '';

  sheet.appendRow(row);

  // Email admin
  try {
    sendAdminNotification({ ...booking, id });
  } catch (err) {
    Logger.log('Admin email failed: ' + err);
  }

  // Confirmation email to user (pending status)
  try {
    sendUserPendingConfirmation({ ...booking, id });
  } catch (err) {
    Logger.log('User email failed: ' + err);
  }

  return { ...booking, id };
}

function updateStatus(id, newStatus) {
  const sheet = getSheet();
  const rowNum = findRowById(id);
  if (!rowNum) throw new Error('Reservation not found: ' + id);

  const validStatuses = ['pending', 'approved', 'denied', 'cancelled'];
  if (validStatuses.indexOf(newStatus) === -1) {
    throw new Error('Invalid status: ' + newStatus);
  }

  sheet.getRange(rowNum, COL.STATUT).setValue(newStatus);

  // Fetch the updated row and email the user
  const rowData = sheet.getRange(rowNum, 1, 1, LAST_COL).getValues()[0];
  const booking = rowToReservation(rowData);

  try {
    sendUserStatusUpdate(booking);
  } catch (err) {
    Logger.log('User status email failed: ' + err);
  }

  return booking;
}

function deleteReservation(id) {
  const sheet = getSheet();
  const rowNum = findRowById(id);
  if (!rowNum) throw new Error('Reservation not found: ' + id);
  sheet.deleteRow(rowNum);
  return id;
}

/* =============================================================================
   EMAIL TEMPLATES
   ============================================================================= */

function buildChaletSummary(b) {
  const parts = [];
  if (b.petitChalet) parts.push('Petit Châtelet');
  if (b.grandChalet) {
    let label = 'Grand Châtelet';
    if (b.grandChaletType === 'chambres' && b.chambres) {
      label += ' (' + b.chambres + ')';
    } else if (b.grandChaletType === 'entier') {
      label += ' (entier)';
    }
    parts.push(label);
  }
  return parts.join(' + ');
}

function sendAdminNotification(booking) {
  if (!CONFIG.ADMIN_EMAIL || CONFIG.ADMIN_EMAIL.indexOf('ADMIN_EMAIL_HERE') !== -1) {
    Logger.log('Admin email not configured — skipping.');
    return;
  }

  const subject = '[Le Châtelet] Nouvelle demande de ' + booking.userName;
  const body =
    'Une nouvelle demande de réservation a été soumise.\n\n' +
    '──────────────────────────\n' +
    'Nom : ' + booking.userName + '\n' +
    'Email : ' + booking.email + '\n' +
    (booking.phone ? 'Téléphone : ' + booking.phone + '\n' : '') +
    'Dates : ' + booking.startDate + ' → ' + booking.endDate + '\n' +
    'Personnes : ' + booking.numPeople + '\n' +
    'Chalet(s) : ' + buildChaletSummary(booking) + '\n' +
    'Statut : en attente d\'approbation\n' +
    '──────────────────────────\n\n' +
    'Connectez-vous au site pour approuver ou refuser :\n' +
    CONFIG.SITE_URL + '\n';

  MailApp.sendEmail({
    to: CONFIG.ADMIN_EMAIL,
    subject: subject,
    body: body,
  });
}

function sendUserPendingConfirmation(booking) {
  if (!booking.email) return;

  const subject = '[Le Châtelet] Demande de réservation reçue';
  const body =
    'Bonjour ' + booking.userName + ',\n\n' +
    'Votre demande de réservation a bien été reçue. Elle est en attente d\'approbation.\n\n' +
    '──────────────────────────\n' +
    'Dates : ' + booking.startDate + ' → ' + booking.endDate + '\n' +
    'Personnes : ' + booking.numPeople + '\n' +
    'Chalet(s) : ' + buildChaletSummary(booking) + '\n' +
    '──────────────────────────\n\n' +
    'Vous recevrez un nouvel email une fois la demande approuvée ou refusée.\n\n' +
    'À bientôt,\n' +
    CONFIG.SITE_NAME;

  MailApp.sendEmail({
    to: booking.email,
    subject: subject,
    body: body,
  });
}

function sendUserStatusUpdate(booking) {
  if (!booking.email) return;

  const statusLabels = {
    approved: 'approuvée ✓',
    denied: 'refusée',
    cancelled: 'annulée',
    pending: 'remise en attente',
  };
  const label = statusLabels[booking.status] || booking.status;

  const subject = '[Le Châtelet] Votre réservation a été ' + label;

  let body =
    'Bonjour ' + booking.userName + ',\n\n' +
    'Votre demande de réservation a été ' + label + '.\n\n' +
    '──────────────────────────\n' +
    'Dates : ' + booking.startDate + ' → ' + booking.endDate + '\n' +
    'Personnes : ' + booking.numPeople + '\n' +
    'Chalet(s) : ' + buildChaletSummary(booking) + '\n' +
    '──────────────────────────\n\n';

  if (booking.status === 'approved') {
    body += 'À très bientôt au Châtelet !\n\n';
  } else if (booking.status === 'denied') {
    body += 'Pour toute question, répondez directement à cet email ou contactez l\'administrateur.\n\n';
  }

  body += CONFIG.SITE_NAME;

  MailApp.sendEmail({
    to: booking.email,
    subject: subject,
    body: body,
  });
}

/* =============================================================================
   UTILITIES — run manually from Apps Script editor if needed
   ============================================================================= */

// Call this once from the editor to initialize the header row if the sheet is empty.
function initializeSheet() {
  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'ID', 'Nom', 'Email', 'DateDebut', 'DateFin', 'NbPersonnes',
      'PetitChalet', 'GrandChalet', 'TypeGrandChalet', 'Chambres',
      'Statut', 'DateDemande', 'Telephone'
    ]);
    sheet.getRange(1, 1, 1, LAST_COL).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  Logger.log('Sheet initialized.');
}

// Quick test — run from editor to verify email works
function testAdminEmail() {
  sendAdminNotification({
    userName: 'Test',
    email: 'test@example.com',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    numPeople: 4,
    petitChalet: true,
    grandChalet: false,
  });
  Logger.log('Test email sent to ' + CONFIG.ADMIN_EMAIL);
}
