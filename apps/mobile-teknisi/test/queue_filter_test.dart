import 'package:flutter_test/flutter_test.dart';
import 'package:nexus_tech/models.dart';
import 'package:nexus_tech/repair_flow.dart';

void main() {
  Repair ticket(String state) => Repair.fromJson({
    'id': '1', 'ticketNumber': 'SRV-001', 'customerId': 'c1',
    'brand': 'Samsung', 'modelName': 'A54', 'declaredDefects': 'Layar retak',
    'currentState': state,
  });

  test('Queue search combines normalized text with real stage filters', () {
    final active = ticket('inspection_pending');
    expect(matchesRepair(active, 'Dewi', '  SAMSUNG ', 'active'), isTrue);
    expect(matchesRepair(active, 'Dewi', 'dewi', 'all'), isTrue);
    expect(matchesRepair(active, 'Dewi', 'layar', 'active'), isTrue);
    expect(matchesRepair(active, 'Dewi', 'missing', 'all'), isFalse);
    expect(matchesRepair(active, '', '', 'ready'), isFalse);
    expect(matchesRepair(ticket('ready_for_pickup'), '', '', 'ready'), isTrue);
    expect(matchesRepair(ticket('ready_for_pickup'), '', '', 'active'), isTrue);
    for (final state in ['delivered_closed', 'cancelled_unrepairable']) {
      expect(matchesRepair(ticket(state), '', '', 'active'), isFalse);
      expect(matchesRepair(ticket(state), '', '', 'closed'), isTrue);
    }
  });
}
