// คำสั่งของระบบแบบทดสอบ: init / options / start / submit / setup
const crypto = require('crypto');
const S = require('./sheets');
const L = require('./logic');
const { TAB, MODE, UserError } = L;

const R = {
  bank: S.q(TAB.BANK) + '!A:M',
  plan: S.q(TAB.PLAN) + '!A:L',
  summary: S.q(TAB.SUMMARY) + '!A:N',
  branches: S.q(TAB.BRANCHES) + '!A:A'
};

async function readSafe(ranges, tabTitles) {
  // อ่านเฉพาะช่วงที่แท็บมีอยู่จริง (แท็บที่ไม่มีคืนค่า [])
  const ok = ranges.map(r => tabTitles.includes(r.slice(1, r.indexOf("'!")).replace(/''/g, "'")));
  const got = await S.read(ranges.filter((_, i) => ok[i]));
  let k = 0;
  return ranges.map((_, i) => (ok[i] ? got[k++] : []));
}

async function init() {
  const tabs = await S.tabs();
  const titles = tabs.map(t => t.title);
  const system = Object.values(TAB);
  const others = titles.filter(t => !system.includes(t));
  const [plan, branchList, ...a1] = await readSafe([R.plan, R.branches, ...others.map(t => S.q(t) + '!A1')], titles);
  const names = new Set();
  branchList.slice(1).forEach(r => { const n = L.str(r[0]); if (n) names.add(n); });
  others.forEach((t, i) => { if (L.str(((a1[i] || [])[0] || [])[0]) === L.RESULT_HEADERS[0]) names.add(t); });
  const now = L.bkkNow();
  const cur = L.parsePlan(plan).find(p => p.open && now >= p.start && now <= p.close);
  return {
    branches: [...names].sort((a, b) => a.localeCompare(b, 'th')),
    examSize: L.EXAM_SIZE,
    timeLimitMin: L.TIME_LIMIT_MIN,
    week: cur ? { week: cur.week, pest: cur.pest, start: L.fmtDate(cur.start), end: L.fmtDate(cur.end), material: cur.material } : null
  };
}

async function loadFor(emp, withBank) {
  const titles = (await S.tabs()).map(t => t.title);
  const ranges = [R.plan, R.summary].concat(withBank ? [R.bank] : []);
  const [plan, summary, bank] = await readSafe(ranges, titles);
  return { plan: L.parsePlan(plan), attempts: L.parseAttempts(summary, emp.empId), bank: withBank ? L.parseBank(bank) : null };
}

async function options(emp) {
  emp = L.cleanEmp(emp);
  const d = await loadFor(emp, false);
  return L.buildOptions(d.plan, d.attempts, L.bkkNow());
}

async function start(emp, mode, week) {
  emp = L.cleanEmp(emp);
  const d = await loadFor(emp, true);
  const now = L.bkkNow();
  const o = L.buildOptions(d.plan, d.attempts, now)
    .find(x => x.available && x.mode === mode && String(x.week || '') === String(week || ''));
  if (!o) throw new UserError('ไม่สามารถเริ่มแบบทดสอบนี้ได้ (อาจทำครบสิทธิ์แล้ว หรือหมดเวลาของสัปดาห์)');
  if (d.bank.length < L.EXAM_SIZE) throw new UserError('คลังข้อสอบมีไม่ถึง ' + L.EXAM_SIZE + ' ข้อ');
  const p = o.week ? d.plan.find(x => x.week === o.week) : null;
  const picked = mode === MODE.WEEKLY || mode === MODE.RETEST ? L.pickWeekly(d.bank, d.plan, p) : L.pickStandard(d.bank);
  const session = {
    sid: crypto.randomBytes(6).toString('hex'),
    emp, mode, week: o.week || '', label: o.label, startedAt: Date.now(),
    qs: picked.map(q => ({ id: q.id, cat: q.cat, q: q.q, choices: q.choices, ans: q.ans, exp: q.exp }))
  };
  return {
    token: L.seal(session),
    label: o.label,
    timeLimitSec: L.TIME_LIMIT_MIN * 60,
    questions: picked.map(q => ({ id: q.id, q: q.q, choices: q.choices, img: q.img, hasImage: q.hasImage }))
  };
}

async function submit(token, answers, tabSwitch) {
  const s = L.unseal(token);
  if (Date.now() - s.startedAt > 2 * 3600e3) throw new UserError('รอบสอบนี้หมดอายุแล้ว กรุณาเริ่มใหม่');
  const tabs = await S.tabs();
  const titles = tabs.map(t => t.title);
  const [summary] = await readSafe([R.summary], titles);
  if (L.parseAttempts(summary, s.emp.empId).some(a => a.ids.includes('#' + s.sid))) {
    throw new UserError('ส่งคำตอบของรอบนี้ไปแล้ว');
  }
  const g = L.grade(s.qs, answers || {});
  const row = [
    L.stamp(L.bkkNow()), s.emp.empId, s.emp.firstName, s.emp.lastName, s.emp.branch,
    g.score, g.total, g.percent, g.pass ? 'ผ่าน' : 'ไม่ผ่าน',
    s.qs.map(q => q.id).join(', ') + ' #' + s.sid,
    g.weak.map(w => w.cat + ' (' + w.correct + '/' + w.total + ')').join(' | ') || '-',
    s.mode, s.week, Math.max(0, Math.min(999, Number(tabSwitch) || 0))
  ];
  await S.append(TAB.SUMMARY, row);
  const branchTab = await ensureBranchTab(s.emp.branch, tabs);
  await S.append(branchTab, row);
  return {
    label: s.label, score: g.score, total: g.total, percent: g.percent, pass: g.pass,
    weak: g.weak, review: g.review,
    elapsedMin: Math.round((Date.now() - s.startedAt) / 6000) / 10
  };
}

async function ensureBranchTab(branch, tabs) {
  const name = String(branch).replace(/^'/, '').replace(/[\[\]\*\?\/\\:']/g, ' ').trim().slice(0, 90) || 'ไม่ระบุสาขา';
  if (tabs.some(t => t.title === name)) return name;
  const tpl = tabs.find(t => t.title === TAB.TEMPLATE);
  try {
    await S.batchUpdate([tpl
      ? { duplicateSheet: { sourceSheetId: tpl.sheetId, newSheetName: name, insertSheetIndex: tabs.length } }
      : { addSheet: { properties: { title: name } } }]);
  } catch (e) {
    if (!/already exists|มีอยู่แล้ว/i.test(e.message)) throw e; // มีคนสร้างพร้อมกัน
  }
  await S.write(S.q(name) + '!A1:N1', [L.RESULT_HEADERS]);
  return name;
}

/* ---------- setup: รันครั้งเดียว (รันซ้ำได้) ---------- */
async function setup() {
  const log = [];
  let tabs = await S.tabs();
  const has = t => tabs.some(x => x.title === t);
  const idOf = t => (tabs.find(x => x.title === t) || {}).sheetId;

  if (!has(TAB.PLAN)) {
    await S.batchUpdate([{ addSheet: { properties: { title: TAB.PLAN, gridProperties: { frozenRowCount: 1 } } } }]);
    const C = { chem: 'สารเคมีและอัตราส่วนผสม', sop: 'SOP อุปกรณ์และ Layout', contract: 'สัญญาและงานบริการ AGA', base: 'พื้นฐานและสัตว์รบกวน' };
    const rows = [
      ['สัปดาห์', 'วันเริ่ม', 'วันสิ้นสุด (ศุกร์)', 'สัตว์เป้าหมาย', 'หมวดหลัก', 'หมวดเสริม', 'จำนวนข้อหลัก', 'จำนวนข้อเสริม', 'จำนวนข้อทบทวน', 'ขั้นต่ำข้อภาพ', 'สถานะ', 'ลิงก์สื่อการสอน'],
      [1, '2027-01-04', '2027-01-08', 'แมลงสาบ', 'การจัดการแมลงสาบ', C.chem + ', ' + C.sop, 6, 2, 2, 1, 'เปิด', ''],
      [2, '2027-01-11', '2027-01-15', 'หนู', 'การจัดการหนู', C.chem, 6, 2, 2, 1, 'เปิด', ''],
      [3, '2027-01-18', '2027-01-22', 'มด', 'การจัดการมด', C.chem, 6, 2, 2, 1, 'เปิด', ''],
      [4, '2027-01-25', '2027-01-29', 'ปลวก', 'การจัดการปลวก, ระบบเหยื่อปลวกและผลิตภัณฑ์', C.contract, 6, 2, 2, 1, 'เปิด', ''],
      [5, '2027-02-01', '2027-02-05', 'ยุง', 'การจัดการแมลงวันและยุง', C.sop, 6, 2, 2, 1, 'เปิด', ''],
      [6, '2027-02-08', '2027-02-12', 'แมลงวัน', 'การจัดการแมลงวันและยุง, เครื่องดักแมลง', C.sop, 6, 2, 2, 1, 'เปิด', ''],
      [7, '2027-02-15', '2027-02-19', 'จิ้งจก', 'การจัดการจิ้งจกและงู', C.sop, 6, 2, 2, 1, 'เปิด', ''],
      [8, '2027-02-22', '2027-02-26', 'งู', 'การจัดการจิ้งจกและงู, ' + C.base, C.base, 6, 2, 2, 1, 'เปิด', ''],
      [9, '2027-03-01', '2027-03-05', 'ทบทวน', C.chem + ', ' + C.sop, C.contract, 6, 2, 2, 1, 'เปิด', ''],
      [10, '2027-03-08', '2027-03-12', 'Post-test', 'ทั้งหมด', '', 10, 0, 0, 3, 'เปิด', '']
    ];
    await S.write(S.q(TAB.PLAN) + '!A1:L11', rows);
    tabs = await S.tabs();
    await S.batchUpdate([{
      repeatCell: {
        range: { sheetId: idOf(TAB.PLAN), startRowIndex: 1, endRowIndex: 11, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    }]);
    log.push('สร้างแท็บ ' + TAB.PLAN);
  }

  const titles = tabs.map(t => t.title);
  const heads = await readSafe([S.q(TAB.BANK) + '!K1:M1', S.q(TAB.SUMMARY) + '!L1', S.q(TAB.TEMPLATE) + '!L1'], titles);
  if (has(TAB.BANK)) {
    const h = (heads[0][0] || []);
    const want = ['สัตว์เป้าหมาย', 'มีภาพ (Y/N)', 'ลิงก์ภาพ (https)'];
    const row = want.map((w, i) => L.str(h[i]) || w);
    await S.write(S.q(TAB.BANK) + '!K1:M1', [row]);
    log.push('ตรวจหัวคอลัมน์ K–M ในคลังข้อสอบ');
  }

  // แทรกคอลัมน์ L–N (ตาราง KPI เดิมเลื่อนไปทางขวา สูตรไม่เสีย)
  for (const [i, t] of [[1, TAB.SUMMARY], [2, TAB.TEMPLATE]]) {
    if (!has(t)) continue;
    if (L.str(((heads[i][0]) || [])[0]) !== L.RESULT_HEADERS[11]) {
      await S.batchUpdate([{ insertDimension: { range: { sheetId: idOf(t), dimension: 'COLUMNS', startIndex: 11, endIndex: 14 }, inheritFromBefore: true } }]);
      await S.write(S.q(t) + '!L1:N1', [L.RESULT_HEADERS.slice(11)]);
      log.push('แทรกคอลัมน์ L–N ในแท็บ ' + t);
    }
  }

  const system = Object.values(TAB);
  const others = titles.filter(t => !system.includes(t));
  if (others.length) {
    const vals = await S.read(others.map(t => S.q(t) + '!A1:N1'));
    for (let i = 0; i < others.length; i++) {
      const r = vals[i][0] || [];
      if (L.str(r[0]) === L.RESULT_HEADERS[0] && !L.str(r[11])) {
        await S.write(S.q(others[i]) + '!L1:N1', [L.RESULT_HEADERS.slice(11)]);
        log.push('เพิ่มหัวคอลัมน์ L–N ในแท็บสาขา ' + others[i]);
      }
    }
  }

  if (!has(TAB.WEEKLY)) {
    await S.batchUpdate([{ addSheet: { properties: { title: TAB.WEEKLY } } }]);
    const src = S.q(TAB.SUMMARY) + '!A:N';
    await S.write(S.q(TAB.WEEKLY) + '!A1', [[
      `=QUERY(${src},"select M, E, count(B), sum(F)/sum(G) where L = 'รายสัปดาห์' or L = 'สอบซ่อม' group by M, E label M 'สัปดาห์', E 'สาขา', count(B) 'จำนวนครั้งที่สอบ', sum(F)/sum(G) 'สัดส่วนตอบถูก'",1)`
    ]]);
    await S.write(S.q(TAB.WEEKLY) + '!F1:F2', [['จำนวนผู้สอบผ่านรายสัปดาห์ (รวมสอบซ่อม)'], [
      `=QUERY(${src},"select M, E, count(B) where (L = 'รายสัปดาห์' or L = 'สอบซ่อม') and I = 'ผ่าน' group by M, E label M 'สัปดาห์', E 'สาขา', count(B) 'จำนวนที่ผ่าน'",1)`
    ]]);
    log.push('สร้างแท็บ ' + TAB.WEEKLY);
  }
  return log.length ? log : ['ไม่มีอะไรต้องเปลี่ยน'];
}

module.exports = { init, options, start, submit, setup };
