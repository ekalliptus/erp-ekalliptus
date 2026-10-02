import 'models.dart';

const stateNames = {
  'ticket_created': 'Tiket baru',
  'inspection_pending': 'Menunggu inspeksi',
  'diagnosed_quotation_ready': 'Diagnosis selesai',
  'waiting_customer_approval': 'Menunggu persetujuan',
  'repair_approved_in_progress': 'Dalam perbaikan',
  'waiting_spareparts': 'Menunggu suku cadang',
  'qa_qc_validation': 'Pemeriksaan kualitas',
  'ready_for_pickup': 'Siap diambil',
  'delivered_closed': 'Selesai',
  'cancelled_unrepairable': 'Dibatalkan',
};

const transitions = {
  'ticket_created': ['inspection_pending', 'cancelled_unrepairable'],
  'inspection_pending': ['diagnosed_quotation_ready', 'cancelled_unrepairable'],
  'diagnosed_quotation_ready': ['waiting_customer_approval', 'cancelled_unrepairable'],
  'waiting_customer_approval': ['repair_approved_in_progress', 'cancelled_unrepairable'],
  'repair_approved_in_progress': ['waiting_spareparts', 'qa_qc_validation', 'cancelled_unrepairable'],
  'waiting_spareparts': ['repair_approved_in_progress', 'cancelled_unrepairable'],
  'qa_qc_validation': ['ready_for_pickup', 'repair_approved_in_progress'],
  'ready_for_pickup': ['delivered_closed'],
};

const deviceTypes = {'smartphone': 'Ponsel', 'laptop': 'Laptop', 'tablet': 'Tablet', 'printer': 'Printer'};

bool matchesRepair(Repair repair, String customer, String query, String filter) {
  final closed = ['delivered_closed', 'cancelled_unrepairable'].contains(repair.currentState);
  final inFilter = switch (filter) {
    'active' => !closed,
    'ready' => repair.currentState == 'ready_for_pickup',
    'closed' => closed,
    _ => true,
  };
  return inFilter && '${repair.ticketNumber} ${repair.brand} ${repair.modelName} $customer ${repair.declaredDefects}'.toLowerCase().contains(query.trim().toLowerCase());
}
