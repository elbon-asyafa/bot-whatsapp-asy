const { google } = require("googleapis");
require("dotenv").config();

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function formatTanggal(date = new Date()) {
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ==================== INFRA: BIKIN SHEET OTOMATIS ====================

async function getSheetTitles() {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return res.data.sheets.map((s) => s.properties.title);
}

async function createSheetIfNotExists(title, headerRow) {
  const existing = await getSheetTitles();
  if (existing.includes(title)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }],
    },
  });

  if (headerRow) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${title}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [headerRow] },
    });
  }
}

async function ensureBaseSheets() {
  await createSheetIfNotExists("Users", [
    "JID",
    "Nama",
    "TanggalDaftar",
    "NomorWA",
    "ReminderAktif",
  ]);
  await createSheetIfNotExists("RekapHarian", [
    "Tanggal",
    "TotalMasuk",
    "TotalKeluar",
    "Saldo",
  ]);
  await createSheetIfNotExists("GroupSettings", [
    "GroupJID", "GroupName", "IsActive", "ActivatedBy", "ActivatedAt", "DeactivatedBy", "DeactivatedAt"
  ]);
}

// ==================== USER REGISTRY ====================

async function getAllUsers() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Users!A:E",
  });
  const rows = res.data.values || [];
  return rows
    .slice(1) // baris pertama itu header, bukan data user
    .map(([jid, nama, tanggalDaftar, nomorWA, reminderAktif]) => ({
      jid,
      nama,
      tanggalDaftar,
      nomorWA: nomorWA || null,
      reminderAktif: reminderAktif !== "FALSE", // default TRUE kalau kosong/belum keisi
    }))
    .filter((u) => u.jid && u.nama);
}

async function getNamaByJid(jid, nomorAsli) {
  const users = await getAllUsers();

  // 1. cek langsung match JID persis
  let found = users.find((u) => u.jid === jid);
  if (found) return found.nama;

  // 2. fallback: JID beda (misal @lid berubah), tapi nomor asli match sama yang kesimpen
  if (nomorAsli) {
    found = users.find((u) => u.nomorWA === nomorAsli);
    if (found) {
      // self-healing: update JID yang tersimpen ke yang terbaru, biar lookup selanjutnya cepet & akurat lagi
      updateJidUser(found.jid, jid).catch((e) =>
        console.error("Gagal self-heal JID:", e.message)
      );
      return found.nama;
    }
  }

  return null;
}

async function updateJidUser(jidLama, jidBaru) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Users!A:E",
  });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex((r) => r[0] === jidLama);
  if (rowIdx < 1) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Users!A${rowIdx + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: [[jidBaru]] },
  });
  console.log(`[JID SELF-HEAL] ${jidLama} -> ${jidBaru}`);
  return true;
}

async function daftarUser(jid, nama, nomorWA) {
  const existing = await getNamaByJid(jid, nomorWA);
  if (existing) return { alreadyRegistered: true, nama: existing };

  await ensureBaseSheets();
  await createSheetIfNotExists(`Keuangan_${nama}`, [
    "Tanggal",
    "Jenis",
    "Nominal",
    "Keterangan",
  ]);
  await createSheetIfNotExists(`Todo_${nama}`, ["Tanggal", "Task", "Status"]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Users!A:E",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[jid, nama, formatTanggal(), nomorWA || "-", "TRUE"]],
    },
  });

  return { alreadyRegistered: false, nama };
}

async function setReminderUser(jid, aktif) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Users!A:E",
  });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex((r) => r[0] === jid);
  if (rowIdx < 0) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Users!E${rowIdx + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[aktif ? "TRUE" : "FALSE"]] },
  });
  return true;
}

// ==================== KEUANGAN ====================

async function catatTransaksi(nama, jenis, nominal, keterangan) {
  const tanggal = formatTanggal();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `Keuangan_${nama}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[tanggal, jenis, nominal, keterangan]] },
  });
  return { tanggal, jenis, nominal, keterangan };
}

async function rekapHariIni(nama) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Keuangan_${nama}!A:D`,
  });
  const rows = res.data.values || [];
  const tanggalHariIni = formatTanggal();

  let totalMasuk = 0;
  let totalKeluar = 0;
  for (const [tanggal, jenis, nominal] of rows) {
    if (tanggal === tanggalHariIni) {
      const angka = parseInt(nominal, 10) || 0;
      if (jenis === "Masuk") totalMasuk += angka;
      if (jenis === "Keluar") totalKeluar += angka;
    }
  }
  return { totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar };
}

// Total gabungan SEMUA user hari ini, sekaligus disimpen ke sheet RekapHarian
async function rekapSemuaHariIniDanSimpan() {
  await ensureBaseSheets();
  const users = await getAllUsers();
  const tanggalHariIni = formatTanggal();

  let totalMasuk = 0;
  let totalKeluar = 0;

  for (const user of users) {
    const rekapUser = await rekapHariIni(user.nama);
    totalMasuk += rekapUser.totalMasuk;
    totalKeluar += rekapUser.totalKeluar;
  }

  const saldo = totalMasuk - totalKeluar;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "RekapHarian!A:D",
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[0] === tanggalHariIni);

  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `RekapHarian!A${rowIndex + 1}:D${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[tanggalHariIni, totalMasuk, totalKeluar, saldo]],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "RekapHarian!A:D",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[tanggalHariIni, totalMasuk, totalKeluar, saldo]],
      },
    });
  }

  return { totalMasuk, totalKeluar, saldo, jumlahUser: users.length };
}

// ==================== TODO ====================

async function tambahTodo(nama, task) {
  const tanggal = formatTanggal();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `Todo_${nama}!A:C`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[tanggal, task, "Pending"]] },
  });
}

async function getTodoHariIni(nama) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Todo_${nama}!A:C`,
  });
  const rows = res.data.values || [];
  const tanggalHariIni = formatTanggal();

  const todos = [];
  rows.forEach((row, idx) => {
    const [tanggal, task, status] = row;
    if (tanggal === tanggalHariIni) {
      todos.push({ rowNumber: idx + 1, task, status: status || "Pending" });
    }
  });
  return todos;
}

async function tandaiSelesai(nama, nomorUrutHariIni) {
  const todos = await getTodoHariIni(nama);
  const target = todos[nomorUrutHariIni - 1];
  if (!target) return null;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Todo_${nama}!C${target.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Done"]] },
  });
  return target;
}

// ==================== RIWAYAT ====================

async function ambilRiwayat(nama, jumlah = 10) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Keuangan_${nama}!A:D`,
  });
  const rows = (res.data.values || []).slice(1); // skip header
  return rows.slice(-jumlah).reverse(); // yang terbaru duluan
}

// ==================== EXPORT ====================

async function ambilDataUntukExport(nama) {
  const [resKeuangan, resTodo] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Keuangan_${nama}!A:D`,
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Todo_${nama}!A:C`,
    }),
  ]);

  return {
    keuangan: resKeuangan.data.values || [],
    todo: resTodo.data.values || [],
  };
}

// ==================== HAPUS USER ====================

// Hapus berdasarkan JID pemilik akun (dipakai /deleteuser - user hapus akun sendiri)
async function hapusUser(jid) {
  const nama = await getNamaByJid(jid);
  if (!nama) return { berhasil: false, alasan: "belum_terdaftar" };
  return hapusUserByJidDanNama(jid, nama);
}

// Hapus berdasarkan NAMA (dipakai admin buat hapus user lain lewat /adminhapususer)
async function hapusUserByNama(namaTarget) {
  const users = await getAllUsers();
  const target = users.find(
    (u) => u.nama.toLowerCase() === namaTarget.toLowerCase()
  );
  if (!target) return { berhasil: false, alasan: "tidak_ditemukan" };
  return hapusUserByJidDanNama(target.jid, target.nama);
}

async function hapusUserByJidDanNama(jid, nama) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets;

  const requests = [];
  for (const title of [`Keuangan_${nama}`, `Todo_${nama}`]) {
    const found = allSheets.find((s) => s.properties.title === title);
    if (found) {
      requests.push({ deleteSheet: { sheetId: found.properties.sheetId } });
    }
  }

  const usersSheetMeta = allSheets.find((s) => s.properties.title === "Users");
  const resUsers = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Users!A:E",
  });
  const rows = resUsers.data.values || [];
  const rowIdx = rows.findIndex((r) => r[0] === jid);
  if (rowIdx >= 0 && usersSheetMeta) {
    requests.push({
      deleteDimension: {
        range: {
          sheetId: usersSheetMeta.properties.sheetId,
          dimension: "ROWS",
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        },
      },
    });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests },
    });
  }

  return { berhasil: true, nama };
}

// ==================== ALARM CUSTOM ====================

async function tambahAlarm(nama, waktu, pesan) {
  await createSheetIfNotExists(`Alarm_${nama}`, [
    "Waktu",
    "Pesan",
    "Status",
    "DibuatTanggal",
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `Alarm_${nama}!A:D`,
    valueInputOption: "RAW", // penting: RAW biar "02:47" nggak di-convert Sheets jadi format Time/nol didepan ilang
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[waktu, pesan, "Aktif", formatTanggal()]] },
  });
}

async function getAlarmUser(nama) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Alarm_${nama}!A:D`,
    });
    const rows = (res.data.values || []).slice(1);
    const aktif = [];
    rows.forEach((row, idx) => {
      const [waktu, pesan, status] = row;
      if (status === "Aktif") aktif.push({ rowNumber: idx + 2, waktu, pesan });
    });
    return aktif;
  } catch (e) {
    return []; // sheet alarm belum pernah dibikin buat user ini
  }
}

async function hapusAlarm(nama, nomorUrut) {
  const aktif = await getAlarmUser(nama);
  const target = aktif[nomorUrut - 1];
  if (!target) return false;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Alarm_${nama}!C${target.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Dihapus"]] },
  });
  return true;
}

// Dipanggil scheduler tiap menit: ambil alarm yang masih "Aktif" (nunggu waktu) ATAU "Berbunyi" (lagi spam nunggu di-stop)
async function getAlarmPerluDicek() {
  const users = await getAllUsers();
  const hasil = [];
  for (const user of users) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `Alarm_${user.nama}!A:D`,
      });
      const rows = (res.data.values || []).slice(1);
      rows.forEach((row, idx) => {
        const [waktu, pesan, status] = row;
        if (status === "Aktif" || status === "Berbunyi") {
          hasil.push({
            nama: user.nama,
            jid: user.jid,
            waktu,
            pesan,
            status,
            rowNumber: idx + 2,
          });
        }
      });
    } catch (e) {
      // sheet alarm belum pernah dibikin buat user ini, skip
    }
  }
  return hasil;
}

async function updateStatusAlarm(nama, rowNumber, statusBaru) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Alarm_${nama}!C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[statusBaru]] },
  });
}

// Dipanggil /stopalarm: hentikan semua alarm user yang lagi "Berbunyi" (spam)
async function stopAlarmBerbunyi(nama) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Alarm_${nama}!A:D`,
  });
  const rows = (res.data.values || []).slice(1);
  const berbunyi = [];
  rows.forEach((row, idx) => {
    const [waktu, pesan, status] = row;
    if (status === "Berbunyi") {
      berbunyi.push({ waktu, pesan, rowNumber: idx + 2 });
    }
  });

  for (const a of berbunyi) {
    await updateStatusAlarm(nama, a.rowNumber, "Dihentikan");
  }
  return berbunyi;
}

// ==================== KONTAK CACHE (buat nama, best-effort, nggak wajib /daftarbot) ====================

async function simpanKontak(jid, nama) {
  if (!nama || !jid) return;
  await createSheetIfNotExists("Kontak", ["JID", "Nama", "TerakhirDilihat"]);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Kontak!A:C",
  });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex((r) => r[0] === jid);
  if (rowIdx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Kontak!B${rowIdx + 1}:C${rowIdx + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [[nama, formatTanggal()]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Kontak!A:C",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[jid, nama, formatTanggal()]] },
    });
  }
}

async function getNamaKontak(jid) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Kontak!A:C",
    });
    const rows = (res.data.values || []).slice(1);
    const found = rows.find((r) => r[0] === jid);
    if (found) return found[1];
  } catch (e) {
    // sheet Kontak belum ada, lanjut fallback
  }
  return (jid || "").split("@")[0]; // fallback: nomor mentah
}

async function getGroupSetting(groupJid) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "GroupSettings!A:G",
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === groupJid) {
      return {
        rowIndex: i + 1,
        groupJid: row[0],
        groupName: row[1],
        isActive: row[2] === 'TRUE',
        activatedBy: row[3],
        activatedAt: row[4],
        deactivatedBy: row[5],
        deactivatedAt: row[6],
      };
    }
  }
  return null;
}

async function setGroupActive(groupJid, groupName, ownerJid, isActive) {
  const existing = await getGroupSetting(groupJid);
  const now = new Date().toISOString();
  const row = [
    groupJid,
    groupName,
    isActive ? 'TRUE' : 'FALSE',
    isActive ? ownerJid : (existing?.activatedBy || ''),
    isActive ? now : (existing?.activatedAt || ''),
    isActive ? '' : ownerJid,
    isActive ? '' : now,
  ];
  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `GroupSettings!A${existing.rowIndex}:G${existing.rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'GroupSettings!A:G',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  }
}

async function getAllActiveGroups() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "GroupSettings!A:G",
  });
  const rows = res.data.values || [];
  return rows
    .slice(1)
    .filter(([, , isActive]) => isActive === 'TRUE')
    .map(([groupJid, groupName]) => ({ groupJid, groupName }));
}

module.exports = {
  ensureBaseSheets,
  daftarUser,
  getNamaByJid,
  getAllUsers,
  setReminderUser,
  catatTransaksi,
  rekapHariIni,
  rekapSemuaHariIniDanSimpan,
  tambahTodo,
  getTodoHariIni,
  tandaiSelesai,
  ambilDataUntukExport,
  ambilRiwayat,
  hapusUser,
  hapusUserByNama,
  tambahAlarm,
  getAlarmUser,
  hapusAlarm,
  getAlarmPerluDicek,
  updateStatusAlarm,
  stopAlarmBerbunyi,
  simpanKontak,
  getNamaKontak,
  getGroupSetting,
  setGroupActive,
  getAllActiveGroups,
};
