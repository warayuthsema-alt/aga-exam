// ทดสอบตรรกะแดชบอร์ดพัฒนาบุคลากร – node test/people.js
const assert = require('assert');
const P = require('../lib/people');
const L = require('../lib/logic');

const now = new Date(Date.UTC(2027, 1, 15, 10)); // 15 ก.พ. 2570
const serial = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5 + 25569;
const roster = [P.ROSTER_HEADERS,
  ['AG-00001', 'นายหัวหน้า เก่ง', 'Leader', serial('2019-01-10'), 'A', 1, 'ลาดพร้าว', 'ทำงาน'],
  ['AG-00002', 'นายช่าง ใหม่', 'Service Technician', serial('2026-12-01'), '', 'S', 'ลาดพร้าว', ''],
  ['AG-00003', 'นายช่าง ดาวรุ่ง', 'Service & Driver', serial('2024-03-01'), 'A', 1, 'ลาดพร้าว', ''],
  ['AG-00004', 'นายลาออก แล้ว', 'Service Technician', serial('2025-01-01'), 'B', 'S', 'ลาดพร้าว', 'ลาออก', serial('2026-12-20'), 'ย้ายบ้าน'],
  ['AG-00005', 'นายแบ่ง ทีม', 'Service Technician', serial('2023-01-01'), 'B', 'S', 'ลาดพร้าว', '']
];
const ratings = [P.RATING_HEADERS,
  [serial('2027-01-20'), 'AG-00003', 'x', 'Sup A', 3, 3, 3, 3, 3, 3, 'อยากเติบโต', 'ต่ำ', 'ขยัน', ''],
  [serial('2027-02-10'), 'ag-00003', 'x', 'Sup A', 4, 3, 3, 3, 3, 4, 'อยากเติบโต', 'ต่ำ', 'ขยัน', 'ให้คุมทีมแทน'],
  [serial('2027-02-10'), 'AG-00002', 'x', 'Sup A', 2, 2, 3, 2, 1, 3, 'ยังไม่แน่ใจ', 'สูง', '', '']
];
const ex = (d, id, pct, weak, mode) => [serial(d) + 0.4, id, 'a', 'b', 'ลาดพร้าว', pct / 10, 10, pct, pct >= 80 ? 'ผ่าน' : 'ไม่ผ่าน', '1, 2 #x', weak || '-', mode || L.MODE.WEEKLY, 1, 0];
const summary = [L.RESULT_HEADERS,
  ex('2027-01-05', '00003', 90), ex('2027-01-12', 'AG-00003', 80, 'การจัดการหนู (1/3)'), ex('2027-01-19', 'AG-00003', 90),
  ex('2027-02-02', 'AG-00003', 100), ex('2027-02-09', 'AG-00003', 80, 'การจัดการหนู (2/3) | การจัดการมด (1/2)'),
  ex('2027-02-09', 'AG-00002', 50, 'การจัดการหนู (0/3)')
];

const d = P.build(roster, ratings, summary, now, '');
assert.strictEqual(d.people.length, 4, 'ไม่นับคนลาออก');
assert.strictEqual(d.branchView.leavers, 1);
const star = d.people.find(p => p.id === 'AG-00003');
assert.strictEqual(star.stage, 1);
assert.strictEqual(star.nextStage, 'หัวหน้าทีม');
assert.strictEqual(star.exam.count, 5);
assert.strictEqual(star.exam.avg, 88);
assert.strictEqual(star.rating.avg, 3.3);
assert.strictEqual(star.rating.prevAvg, 3);
assert.strictEqual(star.status, 'พร้อมเลื่อนขั้น', JSON.stringify(star.criteria));
assert.ok(star.canGrow);
assert.strictEqual(star.exam.weak[0].cat, 'การจัดการหนู');
assert.strictEqual(star.exam.weak[0].wrong, 3);
const nb = d.people.find(p => p.id === 'AG-00002');
assert.strictEqual(nb.risk.level, 'สูง');
assert.ok(nb.needs.some(n => /ยังไม่มีทีมประจำ/.test(n.text)));
assert.ok(nb.needs.some(n => /ภาวะผู้นำ/.test(n.text)));
const lead = d.people.find(p => p.id === 'AG-00001');
assert.strictEqual(lead.stage, 2);
assert.ok(lead.criteria.some(c => c.ok === null), 'ไม่มีข้อมูล = รอข้อมูล');
assert.strictEqual(d.people[0].id, 'AG-00001', 'เรียงขั้นสูงก่อน');
const stuck = d.people.find(p => p.id === 'AG-00005');
assert.ok(stuck.risk.why.some(w => /Lv.S/.test(w)));
const v = d.branchView;
assert.ok(v.gaps.some(g => /Senior Service/.test(g.text)));
assert.ok(!v.gaps.some(g => /ทีมที่ไม่มีหัวหน้าทีม/.test(g.text)), 'ทีมคนเดียวไม่นับ');
assert.strictEqual(v.weak[0].cat, 'การจัดการหนู');
assert.strictEqual(v.stages.find(s => s.stage === 2).count, 1);
assert.strictEqual(P.idKey('ag 00003'), P.idKey('3'));
console.log('people OK', v.gaps.length, 'gaps;', d.people.map(p => p.id + ':' + p.status + '/' + p.risk.level).join(' '));
