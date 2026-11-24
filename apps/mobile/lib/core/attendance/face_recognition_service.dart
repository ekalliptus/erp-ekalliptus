import 'package:flutter/services.dart';

enum FaceScanMode { enroll, verify, bridgeVerify }

class FaceScanOutcome {
  final bool cancelled;
  final List<double> descriptor;
  final List<double>? referenceDescriptor;
  final List<List<double>> samples;
  final List<String> poses;
  final Uint8List? imageBytes;
  final int similarityPercent;
  final bool matched;

  const FaceScanOutcome({
    required this.cancelled,
    this.descriptor = const [],
    this.referenceDescriptor,
    this.samples = const [],
    this.poses = const [],
    this.imageBytes,
    this.similarityPercent = 100,
    this.matched = false,
  });

  factory FaceScanOutcome.cancelled() {
    return const FaceScanOutcome(cancelled: true);
  }
}

class FaceRecognitionService {
  static const MethodChannel _channel = MethodChannel(
    'com.ekalliptus.myekalliptus/face_recognition',
  );

  Future<FaceScanOutcome> scanFace({
    required FaceScanMode mode,
    required String title,
    List<double>? referenceDescriptor,
    List<List<double>>? referenceDescriptors,
    Uint8List? referenceImageBytes,
  }) async {
    final modeArg = switch (mode) {
      FaceScanMode.enroll => 'enroll',
      FaceScanMode.bridgeVerify => 'bridge_verify',
      FaceScanMode.verify => 'verify',
    };

    try {
      final raw = await _channel.invokeMapMethod<String, dynamic>(
        'scanFace',
        <String, dynamic>{
          'mode': modeArg,
          'title': title,
          if (referenceDescriptor != null && referenceDescriptor.isNotEmpty)
            'reference_descriptor': referenceDescriptor,
          if (referenceDescriptors != null && referenceDescriptors.isNotEmpty)
            'reference_descriptors': referenceDescriptors,
          if (referenceImageBytes != null && referenceImageBytes.isNotEmpty)
            'reference_image_bytes': referenceImageBytes,
        },
      );

      if (raw == null || raw['cancelled'] == true) {
        return FaceScanOutcome.cancelled();
      }

      final rawDescriptor = raw['descriptor'] as List<dynamic>? ?? const [];
      final descriptor = rawDescriptor
          .map((item) => (item as num).toDouble())
          .toList(growable: false);

      final rawRef = raw['reference_descriptor'] as List<dynamic>?;
      final parsedRef = rawRef
          ?.map((item) => (item as num).toDouble())
          .toList(growable: false);

      final rawSamples = raw['samples'] as List<dynamic>?;
      final samples = rawSamples == null
          ? const <List<double>>[]
          : rawSamples
              .whereType<List<dynamic>>()
              .map(
                (vec) => vec.map((item) => (item as num).toDouble()).toList(growable: false),
              )
              .toList(growable: false);

      final rawPoses = raw['poses'] as List<dynamic>?;
      final poses = rawPoses == null
          ? const <String>[]
          : rawPoses.map((e) => e.toString()).toList(growable: false);

      final rawImage = raw['image_bytes'];
      final Uint8List? imageBytes = rawImage is Uint8List ? rawImage : null;

      return FaceScanOutcome(
        cancelled: false,
        descriptor: descriptor,
        referenceDescriptor: parsedRef,
        samples: samples,
        poses: poses,
        imageBytes: imageBytes,
        similarityPercent: (raw['similarity_percent'] as num?)?.toInt() ?? 100,
        matched: raw['matched'] == true,
      );
    } on MissingPluginException {
      throw StateError(
        'Pemindai wajah langsung hanya tersedia pada perangkat Android.',
      );
    } on PlatformException catch (err) {
      throw StateError(err.message ?? 'Pemindaian wajah gagal dijalankan.');
    }
  }
}
