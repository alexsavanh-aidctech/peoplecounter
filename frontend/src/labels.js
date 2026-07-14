// All user-facing Lao strings in one place — edit here to retune wording.
// NOTE: these are a best-effort Lao pass; have a native speaker review wording
// (esp. "ຄົງເຫຼືອ" for occupancy / people currently inside — the Phase 2 prompt's
// spelling was garbled). Kept centralized so corrections are one-file edits.
export const L = {
  appTitle: 'ນັບຄົນເຂົ້າ-ອອກ',
  appSubtitle: 'ລະບົບນັບພະນັກງານເຂົ້າ-ອອກ ປະຕູ',
  refresh: 'ໂຫຼດຂໍ້ມູນ',
  today: 'ມື້ນີ້',

  // gates
  gateLeft: 'AIDC Tech',
  gateRight: 'AIDC',
  gateAll: 'ລວມ',

  // metrics
  in: 'ເຂົ້າ',
  out: 'ອອກ',
  occupancy: 'ຈຳນວນ',
  total: 'ລວມທັງໝົດ',

  // sections
  liveTitle: 'ພາບສົດ',
  summaryTitle: 'ສະຫຼຸບ',

  // filter (date range + gate)
  filterRange: 'ຊ່ວງເວລາ',
  rangeToday: 'ມື້ນີ້',
  range7d: '7 ວັນ',
  range30d: '30 ວັນ',
  rangeCustom: 'ກຳນົດເອງ',
  rangeFrom: 'ຈາກ',
  rangeTo: 'ຫາ',
  rangeInvalid: 'ຊ່ວງວັນທີບໍ່ຖືກຕ້ອງ (ຈາກ ຕ້ອງ ≤ ຫາ)',
  rangeTooWide: 'ຊ່ວງກວ້າງເກີນ 90 ວັນ ກະລຸນາເລືອກແຄບລົງ',
  filterGate: 'ປະຕູ',
  // KPI clarity: numbers are today-only regardless of the selected range.
  kpiTodayNote: 'ຕົວເລກມື້ນີ້ · ບໍ່ປ່ຽນຕາມຊ່ວງທີ່ເລືອກ',
  tableRecent: 'ລ່າສຸດ 50',
  chartTitle: 'ຈຳນວນເຂົ້າ-ອອກ ຕໍ່ຊົ່ວໂມງ',
  logTitle: 'ບັນທຶກເຂົ້າ-ອອກ ຕາມเวลา',
  colTime: 'ເວລາ',
  colGate: 'ປະຕູ',
  colDir: 'ທິດ',
  colCount: 'ຈຳນວນ',
  noData: 'ຍັງບໍ່ມີບັນທຶກ',

  // camera
  cameraOffline: 'ກ້ອງບໍ່ພ້ອມ',
  cameraPaused: 'ກ້ອງປິດຢູ່',
  showDetect: 'ສະແດງເສ້ນ/ໂຊນກວດຈັບ',
  liveLabel: 'ອັບເດດອັດຕະໂນມັດ',
  liveOn: 'ເປີດພາບສົດ', // action: turn cameras on
  liveOff: 'ປິດພາບສົດ', // action: turn cameras off

  // reset
  reset: 'ຣີເຊັດ',
  resetConfirm: 'ຢືນຢັນ ຣີເຊັດ occupancy ທັງໝົດ? ຄ່າຈະເລີ່ມນັບ 0 ໃໝ່.',

  // states
  loading: 'ກຳລັງໂຫຼດ...',
  error: 'ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ',

  // auth
  loginTitle: 'ນັບຄົນເຂົ້າ-ອອກ',
  loginSubtitle: 'People Counter Dashboard',
  loginPlaceholder: 'ໃສ່ລະຫັດຜ່ານ',
  loginButton: 'ເຂົ້າສູ່ລະບົບ',
  loginBusy: 'ກຳລັງເຂົ້າ…',
  loginWrongPassword: 'ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ',
  loginFailed: 'ເຂົ້າສູ່ລະບົບບໍ່ໄດ້ ລອງໃໝ່',
  logout: 'ອອກຈາກລະບົບ',
};

// Gate display name from its key.
export function gateName(gate) {
  if (gate === 'left') return L.gateLeft;
  if (gate === 'right') return L.gateRight;
  return L.gateAll;
}
