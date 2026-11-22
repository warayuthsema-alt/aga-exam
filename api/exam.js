// POST /api/exam  body: {"action": "init|options|start|submit", "args": [...]}
const svc = require('../lib/service');
const { UserError } = require('../lib/logic');

const ROUTES = { init: svc.init, options: svc.options, start: svc.start, submit: svc.submit };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const fn = ROUTES[body.action];
    if (!fn) throw new UserError('ไม่รู้จักคำสั่ง');
    const data = await fn.apply(null, Array.isArray(body.args) ? body.args.slice(0, 4) : []);
    res.status(200).json({ ok: true, data });
  } catch (e) {
    if (e instanceof UserError) return res.status(200).json({ ok: false, error: e.message });
    console.error(e);
    res.status(500).json({ ok: false, error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ' });
  }
};
