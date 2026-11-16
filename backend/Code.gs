/**
 * Jess Cruse website helper.
 *
 * Lives inside Jess's own Google Sheet. It does four jobs, for free:
 *   1. Saves every book pre-order as a row in the "Pre-orders" tab.
 *   2. Emails Jess the moment a pre-order arrives.
 *   3. Emails the buyer a thank-you.
 *   4. Counts visits and button clicks, and emails Jess a summary every Monday.
 *
 * Wording and the notification address are edited in the "Settings" tab, not here.
 */

var TAB_ORDERS = 'Pre-orders';
var TAB_ACTIVITY = 'Activity';
var TAB_SETTINGS = 'Settings';
var MAX_THANK_YOUS_PER_DAY = 60;

var DEFAULT_SETTINGS = [
  ['Send alerts to', 'jess@voxa.club'],
  ['Send thank-you emails (yes or no)', 'yes'],
  ['Thank-you subject', 'Thank you for pre-ordering A Book About Voice'],
  ['Thank-you message', 'Hi {name},\n\nThank you for pre-ordering A Book About Voice. It means a lot that you want to read it.\n\nI am writing it now, and it is coming in 2027. You do not need to pay anything today. I will email you as soon as it is ready, with everything you need.\n\nUntil then, keep using your voice.\n\nJess'],
  ['Weekly summary (yes or no)', 'yes']
];

function doPost(e) {
  var out = { ok: true };
  try {
    var data = JSON.parse(e.postData.contents);
    setUp_();
    if (data.kind === 'preorder') {
      savePreorder_(data);
    } else if (data.kind === 'event') {
      saveEvent_(data);
    }
  } catch (err) {
    out = { ok: false, message: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  setUp_();
  return ContentService.createTextOutput('The Jess Cruse website helper is running.');
}

/* ---------- pre-orders ---------- */

function savePreorder_(data) {
  if (data.website) return; // hidden field only robots fill in
  var name = clean_(data.name, 80);
  var email = clean_(data.email, 120);
  var city = clean_(data.city, 80);
  var country = clean_(data.country, 80);
  var format = clean_(data.format, 80);
  var copies = Math.max(1, Math.min(999, parseInt(data.copies, 10) || 1));
  if (!name || !city || !country || !format) throw new Error('Please fill in every field.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email address does not look right.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_(TAB_ORDERS).appendRow([new Date(), name, email, city, country, format, copies]);
  } finally {
    lock.releaseLock();
  }

  var s = settings_();
  var owner = s['Send alerts to'];
  if (owner) {
    MailApp.sendEmail({
      to: owner,
      replyTo: email,
      subject: 'New pre-order: ' + name + ' (' + copies + (copies === 1 ? ' copy' : ' copies') + ')',
      body: 'A new pre-order for A Book About Voice.\n\n' +
        'Name: ' + name + '\nEmail: ' + email + '\nCity: ' + city + '\nCountry: ' + country +
        '\nFormat: ' + format + '\nCopies: ' + copies +
        '\n\nYour full list: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
  }

  if (isYes_(s['Send thank-you emails (yes or no)']) && underDailyLimit_()) {
    MailApp.sendEmail({
      to: email,
      replyTo: owner || undefined,
      name: 'Jess Cruse',
      subject: s['Thank-you subject'],
      body: String(s['Thank-you message']).replace(/\{name\}/g, name.split(' ')[0])
    });
  }
}

function underDailyLimit_() {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var count = props.getProperty('thanks_day') === today ? parseInt(props.getProperty('thanks_count'), 10) || 0 : 0;
  if (count >= MAX_THANK_YOUS_PER_DAY) return false;
  props.setProperty('thanks_day', today);
  props.setProperty('thanks_count', String(count + 1));
  return true;
}

/* ---------- visits and clicks ---------- */

function saveEvent_(data) {
  var type = clean_(data.type, 20);
  if (type !== 'Visit' && type !== 'Page view' && type !== 'Click') return;
  var row = [new Date(), type, clean_(data.label, 80), clean_(data.page, 120), clean_(data.source, 80)];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_(TAB_ACTIVITY).appendRow(row);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- weekly summary ---------- */

function weeklySummary() {
  setUp_();
  var s = settings_();
  if (!isYes_(s['Weekly summary (yes or no)']) || !s['Send alerts to']) return;
  var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  var visits = 0, views = 0, clicks = {}, pages = {}, sources = {};
  rows_(TAB_ACTIVITY).forEach(function (r) {
    if (!(r[0] instanceof Date) || r[0] < since) return;
    if (r[1] === 'Visit') { visits++; views++; bump_(sources, r[4] || 'Direct or unknown'); bump_(pages, r[3]); }
    if (r[1] === 'Page view') { views++; bump_(pages, r[3]); }
    if (r[1] === 'Click') bump_(clicks, r[2]);
  });

  var orders = 0, copies = 0, orderLines = [], total = 0;
  rows_(TAB_ORDERS).forEach(function (r) {
    if (!(r[0] instanceof Date)) return;
    total++;
    if (r[0] < since) return;
    orders++;
    copies += Number(r[6]) || 0;
    orderLines.push('  ' + r[1] + ', ' + r[3] + ', ' + r[4] + ' (' + r[5] + ', ' + r[6] + ')');
  });

  var body = 'Your website, last 7 days\n\n' +
    'Visits: ' + visits + '\n' +
    'Pages viewed: ' + views + '\n' +
    'Book pre-orders: ' + orders + ' (' + copies + ' copies). All time: ' + total + '\n' +
    'Book a call clicks: ' + (clicks['Book a call'] || 0) + '\n' +
    'Email clicks: ' + (clicks['Email Jess'] || 0) + '\n\n' +
    'All button clicks\n' + (list_(clicks) || '  None yet') + '\n\n' +
    'Most viewed pages\n' + (list_(pages) || '  None yet') + '\n\n' +
    'Where visitors came from\n' + (list_(sources) || '  None yet') + '\n\n' +
    (orderLines.length ? 'This week\'s pre-orders\n' + orderLines.join('\n') + '\n\n' : '') +
    'Open the full sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl();

  MailApp.sendEmail({ to: s['Send alerts to'], subject: 'Your website this week: ' + visits + ' visits, ' + orders + ' pre-orders', body: body });
}

function bump_(map, key) { key = key || 'Unknown'; map[key] = (map[key] || 0) + 1; }

function list_(map) {
  return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, 12)
    .map(function (k) { return '  ' + k + ': ' + map[k]; }).join('\n');
}

/* ---------- set-up and helpers ---------- */

function setUp_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ready') === '2') return;
  header_(TAB_ORDERS, ['Date', 'Name', 'Email', 'City', 'Country', 'Format', 'Copies']);
  header_(TAB_ACTIVITY, ['Date', 'Type', 'What', 'Page', 'Came from']);
  var settings = sheet_(TAB_SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, DEFAULT_SETTINGS.length, 2).setValues(DEFAULT_SETTINGS);
    settings.getRange(1, 1, DEFAULT_SETTINGS.length, 1).setFontWeight('bold');
    settings.setColumnWidth(1, 280);
    settings.setColumnWidth(2, 560);
    settings.getRange(1, 2, DEFAULT_SETTINGS.length, 1).setWrap(true);
  }
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'weeklySummary'; });
  if (!hasTrigger) {
    ScriptApp.newTrigger('weeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  }
  props.setProperty('ready', '2');
}

/** Run this once by hand after pasting the code. It creates the tabs and the Monday email. */
function firstTimeSetUp() {
  PropertiesService.getScriptProperties().deleteProperty('ready');
  setUp_();
}

function sheet_(name) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  return book.getSheetByName(name) || book.insertSheet(name);
}

function header_(name, titles) {
  var sheet = sheet_(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(titles);
    sheet.getRange(1, 1, 1, titles.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function rows_(name) {
  var sheet = sheet_(name);
  var last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, 7).getValues();
}

function settings_() {
  var map = {};
  DEFAULT_SETTINGS.forEach(function (pair) { map[pair[0]] = pair[1]; });
  var sheet = sheet_(TAB_SETTINGS);
  if (sheet.getLastRow() > 0) {
    sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues().forEach(function (r) {
      if (r[0]) map[String(r[0]).trim()] = String(r[1]);
    });
  }
  return map;
}

function isYes_(value) { return String(value).trim().toLowerCase().indexOf('y') === 0; }

/** Trim, cap the length, and stop anything being read as a spreadsheet formula. */
function clean_(value, max) {
  var text = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
