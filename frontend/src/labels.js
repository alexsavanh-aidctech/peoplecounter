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
  occupancy: 'ຄົງເຫຼືອ',
  total: 'ລວມທັງໝົດ',

  // sections
  liveTitle: 'ພາບສົດ',
  summaryTitle: 'ສະຫຼຸບ',
  chartTitle: 'ຈຳນວນເຂົ້າ-ອອກ ຕໍ່ຊົ່ວໂມງ',
  logTitle: 'ບັນທຶກເຂົ້າ-ອອກ ຕາມเวลา',
  colTime: 'ເວລາ',
  colGate: 'ປະຕູ',
  colDir: 'ທິດ',
  colCount: 'ຈຳນວນ',
  noData: 'ຍັງບໍ່ມີບັນທຶກ',

  // camera
  cameraOffline: 'ກ້ອງບໍ່ພ້ອມ',
  showDetect: 'ສະແດງເສ້ນ/ໂຊນກວດຈັບ',
  liveLabel: 'ອັບເດດອັດຕະໂນມັດ',

  // reset
  reset: 'ຣີເຊັດ',
  resetConfirm: 'ຢືນຢັນ ຣີເຊັດ occupancy ທັງໝົດ? ຄ່າຈະເລີ່ມນັບ 0 ໃໝ່.',

  // states
  loading: 'ກຳລັງໂຫຼດ...',
  error: 'ໂຫຼດຂໍ້ມູນບໍ່ສຳເລັດ',
};

// Gate display name from its key.
export function gateName(gate) {
  if (gate === 'left') return L.gateLeft;
  if (gate === 'right') return L.gateRight;
  return L.gateAll;
}
