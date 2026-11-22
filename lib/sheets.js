// เชื่อม Google Sheets API ด้วย Service Account
const { JWT } = require('google-auth-library');

let client;
function auth() {
  if (client) return client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_JSON');
  const j = JSON.parse(raw);
  client = new JWT({ email: j.client_email, key: j.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return client;
}

const sheetId = () => {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า SHEET_ID');
  return id;
};

async function call(path, { method = 'GET', body, query } = {}) {
  const { token } = await auth().getAccessToken();
  const qs = query ? '?' + query.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}${qs}`, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google Sheets: ' + ((j.error && j.error.message) || r.status));
  return j;
}

const q = tab => "'" + String(tab).replace(/'/g, "''") + "'";

/** รายชื่อแท็บ: [{sheetId, title}] */
async function tabs() {
  const j = await call('', { query: [['fields', 'sheets.properties(sheetId,title)']] });
  return (j.sheets || []).map(s => s.properties);
}

/** อ่านหลายช่วงพร้อมกัน (ค่าดิบ วันที่เป็น serial number) */
async function read(ranges) {
  const query = ranges.map(r => ['ranges', r]);
  query.push(['valueRenderOption', 'UNFORMATTED_VALUE'], ['dateTimeRenderOption', 'SERIAL_NUMBER']);
  const j = await call('/values:batchGet', { query });
  return (j.valueRanges || []).map(v => v.values || []);
}

/** ต่อแถวท้ายตาราง (ปลอดภัยเมื่อหลายคนส่งพร้อมกัน) */
async function append(tab, row) {
  return call(`/values/${encodeURIComponent(q(tab) + '!A:N')}:append`, {
    method: 'POST',
    query: [['valueInputOption', 'USER_ENTERED'], ['insertDataOption', 'INSERT_ROWS']],
    body: { values: [row] }
  });
}

async function write(range, values) {
  return call(`/values/${encodeURIComponent(range)}`, {
    method: 'PUT', query: [['valueInputOption', 'USER_ENTERED']], body: { values }
  });
}

async function batchUpdate(requests) {
  return call(':batchUpdate', { method: 'POST', body: { requests } });
}

module.exports = { tabs, read, append, write, batchUpdate, q };
