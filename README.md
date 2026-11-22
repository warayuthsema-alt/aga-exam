# ระบบแบบทดสอบมาตรฐานงานบริการ – Advance Group Asia

หน้าเว็บและ API อยู่บน **Vercel** โดยอ่าน/เขียน **Google Sheet** คลังข้อสอบผ่าน Google Sheets API (Service Account)

```
index.html        หน้าเว็บ (เข้าสู่ระบบ → เลือกแบบทดสอบ → ทำข้อสอบ → ผลสอบ)
api/exam.js       POST {action: init|options|start|submit, args: [...]}
api/setup.js      POST + header x-admin-key  → เตรียมแท็บ/คอลัมน์ในชีต (รันซ้ำได้)
api/health.js     GET  → ตรวจการตั้งค่าและการเข้าถึงชีต
lib/              ตรรกะ (logic.js), การเชื่อมชีต (sheets.js), คำสั่ง (service.js)
test/run.js       ทดสอบทั้งระบบกับชีตจำลอง: npm test
```

## Environment variables (Vercel → Project → Settings → Environment Variables)
| ชื่อ | ค่า |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | เนื้อหาไฟล์ JSON ของ Service Account ทั้งไฟล์ (ตั้งเป็น Sensitive) |
| `SHEET_ID` | ID ของ Google Sheet คลังข้อสอบ (ส่วนกลางของ URL ชีต) |
| `SESSION_SECRET` | ข้อความสุ่มยาว ≥ 32 ตัว (ใช้เข้ารหัสรอบสอบ) |
| `ADMIN_KEY` | ข้อความสุ่มยาว ≥ 16 ตัว (ใช้เรียก /api/setup) |

## สร้าง Service Account (ครั้งเดียว)
1. https://console.cloud.google.com → สร้างโปรเจกต์ (เช่น `aga-exam`)
2. APIs & Services → Library → เปิด **Google Sheets API**
3. IAM & Admin → Service Accounts → Create (ชื่อ `aga-exam`) → Keys → Add key → JSON → ดาวน์โหลด
4. เปิด Google Sheet คลังข้อสอบ → **Share** ให้อีเมล `...@...iam.gserviceaccount.com` สิทธิ์ **Editor**
5. วางเนื้อหาไฟล์ JSON ลงตัวแปร `GOOGLE_SERVICE_ACCOUNT_JSON` ใน Vercel แล้ว Redeploy
   (ห้ามอัปไฟล์ JSON ขึ้น GitHub – `.gitignore` กันไว้แล้ว)

## เตรียมชีต (ครั้งเดียว)
```
curl -X POST https://<โดเมน>.vercel.app/api/setup -H "x-admin-key: <ADMIN_KEY>"
```
- สร้างแท็บ `แผนอบรมรายสัปดาห์` (10 สัปดาห์ 4 ม.ค. – 12 มี.ค. 2570) และ `สรุปรายสัปดาห์`
- เพิ่มหัวคอลัมน์ K–M ในคลังข้อสอบ: สัตว์เป้าหมาย / มีภาพ (Y/N) / ลิงก์ภาพ (https)
- แทรกคอลัมน์ L–N ใน `สรุปผลสอบรวม` และ `แม่แบบ_แท็บสาขา` (KPI เดิมเลื่อนจาก M–N ไป P–Q สูตรไม่เสีย)

## กติกาที่ระบบบังคับใช้
- รายสัปดาห์: 6 ข้อสัตว์ประจำสัปดาห์ + 2 หมวดเสริม + 2 ทบทวน, ข้อภาพ ≥ 1, ปิดรับศุกร์ 17:00
- สอบซ่อม 1 ครั้ง ข้อชุดใหม่ ถึงจันทร์ถัดไป 17:00 · Pre-test สัปดาห์ 1 · Post-test สัปดาห์ 10
- นอกช่วงแผน: แบบทดสอบมาตรฐาน วันละ 1 ครั้ง · เวลา 15 นาที · ผ่าน 80%
- ตรวจคะแนนฝั่งเซิร์ฟเวอร์ เฉลยถูกเข้ารหัสใน token (AES-256-GCM) ไม่ถึงเบราว์เซอร์ระหว่างสอบ · กันส่งซ้ำ · นับการสลับหน้าจอ
- ปิดสัปดาห์ชั่วคราว: ใส่ `ปิด` ในคอลัมน์ K ของแผน
