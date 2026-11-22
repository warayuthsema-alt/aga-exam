// ทดสอบระบบทั้งหมดกับ Google Sheets API จำลอง (ไม่แตะชีตจริง)  – node test/run.js
const assert = require('assert');
const Module = require('module');

// ---- stub google-auth-library ----
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'google-auth-library') return { JWT: class { async getAccessToken() { return { token: 't' }; } }, ExternalAccountClient: {} };
  if (req === '@vercel/oidc') return { getVercelOidcToken: async () => 'x' };
  return origLoad.call(this, req, ...a);
};
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y', private_key: 'k' });
process.env.SHEET_ID = 'SHEET';
process.env.SESSION_SECRET = 'test-secret-1234567890';

// ---- fake spreadsheet ----
let nextId = 100;
const book = {}; // title -> {id, rows}
const addTab = (title, rows) => (book[title] = { id: nextId++, rows: rows.map(r => r.slice()) });
const col = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
function parseRange(r) {
  const m = r.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  if (!m) throw new Error('bad range ' + r);
  return { tab: m[1].replace(/''/g, "'"), c1: col(m[2]), r1: m[3] ? +m[3] - 1 : 0, c2: m[4] ? col(m[4]) : col(m[2]), r2: m[5] ? +m[5] - 1 : (m[3] && !m[4] ? +m[3] - 1 : Infinity) };
}
const toSerial = s => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 864e5 + 25569 : null;
};
const entered = v => (typeof v === 'string' ? (v.startsWith("'") ? v.slice(1) : (toSerial(v) ?? v)) : v);
function setCell(t, r, c, v) { while (t.rows.length <= r) t.rows.push([]); const row = t.rows[r]; while (row.length <= c) row.push(''); row[c] = v; }
function get(range) {
  const p = parseRange(range), t = book[p.tab];
  if (!t) throw Object.assign(new Error('no tab'), { code: 400 });
  const out = [];
  for (let r = p.r1; r < Math.min(t.rows.length, p.r2 + 1); r++) out.push((t.rows[r] || []).slice(p.c1, p.c2 + 1));
  while (out.length && out[out.length - 1].every(x => x === '' || x === undefined)) out.pop();
  return out;
}
const calls = [];
global.fetch = async (url, opt = {}) => {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname.replace('/v4/spreadsheets/SHEET', ''));
  const method = opt.method || 'GET';
  const body = opt.body ? JSON.parse(opt.body) : null;
  calls.push(method + ' ' + path);
  const ok = j => ({ ok: true, json: async () => j });
  try {
    if (method === 'GET' && path === '') return ok({ sheets: Object.entries(book).map(([title, t]) => ({ properties: { sheetId: t.id, title } })) });
    if (method === 'GET' && path === '/values:batchGet') return ok({ valueRanges: u.searchParams.getAll('ranges').map(r => ({ values: get(r) })) });
    if (method === 'POST' && path.endsWith(':append')) {
      const p = parseRange(path.slice(8, -7)), t = book[p.tab];
      let last = -1; t.rows.forEach((row, i) => { if (row.slice(p.c1, p.c2 + 1).some(x => x !== '' && x !== undefined)) last = i; });
      body.values[0].forEach((v, j) => setCell(t, last + 1, p.c1 + j, entered(v)));
      return ok({});
    }
    if (method === 'PUT' && path.startsWith('/values/')) {
      const p = parseRange(path.slice(8)), t = book[p.tab];
      body.values.forEach((row, i) => row.forEach((v, j) => setCell(t, p.r1 + i, p.c1 + j, entered(v))));
      return ok({});
    }
    if (method === 'POST' && path === ':batchUpdate') {
      for (const rq of body.requests) {
        if (rq.addSheet) { if (book[rq.addSheet.properties.title]) throw new Error('already exists'); addTab(rq.addSheet.properties.title, []); }
        else if (rq.duplicateSheet) {
          const src = Object.values(book).find(t => t.id === rq.duplicateSheet.sourceSheetId);
          if (book[rq.duplicateSheet.newSheetName]) throw new Error('already exists');
          addTab(rq.duplicateSheet.newSheetName, src.rows);
        } else if (rq.insertDimension) {
          const t = Object.values(book).find(x => x.id === rq.insertDimension.range.sheetId);
          const { startIndex, endIndex } = rq.insertDimension.range;
          t.rows.forEach(r => { while (r.length < startIndex) r.push(''); r.splice(startIndex, 0, ...Array(endIndex - startIndex).fill('')); });
        }
      }
      return ok({});
    }
    throw new Error('unhandled ' + method + ' ' + path);
  } catch (e) {
    return { ok: false, status: 400, json: async () => ({ error: { message: e.message } }) };
  }
};

// ---- data ----
const cats = {
  'การจัดการแมลงสาบ': 'แมลงสาบ', 'การจัดการหนู': 'หนู', 'การจัดการมด': 'มด', 'การจัดการปลวก': 'ปลวก', 'ระบบเหยื่อปลวกและผลิตภัณฑ์': 'ปลวก',
  'การจัดการแมลงวันและยุง': 'ยุง', 'เครื่องดักแมลง': 'แมลงวัน', 'การจัดการจิ้งจกและงู': 'จิ้งจก', 'สารเคมีและอัตราส่วนผสม': '',
  'SOP อุปกรณ์และ Layout': '', 'สัญญาและงานบริการ AGA': '', 'พื้นฐานและสัตว์รบกวน': ''
};
const catList = Object.keys(cats);
const bank = [['ข้อที่', 'หมวดหมู่', 'แหล่งอ้างอิง', 'คำถาม', 'ก', 'ข', 'ค', 'ง', 'เฉลย', 'คำอธิบาย']];
const fmts = ['ก', 'B', '3', 'opt3'];
for (let i = 1; i <= 141; i++) bank.push([i, catList[i % catList.length], 'ref', 'Q' + i, 'opt0', 'opt1', 'opt2', 'opt3', fmts[i % 4], 'exp' + i]);
const H = ['วันเวลาที่ส่ง', 'รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'สาขา', 'คะแนนที่ได้', 'คะแนนเต็ม', 'เปอร์เซ็นต์ (%)', 'ผลการประเมิน (ผ่าน 80%)', 'ชุดข้อสอบที่สุ่มได้', 'ด้านที่ควรพัฒนาเพิ่มเติม (จุดอ่อน)'];
addTab('สรุปผลสอบรวม', [[...H, '', 'KPI', 'ค่า'], ['', '', '', '', '', '', '', '', '', '', '', '', 'ผู้เข้าสอบ', '=COUNTA(B2:B1000)'], ['', '', '', '', '', '', '', '', '', '', '', '', 'ผ่าน', '=COUNTIF(I2:I1000,"ผ่าน")']]);
addTab('แม่แบบ_แท็บสาขา', [H]);
addTab('คลังข้อสอบ_100ข้อ', bank);
addTab('ลาดพร้าว', [H]);

let NOW = Date.UTC(2027, 0, 8, 3, 0); // ศุกร์ 8 ม.ค. 10:00 น. เวลาไทย
const realNow = Date.now; Date.now = () => NOW;
const setBkk = (y, m, d, h) => { NOW = Date.UTC(y, m, d, h - 7); };

const svc = require('../lib/service');
const api = require('../api/exam');
const callApi = (action, args) => new Promise(resolve => {
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(j) { resolve({ code: this.statusCode, ...j }); } };
  api({ method: 'POST', body: JSON.stringify({ action, args }) }, res);
});

(async () => {
  // setup ×2 (idempotent)
  console.log(await svc.setup());
  console.log(await svc.setup());
  const sum = book['สรุปผลสอบรวม'].rows;
  assert.equal(sum[0][11], 'โหมดสอบ'); assert.equal(sum[0][15], 'KPI');
  assert.equal(book['ลาดพร้าว'].rows[0][13], 'สลับหน้าจอ (ครั้ง)');
  assert.ok(book['แผนอบรมรายสัปดาห์'] && book['สรุปรายสัปดาห์']);
  assert.equal(typeof book['แผนอบรมรายสัปดาห์'].rows[1][1], 'number', 'plan dates stored as dates');
  const b = book['คลังข้อสอบ_100ข้อ'].rows;
  for (let i = 1; i < b.length; i++) { setCell(book['คลังข้อสอบ_100ข้อ'], i, 10, cats[b[i][1]]); setCell(book['คลังข้อสอบ_100ข้อ'], i, 11, i % 7 === 0 ? 'Y' : ''); }

  const emp = { empId: 'aga0123', firstName: 'สมชาย', lastName: 'ใจดี', branch: 'ลาดพร้าว' };
  let r = await callApi('init', []);
  assert.ok(r.ok, r.error); assert.equal(r.data.week.week, 1); assert.equal(r.data.week.end, '8 ม.ค. 2570');
  assert.ok(r.data.branches.includes('ลาดพร้าว'));

  r = await callApi('options', [emp]);
  console.log('W1:', r.data.map(o => `${o.mode}/${o.week}/${o.available}`).join(' | '));
  assert.ok(r.data.find(o => o.mode === 'รายสัปดาห์' && o.available));

  r = await callApi('start', [emp, 'รายสัปดาห์', 1]);
  assert.ok(r.ok, r.error);
  const ex = r.data;
  assert.equal(ex.questions.length, 10);
  assert.ok(!JSON.stringify(ex.questions).includes('"ans"'), 'no answer key to client');
  assert.ok(!ex.token.includes('การจัดการ'), 'token is encrypted');
  const sess = require('../lib/logic').unseal(ex.token);
  assert.ok(sess.qs.filter(q => q.cat === 'การจัดการแมลงสาบ').length >= 6);
  assert.ok(sess.qs.every(q => q.ans >= 0));
  sess.qs.forEach(q => assert.equal(q.choices[q.ans], 'opt' + ((+q.id) % 4), 'answer follows shuffle'));
  assert.ok(sess.qs.some(q => q.choices.join() !== 'opt0,opt1,opt2,opt3'), 'choices shuffled');
  const ans = {}; sess.qs.forEach((q, i) => (ans[q.id] = i < 7 ? q.ans : (q.ans + 1) % 4));
  r = await callApi('submit', [ex.token, ans, 2]);
  assert.ok(r.ok, r.error); assert.equal(r.data.score, 7); assert.equal(r.data.pass, false);
  console.log('result', r.data.score, r.data.percent, r.data.weak.map(w => w.cat));
  r = await callApi('submit', [ex.token, ans, 2]);
  assert.equal(r.ok, false); assert.match(r.error, /ส่งคำตอบของรอบนี้ไปแล้ว/);
  const row = sum.find(x => x[1] === 'AGA0123');
  assert.equal(sum.indexOf(row), 1, 'row 2, KPI untouched');
  assert.equal(row[11], 'รายสัปดาห์'); assert.equal(row[12], 1); assert.equal(row[13], 2);
  assert.equal(typeof row[0], 'number', 'timestamp is a date');
  assert.equal(sum[1][15], 'ผู้เข้าสอบ', 'KPI still in P');
  assert.ok(book['ลาดพร้าว'].rows.some(x => x[1] === 'AGA0123'));

  r = await callApi('start', [emp, 'รายสัปดาห์', 1]);
  assert.equal(r.ok, false);

  setBkk(2027, 0, 11, 9); // จันทร์ สอบซ่อม
  r = await callApi('options', [emp]);
  console.log('Mon:', r.data.map(o => `${o.mode}/${o.week}/${o.available}`).join(' | '));
  r = await callApi('start', [emp, 'สอบซ่อม', 1]);
  const s2 = require('../lib/logic').unseal(r.data.token);
  const all = {}; s2.qs.forEach(q => (all[q.id] = q.ans));
  r = await callApi('submit', [r.data.token, all, 0]);
  assert.equal(r.data.pass, true);
  r = await callApi('options', [emp]);
  assert.ok(!r.data.find(o => o.mode === 'สอบซ่อม' && o.available));
  assert.ok(r.data.find(o => o.mode === 'รายสัปดาห์' && o.week === 2 && o.available));

  setBkk(2027, 0, 8, 18); // หลังปิด 17:00 ของสัปดาห์ 1 → ผู้ไม่เคยสอบ
  r = await callApi('options', [{ ...emp, empId: 'NEW1' }]);
  assert.ok(r.data.find(o => o.mode === 'รายสัปดาห์' && o.week === 1 && !o.available && o.status === 'หมดเวลา'));

  setBkk(2027, 2, 10, 9);
  r = await callApi('start', [emp, 'Post-test', 10]);
  assert.ok(r.ok, r.error); assert.ok(r.data.questions.filter(q => q.hasImage).length >= 3);

  setBkk(2027, 5, 1, 9);
  const e2 = { empId: 'B1', firstName: '=HYPERLINK("x")', lastName: 'x', branch: 'สาขาใหม่' };
  r = await callApi('start', [e2, 'มาตรฐาน', '']);
  assert.ok(r.ok, r.error);
  r = await callApi('submit', [r.data.token, {}, 0]);
  assert.ok(r.ok, r.error);
  assert.ok(book['สาขาใหม่']); assert.equal(book['สาขาใหม่'].rows[0][13], 'สลับหน้าจอ (ครั้ง)');
  assert.equal(book['สาขาใหม่'].rows[1][2], '=HYPERLINK("x")', 'stored as text, not formula');
  r = await callApi('options', [e2]);
  assert.equal(r.data[0].available, false, 'standard once a day');
  r = await callApi('submit', ['tampered', {}, 0]);
  assert.equal(r.ok, false);
  r = await callApi('options', [{ empId: '' }]);
  assert.equal(r.ok, false);
  Date.now = realNow;
  console.log('ALL TESTS PASSED (' + calls.length + ' API calls)');
})().catch(e => { console.error(e); process.exit(1); });
