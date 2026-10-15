/**
 * ALIENS Activity Dashboard — Google Apps Script backend
 * No credentials or spreadsheet IDs are hard-coded here.
 *
 * Setup:
 * 1) Create a standalone Apps Script project under the account that can read the source sheets.
 * 2) Paste this file into Code.gs and save.
 * 3) Run setup() once and authorize it.
 * 4) Add source spreadsheet IDs with registerSource("PR", "SPREADSHEET_ID").
 * 5) Deploy as Web app only after reviewing access settings. Public dashboard returns aggregates only.
 *
 * IMPORTANT: Do not use a public web-app deployment for admin writes until admin
 * authentication is configured and tested. This starter exposes read-only data only.
 */
const CONFIG_KEY = 'ALIENS_SOURCES_V1';

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(CONFIG_KEY)) props.setProperty(CONFIG_KEY, JSON.stringify([]));
  Logger.log('ALIENS backend initialized. Register source spreadsheets with registerSource().');
}

/** Register a spreadsheet by ID. Optionally specify a tab name. */
function registerSource(committeeName, spreadsheetId, sheetName) {
  if (!committeeName || !spreadsheetId) throw new Error('Committee name and spreadsheet ID are required.');
  const ss = SpreadsheetApp.openById(String(spreadsheetId).trim());
  const source = {
    committee: String(committeeName).trim(),
    spreadsheetId: String(spreadsheetId).trim(),
    sheetName: sheetName ? String(sheetName).trim() : '',
    enabled: true
  };
  const list = getSources().filter(x => x.committee.toLowerCase() !== source.committee.toLowerCase());
  list.push(source);
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEY, JSON.stringify(list));
  return { ok: true, committee: source.committee, spreadsheetName: ss.getName(), tabs: ss.getSheets().map(s => s.getName()) };
}

/** Remove a registered source by committee name. */
function unregisterSource(committeeName) {
  const list = getSources().filter(x => x.committee.toLowerCase() !== String(committeeName).toLowerCase());
  PropertiesService.getScriptProperties().setProperty(CONFIG_KEY, JSON.stringify(list));
  return { ok: true, remaining: list.length };
}

function getSources() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CONFIG_KEY) || '[]'); }
  catch (e) { return []; }
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action ? e.parameter.action : 'dashboard';
  if (action === 'health') return json_({ ok: true, service: 'ALIENS Dashboard API', version: 1 });
  if (action === 'schema') return json_({ ok: true, sources: getSchemaReport_() });
  if (action === 'dashboard') return json_(buildDashboardData_());
  return json_({ ok: false, error: 'Unknown action' });
}

function buildDashboardData_() {
  const sources = getSources().filter(s => s.enabled);
  const committees = [];
  const errors = [];
  sources.forEach(source => {
    try {
      const ss = SpreadsheetApp.openById(source.spreadsheetId);
      const sheets = source.sheetName
        ? [ss.getSheetByName(source.sheetName)].filter(Boolean)
        : ss.getSheets();
      if (!sheets.length) throw new Error('No data sheet found');
      const tabs = sheets.map(sheet => {
        const parsed = parseSheet_(sheet.getDataRange().getDisplayValues(), source.committee, sheet.getName());
        return {
          sheetName: sheet.getName(),
          rowCount: parsed.rows.length,
          headers: parsed.headers,
          fields: parsed.fields,
          metrics: parsed.metrics
        };
      });
      committees.push({
        committee: source.committee,
        sourceName: ss.getName(),
        rowCount: tabs.reduce((sum, tab) => sum + tab.rowCount, 0),
        tabs: tabs
      });
    } catch (err) {
      errors.push({ committee: source.committee, error: String(err.message || err) });
    }
  });
  // Public responses contain schema and aggregate metrics only, never raw spreadsheet rows.
  return { ok: true, generatedAt: new Date().toISOString(), committees: committees, errors: errors };
}

function getSchemaReport_() {
  return getSources().map(source => {
    try {
      const ss = SpreadsheetApp.openById(source.spreadsheetId);
      const tabs = ss.getSheets().map(sheet => {
        const values = sheet.getDataRange().getDisplayValues();
        const parsed = parseSheet_(values, source.committee, sheet.getName());
        return { sheetName: sheet.getName(), headers: parsed.headers, inferredFields: parsed.fields, rowCount: parsed.rows.length };
      });
      return { committee: source.committee, spreadsheetName: ss.getName(), tabs: tabs };
    } catch (err) {
      return { committee: source.committee, error: String(err.message || err) };
    }
  });
}

function chooseDataSheet_(ss) {
  const sheets = ss.getSheets();
  let best = null, bestScore = -1;
  sheets.forEach(sheet => {
    const values = sheet.getDataRange().getDisplayValues();
    const parsed = parseSheet_(values, '', sheet.getName());
    const score = parsed.headers.length * 2 + parsed.rows.length;
    if (score > bestScore) { best = sheet; bestScore = score; }
  });
  return best;
}

function parseSheet_(matrix, committee, sheetName) {
  const nonEmpty = (matrix || []).filter(row => row.some(cell => String(cell || '').trim() !== ''));
  if (!nonEmpty.length) return { headers: [], fields: {}, rows: [], metrics: {} };
  const headerIndex = detectHeaderRow_(nonEmpty);
  const headers = (nonEmpty[headerIndex] || []).map((h, i) => String(h || '').trim() || ('Column ' + (i + 1)));
  const fields = {};
  headers.forEach((header, index) => {
    const field = inferField_(header);
    if (field && !fields[field]) fields[field] = { column: index, header: header };
  });
  const rows = nonEmpty.slice(headerIndex + 1).map((line, index) => {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = line[i] == null ? '' : line[i]; });
    obj._committee = committee;
    obj._sheet = sheetName;
    obj._row = index + headerIndex + 2;
    obj._normalized = {};
    Object.keys(fields).forEach(field => obj._normalized[field] = line[fields[field].column] || '');
    return obj;
  }).filter(row => Object.keys(row).some(k => !k.startsWith('_') && String(row[k] || '').trim() !== ''));
  const metrics = {
    recordCount: rows.length,
    uniqueOrganizations: uniqueCount_(rows, fields.organization, headers),
    followUpsOverdue: countOverdue_(rows, fields),
    statusBreakdown: breakdown_(rows, fields.status),
    outcomeBreakdown: breakdown_(rows, fields.outcome),
    reportTypeBreakdown: breakdown_(rows, fields.reportType),
    numericTotals: numericTotals_(rows, headers)
  };
  return { headers: headers, fields: fields, rows: rows, metrics: metrics };
}

function detectHeaderRow_(matrix) {
  const limit = Math.min(matrix.length, 12);
  let bestIndex = 0, bestScore = -1;
  for (let r = 0; r < limit; r++) {
    const filled = matrix[r].filter(v => String(v || '').trim()).length;
    const semantic = matrix[r].filter(v => inferField_(String(v || ''))).length;
    const score = filled + semantic * 3;
    if (score > bestScore) { bestScore = score; bestIndex = r; }
  }
  return bestIndex;
}

function normalizeText_(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function inferField_(header) {
  const h = normalizeText_(header);
  const rules = [
    ['date', /(^date$|^timestamp$|التاريخ|تاريخ الارسال|وقت الارسال|submission date|created at)/],
    ['event', /(event name|event|campaign|الفعاليه|الحدث|الحمله)/],
    ['organization', /(company|organization|institution|partner|الجهه|الشركه|المؤسسه|اسم المنظمه)/],
    ['contactPerson', /(contact person|person name|اسم الشخص|مسؤول التواصل)/],
    ['position', /(position|job title|المنصب|الوظيفه)/],
    ['email', /(^email$|e mail|البريد الالكتروني)/],
    ['phone', /(phone|mobile|telephone|رقم الهاتف|رقم التليفون)/],
    ['contactType', /(contact type|نوع التواصل|نوع الجهه)/],
    ['channel', /(communication channel|channel|قناه التواصل|وسيله التواصل)/],
    ['contactDate', /(contact date|تاريخ التواصل)/],
    ['followUpDate', /(follow up date|followup date|موعد المتابعه|تاريخ المتابعه)/],
    ['status', /(^status$|الحاله|حاله التواصل|حاله الطلب)/],
    ['outcome', /(^outcome$|النتيجه|نتيجه التواصل)/],
    ['rejectionReason', /(rejection reason|سبب الرفض|اسباب الرفض)/],
    ['notes', /(^notes?$|ملاحظات|تفاصيل اضافيه)/],
    ['reportType', /(report type|نوع التقرير)/],
    ['interactions', /(interactions?|engagements?|shares?|number of shares|عدد المشاركات|المشاركات|التفاعلات|التفاعل)/],
    ['followers', /(new followers|followers gained|متابعين جدد|المتابعين الجدد)/],
    ['messages', /(messages?|الرسائل|عدد الرسائل)/],
    ['reach', /(^reach$|الوصول|مدي الوصول)/],
    ['tasks', /(tasks completed|completed tasks|المهام المكتمله)/],
    ['target', /(^target$|goal|المستهدف|الهدف)/]
  ];
  for (const rule of rules) if (rule[1].test(h)) return rule[0];
  return '';
}

function uniqueCount_(rows, field, headers) {
  if (!field) return null;
  const values = rows.map(r => String(r[headers[field.column]] || '').trim().toLowerCase()).filter(Boolean);
  return new Set(values).size;
}

function countOverdue_(rows, fields) {
  if (!fields.followUpDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const statusColumn = fields.status ? fields.status.column : -1;
  return rows.filter(row => {
    const raw = row[fields.followUpDate.header];
    const d = new Date(raw);
    if (!raw || isNaN(d) || d >= today) return false;
    const status = statusColumn >= 0 ? normalizeText_(row[fields.status.header]) : '';
    return !/(complete|closed|done|rejected|مكتمل|مغلق|تم|مرفوض)/.test(status);
  }).length;
}

function breakdown_(rows, field) {
  if (!field) return null;
  const result = {};
  rows.forEach(row => {
    const value = String(row[field.header] || '').trim() || '(blank)';
    result[value] = (result[value] || 0) + 1;
  });
  return result;
}

function numericTotals_(rows, headers) {
  const totals = {};
  headers.forEach(header => {
    const values = rows.map(r => String(r[header] || '').replace(/[, %]/g, '').trim());
    const nonEmpty = values.filter(v => v !== '');
    if (nonEmpty.length && nonEmpty.every(v => /^-?\d+(\.\d+)?$/.test(v))) {
      totals[header] = values.reduce((sum, v) => sum + (v === '' ? 0 : Number(v)), 0);
    }
  });
  return totals;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
