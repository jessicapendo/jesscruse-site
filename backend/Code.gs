/**
 * Jess Cruse website helper.
 *
 * Lives inside Jess's own Google Sheet. It does four jobs, for free:
 *   1. Saves every book pre-order as a row in the "Pre-orders" tab.
 *   2. Emails Jess the moment a pre-order arrives.
 *   3. Emails the buyer a thank-you.
 *   4. Counts visits and button clicks, and sends Jess a report (daily or weekly, by email and optionally Slack).
 *
 * Wording and the notification address are edited in the "Settings" tab, not here.
 */

var TAB_ORDERS = 'Pre-orders';
var TAB_ACTIVITY = 'Activity';
var TAB_SETTINGS = 'Settings';
var TAB_SUMMARY = 'Summary';
var VERSION = '3';
var MAX_THANK_YOUS_PER_DAY = 60;

var THANK_YOU = 'Heyyy you!\n\nThank you for showing interest in my book about voice. As I continue to write this, your interest motivates me to keep going.\n\nUntil then, here\'s what you can do:\n\n1. Leave this email knowing I think you\'re amazing.\n\n2. Get weekly voice confidence boosting tips to your email here: {tips}\n\n3. Follow me and my messy building in public, with some storytelling tips and more shares: https://instagram.com/livingstorieswithjess\n\n4. Step into the world of Voxa, where I built an app and other ways to help your voice: https://voxa.club\n\nOrrrr\n\nJust get in touch and say hey. Email me at jess@voxa.club or book a call: https://calendly.com/jess-voxa\n\nIt really does mean a lot.\n\nHere\'s one of my fave quotes to leave you with:\n\nSpeak,\neven if your voice shakes.\n\nUntil spring 2027.\n\nSee yaaaaaa\n\nJess';

var DEFAULT_SETTINGS = [
  ['Send alerts to', 'jess@voxa.club'],
  ['Send thank-you emails (yes or no)', 'yes'],
  ['Thank-you subject', 'Thank you (and a little something from me)'],
  ['Thank-you message', THANK_YOU],
  ['Weekly tips sign-up link (Kit)', ''],
  ['Send me a report (yes or no)', 'yes'],
  ['How often (daily or weekly)', 'weekly'],
  ['Slack webhook link (optional)', '']
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

  var s = settings_();
  var owner = s['Send alerts to'];
  var status = 'Not sent (thank-you emails are switched off)';

  if (isYes_(s['Send thank-you emails (yes or no)'])) {
    if (!underDailyLimit_()) {
      status = 'Not sent (daily safety limit reached)';
    } else {
      try {
        var message = thankYouText_(s, name);
        MailApp.sendEmail({ to: email, replyTo: String(owner).split(',')[0] || undefined, name: 'Jess Cruse', subject: s['Thank-you subject'], body: message, htmlBody: html_(message) });
        status = 'Sent ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, HH:mm');
      } catch (err) {
        status = 'Failed: ' + String(err && err.message ? err.message : err).slice(0, 120);
      }
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sheet_(TAB_ORDERS).appendRow([new Date(), name, email, city, country, format, copies, status]);
  } finally {
    lock.releaseLock();
  }

  var summary = 'Name: ' + name + '\nEmail: ' + email + '\nCity: ' + city + '\nCountry: ' + country +
    '\nFormat: ' + format + '\nCopies: ' + copies + '\nThank-you email: ' + status;
  if (owner) {
    MailApp.sendEmail({
      to: owner,
      replyTo: email,
      subject: 'New pre-order: ' + name + ' (' + copies + (copies === 1 ? ' copy' : ' copies') + ')',
      body: 'A new pre-order for A Book About Voice.\n\n' + summary + '\n\nYour full list: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
  }
  slack_(s, ':books: *New pre-order for A Book About Voice*\n' + summary);
}

/** The thank-you wording, with the weekly tips line left out (and the list renumbered) if no link is set. */
function thankYouText_(s, name) {
  var tips = String(s['Weekly tips sign-up link (Kit)'] || '').trim();
  var number = 0;
  return String(s['Thank-you message']).split(/\n\n/).filter(function (para) {
    return tips || para.indexOf('{tips}') === -1;
  }).map(function (para) {
    return /^\d+\. /.test(para) ? para.replace(/^\d+\. /, (++number) + '. ') : para;
  }).join('\n\n').replace(/\{tips\}/g, tips).replace(/\{name\}/g, String(name).replace(/^'/, '').split(' ')[0]);
}

function slack_(s, text) {
  var hook = String(s['Slack webhook link (optional)'] || '').trim();
  if (hook.indexOf('https://hooks.slack.com/') !== 0) return;
  try {
    UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
  } catch (err) {}
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

/** Runs every morning at 8. Sends the report daily, or only on Mondays, depending on Settings. */
function scheduledReport() {
  setUp_();
  var s = settings_();
  if (!isYes_(s['Send me a report (yes or no)'])) return;
  var daily = String(s['How often (daily or weekly)']).trim().toLowerCase().indexOf('d') === 0;
  if (!daily && new Date().getDay() !== 1) return;
  report_(daily ? 1 : 7);
}

/** Pick this in the menu above and press Run to get the report in your inbox right now. */
function sendReportNow() {
  setUp_();
  report_(7);
}

function report_(days) {
  var s = settings_();
  var since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  var period = days === 1 ? 'last 24 hours' : 'last ' + days + ' days';

  var visits = 0, views = 0, clicks = {}, pages = {}, sources = {};
  rows_(TAB_ACTIVITY).forEach(function (r) {
    if (!(r[0] instanceof Date) || r[0] < since) return;
    if (r[1] === 'Visit') { visits++; views++; bump_(sources, r[4] || 'Typed the address or unknown'); bump_(pages, r[3]); }
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

  var headline = 'Visits: ' + visits + '\n' +
    'Pages viewed: ' + views + '\n' +
    'Book pre-orders: ' + orders + ' (' + copies + ' copies). All time: ' + total + '\n' +
    'Book a call clicks: ' + (clicks['Book a call'] || 0) + '\n' +
    'Email clicks: ' + (clicks['Email Jess'] || 0);
  var link = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  var body = 'Your website, ' + period + '\n\n' + headline + '\n\n' +
    'All button clicks\n' + (list_(clicks) || '  None yet') + '\n\n' +
    'Most viewed pages\n' + (list_(pages) || '  None yet') + '\n\n' +
    'Where visitors came from\n' + (list_(sources) || '  None yet') + '\n\n' +
    (orderLines.length ? 'New pre-orders\n' + orderLines.join('\n') + '\n\n' : '') +
    'Open the full sheet: ' + link;

  if (s['Send alerts to']) {
    MailApp.sendEmail({ to: s['Send alerts to'], subject: 'Your website, ' + period + ': ' + visits + ' visits, ' + orders + ' pre-orders', body: body });
  }
  slack_(s, ':bar_chart: *Your website, ' + period + '*\n' + headline + '\n\n*Top clicks*\n' + (list_(clicks) || '  None yet') + '\n\n<' + link + '|Open the full sheet>');
}

function bump_(map, key) { key = key || 'Unknown'; map[key] = (map[key] || 0) + 1; }

function list_(map) {
  return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, 12)
    .map(function (k) { return '  ' + k + ': ' + map[k]; }).join('\n');
}

/* ---------- set-up and helpers ---------- */

function setUp_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ready') === VERSION) return;
  var titles = ['Date', 'Name', 'Email', 'City', 'Country', 'Format', 'Copies', 'Thank-you email'];
  var orders = sheet_(TAB_ORDERS);
  orders.getRange(1, 1, 1, titles.length).setValues([titles]);
  style_(orders, titles.length, [150, 160, 240, 130, 150, 190, 70, 260]);
  var activity = sheet_(TAB_ACTIVITY);
  activity.getRange(1, 1, 1, 5).setValues([['Date', 'Type', 'What', 'Page', 'Came from']]);
  style_(activity, 5, [150, 100, 220, 260, 220]);

  // Settings: keep what is already there, add any new rows, and refresh the thank-you wording if it is the old one.
  var settings = sheet_(TAB_SETTINGS);
  var existing = {};
  if (settings.getLastRow() > 0) {
    settings.getRange(1, 1, settings.getLastRow(), 2).getValues().forEach(function (r, i) { existing[String(r[0]).trim()] = i + 1; });
  }
  var renamed = { 'Weekly summary (yes or no)': 'Send me a report (yes or no)' };
  Object.keys(renamed).forEach(function (old) {
    if (existing[old] && !existing[renamed[old]]) { settings.getRange(existing[old], 1).setValue(renamed[old]); existing[renamed[old]] = existing[old]; }
  });
  DEFAULT_SETTINGS.forEach(function (pair) {
    if (!existing[pair[0]]) settings.appendRow(pair);
  });
  var row = existing['Thank-you message'];
  if (row && String(settings.getRange(row, 2).getValue()).indexOf('{tips}') === -1) settings.getRange(row, 2).setValue(THANK_YOU);
  settings.getRange(1, 1, settings.getLastRow(), 1).setFontWeight('bold').setVerticalAlignment('top');
  settings.getRange(1, 2, settings.getLastRow(), 1).setWrap(true).setVerticalAlignment('top');
  settings.setColumnWidth(1, 300);
  settings.setColumnWidth(2, 620);

  summary_();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklySummary' || t.getHandlerFunction() === 'scheduledReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledReport').timeBased().everyDays(1).atHour(8).create();
  props.setProperty('ready', VERSION);
}

function style_(sheet, columns, widths) {
  sheet.getRange(1, 1, 1, columns).setFontWeight('bold').setBackground('#2D2A3E').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

/** A simple at-a-glance page that updates itself. */
function summary_() {
  var sheet = sheet_(TAB_SUMMARY);
  sheet.clear();
  var week = '">="&TODAY()-7';
  var rows = [
    ['Your website at a glance', ''],
    ['', ''],
    ['BOOK PRE-ORDERS', ''],
    ['Pre-orders so far', "=COUNTA('Pre-orders'!B2:B)"],
    ['Copies wanted', "=SUM('Pre-orders'!G2:G)"],
    ['Want a physical copy', "=COUNTIF('Pre-orders'!F2:F,\"*Physical*\")"],
    ['Want the audiobook', "=COUNTIF('Pre-orders'!F2:F,\"*Audiobook*\")"],
    ['Want the PDF', "=COUNTIF('Pre-orders'!F2:F,\"*PDF*\")"],
    ['Thank-you emails sent', "=COUNTIF('Pre-orders'!H2:H,\"Sent*\")"],
    ['Thank-you emails not sent', "=COUNTA('Pre-orders'!H2:H)-COUNTIF('Pre-orders'!H2:H,\"Sent*\")"],
    ['', ''],
    ['LAST 7 DAYS', ''],
    ['Visits', '=COUNTIFS(Activity!B2:B,"Visit",Activity!A2:A,' + week + ')'],
    ['Pages viewed', '=COUNTIFS(Activity!B2:B,"Visit",Activity!A2:A,' + week + ')+COUNTIFS(Activity!B2:B,"Page view",Activity!A2:A,' + week + ')'],
    ['Book a call clicks', '=COUNTIFS(Activity!C2:C,"Book a call",Activity!A2:A,' + week + ')'],
    ['Email clicks', '=COUNTIFS(Activity!C2:C,"Email Jess",Activity!A2:A,' + week + ')'],
    ['Voxa app clicks', '=COUNTIFS(Activity!C2:C,"Voxa app",Activity!A2:A,' + week + ')'],
    ['Pre-orders sent', '=COUNTIFS(Activity!C2:C,"Pre-order sent",Activity!A2:A,' + week + ')'],
    ['', ''],
    ['ALL TIME', ''],
    ['Visits', '=COUNTIF(Activity!B2:B,"Visit")'],
    ['Button and link clicks', '=COUNTIF(Activity!B2:B,"Click")']
  ];
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1).setFontSize(18).setFontWeight('bold');
  [3, 12, 20].forEach(function (r) { sheet.getRange(r, 1, 1, 2).setFontWeight('bold').setBackground('#FFCE00'); });
  sheet.getRange(4, 2, rows.length, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 140);
  sheet.setFrozenRows(1);
}

/** Run this once by hand after pasting the code. It creates the tabs and the morning report. */
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

/** Turn the plain message into a simple email with tappable links. */
function html_(text) {
  var safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  safe = safe.replace(/(https?:\/\/[^\s<]+[^\s<.,!?)])/g, '<a href="$1">$1</a>');
  safe = safe.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '<a href="mailto:$1">$1</a>');
  return '<div style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #2D2A3E">' + safe.replace(/\n/g, '<br>') + '</div>';
}

/** Trim, cap the length, and stop anything being read as a spreadsheet formula. */
function clean_(value, max) {
  var text = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
