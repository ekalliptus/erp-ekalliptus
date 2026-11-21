import 'dart:convert';
import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class OfflineQueueItem {
  final String id;
  final String endpoint;
  final String method;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final String status;
  final String? lastError;

  const OfflineQueueItem({
    required this.id,
    required this.endpoint,
    required this.method,
    required this.payload,
    required this.createdAt,
    required this.status,
    this.lastError,
  });
}

abstract class OfflineQueueStore {
  Future<void> enqueue(OfflineQueueItem item);
  Future<List<OfflineQueueItem>> pendingItems();
  Future<void> markSynced(String id);
  Future<void> markFailed(String id, String error);
  Future<void> close();
}

class _ErpSqliteDb extends GeneratedDatabase {
  _ErpSqliteDb(super.executor);

  @override
  int get schemaVersion => 1;

  @override
  Iterable<TableInfo<Table, dynamic>> get allTables => const [];

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          await customStatement('''
            CREATE TABLE IF NOT EXISTS offline_queue (
              id TEXT PRIMARY KEY,
              endpoint TEXT NOT NULL,
              method TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              status TEXT NOT NULL,
              last_error TEXT
            )
          ''');
        },
      );
}

class DriftOfflineQueueStore implements OfflineQueueStore {
  _ErpSqliteDb? _db;

  Future<_ErpSqliteDb> _ensureOpen() async {
    if (_db != null) return _db!;
    final dir = await getApplicationDocumentsDirectory();
    final dbFile = File(p.join(dir.path, 'ekalliptus_offline_queue.sqlite'));
    _db = _ErpSqliteDb(NativeDatabase.createInBackground(dbFile));
    await _db!.customStatement('SELECT 1');
    return _db!;
  }

  @override
  Future<void> enqueue(OfflineQueueItem item) async {
    final db = await _ensureOpen();
    await db.customInsert(
      'INSERT OR REPLACE INTO offline_queue (id, endpoint, method, payload_json, created_at, status, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)',
      variables: [
        Variable.withString(item.id),
        Variable.withString(item.endpoint),
        Variable.withString(item.method),
        Variable.withString(jsonEncode(item.payload)),
        Variable.withString(item.createdAt.toIso8601String()),
        Variable.withString(item.status),
        item.lastError == null
            ? const Variable<String>(null)
            : Variable.withString(item.lastError!),
      ],
    );
  }

  @override
  Future<List<OfflineQueueItem>> pendingItems() async {
    final db = await _ensureOpen();
    final rows = await db.customSelect(
      "SELECT id, endpoint, method, payload_json, created_at, status, last_error FROM offline_queue WHERE status != 'synced' ORDER BY created_at ASC",
    ).get();

    return rows.map((row) {
      return OfflineQueueItem(
        id: row.read<String>('id'),
        endpoint: row.read<String>('endpoint'),
        method: row.read<String>('method'),
        payload: jsonDecode(row.read<String>('payload_json')) as Map<String, dynamic>,
        createdAt: DateTime.parse(row.read<String>('created_at')),
        status: row.read<String>('status'),
        lastError: row.readNullable<String>('last_error'),
      );
    }).toList(growable: false);
  }

  @override
  Future<void> markSynced(String id) async {
    final db = await _ensureOpen();
    await db.customUpdate(
      "UPDATE offline_queue SET status = 'synced', last_error = NULL WHERE id = ?",
      variables: [Variable.withString(id)],
    );
  }

  @override
  Future<void> markFailed(String id, String error) async {
    final db = await _ensureOpen();
    await db.customUpdate(
      "UPDATE offline_queue SET status = 'failed', last_error = ? WHERE id = ?",
      variables: [Variable.withString(error), Variable.withString(id)],
    );
  }

  @override
  Future<void> close() async {
    await _db?.close();
    _db = null;
  }
}

class InMemoryOfflineQueueStore implements OfflineQueueStore {
  final List<OfflineQueueItem> _items = [];

  @override
  Future<void> enqueue(OfflineQueueItem item) async {
    _items.removeWhere((e) => e.id == item.id);
    _items.add(item);
  }

  @override
  Future<List<OfflineQueueItem>> pendingItems() async {
    return _items.where((e) => e.status != 'synced').toList(growable: false);
  }

  @override
  Future<void> markSynced(String id) async {
    final idx = _items.indexWhere((e) => e.id == id);
    if (idx >= 0) {
      final prev = _items[idx];
      _items[idx] = OfflineQueueItem(
        id: prev.id,
        endpoint: prev.endpoint,
        method: prev.method,
        payload: prev.payload,
        createdAt: prev.createdAt,
        status: 'synced',
      );
    }
  }

  @override
  Future<void> markFailed(String id, String error) async {
    final idx = _items.indexWhere((e) => e.id == id);
    if (idx >= 0) {
      final prev = _items[idx];
      _items[idx] = OfflineQueueItem(
        id: prev.id,
        endpoint: prev.endpoint,
        method: prev.method,
        payload: prev.payload,
        createdAt: prev.createdAt,
        status: 'failed',
        lastError: error,
      );
    }
  }

  @override
  Future<void> close() async {}
}

class OfflineSyncResult {
  final int syncedCount;
  final int remainingCount;
  const OfflineSyncResult({required this.syncedCount, required this.remainingCount});
}

class OfflineSyncService {
  final OfflineQueueStore store;
  final Future<void> Function(String method, String endpoint, Map<String, dynamic> payload) sender;

  const OfflineSyncService({required this.store, required this.sender});

  Future<void> enqueueMutation({
    required String endpoint,
    required String method,
    required Map<String, dynamic> payload,
  }) async {
    final id = '${DateTime.now().microsecondsSinceEpoch}-${payload.hashCode.abs()}';
    await store.enqueue(
      OfflineQueueItem(
        id: id,
        endpoint: endpoint,
        method: method,
        payload: payload,
        createdAt: DateTime.now(),
        status: 'pending',
      ),
    );
  }

  Future<OfflineSyncResult> flush() async {
    final items = await store.pendingItems();
    var synced = 0;
    for (final item in items) {
      try {
        await sender(item.method, item.endpoint, item.payload);
        await store.markSynced(item.id);
        synced++;
      } catch (err) {
        await store.markFailed(item.id, err.toString());
      }
    }
    final remaining = (await store.pendingItems()).length;
    return OfflineSyncResult(syncedCount: synced, remainingCount: remaining);
  }
}
