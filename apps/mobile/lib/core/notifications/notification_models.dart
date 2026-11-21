/// Model notifikasi untuk client mobile.
class NotificationEntry {
  const NotificationEntry({
    required this.id,
    required this.module,
    required this.eventType,
    required this.title,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.entityId,
  });

  final String id;
  final String module;
  final String eventType;
  final String title;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;
  final String? entityId;

  bool get isUnread => readAt == null;

  factory NotificationEntry.fromJson(Map<String, dynamic> json) {
    DateTime parseTime(Object? value) {
      if (value is String && value.isNotEmpty) {
        return DateTime.tryParse(value)?.toLocal() ?? DateTime.now();
      }
      return DateTime.now();
    }

    return NotificationEntry(
      id: json['id'] as String,
      module: json['module'] as String,
      eventType: json['event_type'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      createdAt: parseTime(json['created_at']),
      readAt: json['read_at'] is String ? parseTime(json['read_at']) : null,
      entityId: json['entity_id'] is String ? json['entity_id'] as String : null,
    );
  }
}
