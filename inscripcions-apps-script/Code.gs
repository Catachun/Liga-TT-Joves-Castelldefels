/**
 * TTJ Castelldefels · Recepció de preinscripcions des de la web
 * ------------------------------------------------------------
 * Què fa:
 *  1. Rep el formulari de https://ttjovescastelldefels.com/inscripcio.html
 *  2. Desa les fotos (DNI, CatSalut, signatura) en una carpeta de Drive per alumne
 *  3. Afegeix una fila a la pestanya WEB_ENTRADES del full de càlcul (mateixes columnes que BASE)
 *  4. Envia un avís per correu al club
 *
 * Instal·lació: veure LLEGEIX-ME.md
 */

// ====== CONFIGURACIÓ ======
var SHEET_ID = '1rcW_VwK62GzlQhgTHIwblCYkjiNmSLqmf5dmtA7nSZg'; // JOVES_BD_2627 (full de la Kim). Buit = es crea un full nou.
var TAB_NAME = 'WEB_ENTRADES';
var ROOT_FOLDER_NAME = 'INSCRIPCIONS WEB 2026-27';
var NOTIFY_EMAIL = 'ettcastelldefels@gmail.com';
var TOKEN = 'ttj-2026-27-insc'; // ha de coincidir amb el de la pàgina web
var MAX_FILES = 12;
var MAX_FILE_BYTES = 3 * 1024 * 1024;

// Capçaleres: A..AZ = idèntic a la pestanya BASE de la Kim; BA.. = camps extra de la web
var HEADERS = ['SIT','ent','ord','cognom1','cognom2','nom','Data Naixement','Dni / Nie','CATSALUT','Adreça','C.P','Municipi','Província','Telèfon','e-mail','app','Mare Nom','Mare Telèfon','Mare e-mail','Pare Nom','Pare Telèfon','Pare e-mail','Sexe','Any','Categoría','Tipus','FCTT','RFETM','Grup','Mitjà','Titular','Dni / Nie titular','IBAN','Data alta','Tipus quota','AGO','SEP','OCT','NOV','DES','GEN','FEB','MARÇ','ABR','MAIG','JUNY','JUL','TOTAL','','Tràmits','Imatge','Comunicats',
  'Enviat el','Dies triats','Carpeta fotos (Drive)','Tutor/a (relació)','Observacions','ID enviament'];

function doGet() {
  return json_({ ok: true, msg: 'TTJ inscripcions actiu' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var p = JSON.parse(e.postData.contents);
    if (p.token !== TOKEN) return json_({ ok: false, error: 'token' });
    if (p.hp) return json_({ ok: true, ref: 'ok' }); // anti-spam (camp ocult)
    var f = p.fields || {};
    var files = p.files || [];
    if (!f.nom || !f.cognom1 || !f.grup) return json_({ ok: false, error: 'dades' });
    if (files.length > MAX_FILES) return json_({ ok: false, error: 'fitxers' });

    var sheet = getSheet_();
    // Evitar duplicats si la família torna a enviar (mateix ID)
    var idCol = HEADERS.length;
    var last = sheet.getLastRow();
    if (p.id && last > 1) {
      var ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(p.id)) return json_({ ok: true, ref: p.id, dup: true });
      }
    }

    // Carpeta de l'alumne
    var root = getRootFolder_();
    var folderName = clean_(f.cognom1 + ' ' + (f.cognom2 || '') + ', ' + f.nom) + ' (' + (f.naixement || '') + ')';
    var folder = root.createFolder(folderName);
    files.forEach(function (fl) {
      var bytes = Utilities.base64Decode(fl.data);
      if (bytes.length > MAX_FILE_BYTES) return;
      var blob = Utilities.newBlob(bytes, fl.mime || 'image/jpeg', clean_(fl.name || 'fitxer') );
      folder.createFile(blob);
    });

    var tutor = f.tutorNom || '';
    var rel = f.tutorRelacio || '';
    var mareNom = '', mareTel = '', mareMail = '', pareNom = '', pareTel = '', pareMail = '';
    if (tutor) {
      if (rel === 'mare') { mareNom = tutor; mareTel = f.tutorTel || ''; mareMail = f.tutorEmail || ''; }
      else { pareNom = tutor; pareTel = f.tutorTel || ''; pareMail = f.tutorEmail || ''; }
    }
    var row = rowNumber_(sheet);
    var imp = f.imports || {};
    var q = imp.quota || '';
    var out = [
      'NOVA', 'web', '',
      f.cognom1 || '', f.cognom2 || '', f.nom || '', f.naixement || '', f.dni || '', f.catsalut || '',
      f.adreca || '', f.cp || '', f.municipi || '', f.provincia || '',
      f.tel || '', f.email || '', '',
      mareNom, mareTel, mareMail, pareNom, pareTel, pareMail,
      f.sexe || '', f.any || '', '', '', '', '',
      f.grupCodi || '', 'COMPTE', f.titular || '', f.titularDni || '', f.iban || '', f.dataAlta || '', f.tipusQuota || f.grupCodi || '',
      imp.matricula || '', q, q, q, q, q, q, q, q, q, q, '', '',
      '', f.tramits || '', f.imatge || '', f.comunicats || '',
      Utilities.formatDate(new Date(), 'Europe/Madrid', 'dd/MM/yyyy HH:mm'), f.dies || '', folder.getUrl(), rel, f.observacions || '', p.id || ''
    ];
    // Les fórmules es desen com a fórmula; la resta com a text per no perdre zeros ni IBAN
    sheet.getRange(row, 1, 1, out.length).setNumberFormat('@');
    sheet.getRange(row, 1, 1, out.length).setValues([out]);
    sheet.getRange(row, 48).setNumberFormat('General').setFormula('=SUM(AJ' + row + ':AU' + row + ')');

    try {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: 'Nova preinscripció web: ' + f.nom + ' ' + f.cognom1 + ' · ' + (f.grupNom || f.grupCodi),
        htmlBody: '<p>Nova preinscripció rebuda des de la web.</p>' +
          '<p><b>' + esc_(f.nom + ' ' + f.cognom1 + ' ' + (f.cognom2 || '')) + '</b><br>Grup: ' + esc_(f.grupNom || f.grupCodi) + ' · ' + esc_(f.dies || '') + '</p>' +
          '<p><a href="' + folder.getUrl() + '">Fotos i signatura (Drive)</a><br>' +
          '<a href="' + SpreadsheetApp.openById(sheet.getParent().getId()).getUrl() + '#gid=' + sheet.getSheetId() + '">Fila a la pestanya ' + TAB_NAME + '</a></p>' +
          '<p style="color:#888;font-size:12px">Per privacitat, aquest avís no inclou DNI ni IBAN.</p>'
      });
    } catch (mailErr) { /* l'avís és secundari */ }

    return json_({ ok: true, ref: p.id || '' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// ====== Auxiliars ======
function getSheet_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.create('INSCRIPCIONS WEB 2026-27');
  var sh = ss.getSheetByName(TAB_NAME);
  if (!sh) {
    sh = ss.insertSheet(TAB_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#F5C518');
    sh.setFrozenRows(1);
  }
  return sh;
}
function rowNumber_(sh) { return Math.max(sh.getLastRow(), 1) + 1; }
function getRootFolder_() {
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}
function clean_(s) { return String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim(); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Per provar des de l'editor (Executar > provaLocal): crea una fila i una carpeta de prova
function provaLocal() {
  var r = doPost({ postData: { contents: JSON.stringify({
    token: TOKEN, id: 'prova-' + Date.now(),
    fields: { nom: 'PROVA', cognom1: 'Prova', cognom2: 'Web', naixement: '01/01/2015', grup: 'ADU', grupCodi: 'ADU', grupNom: 'Adults', dies: 'Dimarts', imports: { matricula: 70, quota: 37 }, tramits: 'SI', imatge: 'NO', comunicats: 'SI' },
    files: []
  }) } });
  Logger.log(r.getContent());
}
