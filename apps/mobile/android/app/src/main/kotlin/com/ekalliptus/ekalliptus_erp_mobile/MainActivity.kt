package com.ekalliptus.ekalliptus_erp_mobile

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterFragmentActivity() {
  private val permissionRequestCode = 9042
  private val faceScanRequestCode = 9043
  private var pendingPermissionResult: MethodChannel.Result? = null
  private var pendingRequestedKeys: List<String> = emptyList()
  private var pendingFaceResult: MethodChannel.Result? = null
  private var pendingRefImageFile: File? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    ensureDefaultNotificationChannel()
  }

  private fun ensureDefaultNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel("myekalliptus_general") != null) return
    val channel = NotificationChannel(
      "myekalliptus_general",
      "Notifikasi MyEkalliptus",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Pemberitahuan pembaruan aplikasi dan aktivitas ERP MyEkalliptus."
      enableVibration(true)
    }
    manager.createNotificationChannel(channel)
  }

  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)

    MethodChannel(
      flutterEngine.dartExecutor.binaryMessenger,
      "com.ekalliptus.myekalliptus/device_telemetry",
    ).setMethodCallHandler { call, result ->
      when (call.method) {
        "getDeviceInfo" -> {
          val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
          val fingerprint = Build.FINGERPRINT.lowercase()
          val model = Build.MODEL.lowercase()
          val product = Build.PRODUCT.lowercase()
          val hardware = Build.HARDWARE.lowercase()
          val isEmulator = fingerprint.contains("generic") ||
            fingerprint.contains("unknown") ||
            model.contains("emulator") ||
            model.contains("android sdk built for") ||
            product.contains("sdk") ||
            product.contains("vbox") ||
            hardware.contains("ranchu") ||
            hardware.contains("goldfish") ||
            hardware.contains("vbox")
          result.success(
            mapOf(
              "manufacturer" to Build.MANUFACTURER,
              "brand" to Build.BRAND,
              "model" to Build.MODEL,
              "os_version" to "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
              "platform" to "android",
              "device_id" to androidId,
              "is_physical_device" to !isEmulator,
            ),
          )
        }

        "getAppVersion" -> {
          try {
            val pkg = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              packageManager.getPackageInfo(
                packageName,
                PackageManager.PackageInfoFlags.of(0),
              )
            } else {
              @Suppress("DEPRECATION")
              packageManager.getPackageInfo(packageName, 0)
            }
            val buildNum = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
              pkg.longVersionCode
            } else {
              @Suppress("DEPRECATION")
              pkg.versionCode.toLong()
            }
            result.success(
              mapOf(
                "version" to (pkg.versionName ?: "1.3.3"),
                "build_number" to buildNum.toInt(),
              ),
            )
          } catch (_: Exception) {
            result.success(
              mapOf(
                "version" to "1.3.3",
                "build_number" to 7,
              ),
            )
          }
        }

        "openExternalUrl" -> {
          val url = call.argument<String>("url")?.trim()
          if (url == null || (!url.startsWith("https://") && !url.startsWith("http://"))) {
            result.success(false)
            return@setMethodCallHandler
          }
          try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
              .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            startActivity(intent)
            result.success(true)
          } catch (_: Exception) {
            result.success(false)
          }
        }

        "canInstallPackages" -> {
          val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            packageManager.canRequestPackageInstalls()
          } else {
            true
          }
          result.success(allowed)
        }

        "openInstallPermissionSettings" -> {
          try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:$packageName"),
              )
            } else {
              Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", packageName, null),
              )
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
              startActivity(intent)
            } catch (_: Exception) {
              val fallback = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", packageName, null),
              ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
              startActivity(fallback)
            }
            result.success(true)
          } catch (_: Exception) {
            result.success(false)
          }
        }

        "installApk" -> {
          val rawPath = call.argument<String>("file_path")?.trim()
          if (rawPath.isNullOrEmpty()) {
            result.success(
              mapOf("status" to "error", "message" to "Lokasi berkas APK kosong."),
            )
            return@setMethodCallHandler
          }
          try {
            val apkFile = File(rawPath)
            if (!apkFile.exists() || !apkFile.isFile) {
              result.success(
                mapOf("status" to "error", "message" to "Berkas APK tidak ditemukan."),
              )
              return@setMethodCallHandler
            }
            val canonicalApk = apkFile.canonicalPath
            val internalRoot = File(cacheDir, "apk_updates").canonicalPath + File.separator
            val extRoot = externalCacheDir?.let { File(it, "apk_updates").canonicalPath + File.separator }
            val insideUpdatesDir = canonicalApk.startsWith(internalRoot) ||
              (extRoot != null && canonicalApk.startsWith(extRoot))
            if (!insideUpdatesDir) {
              result.success(
                mapOf("status" to "error", "message" to "Lokasi berkas APK tidak valid."),
              )
              return@setMethodCallHandler
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
              !packageManager.canRequestPackageInstalls()
            ) {
              result.success(mapOf("status" to "permission_required"))
              return@setMethodCallHandler
            }
            val contentUri = FileProvider.getUriForFile(
              this,
              "$packageName.apk_updater",
              apkFile,
            )
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
              setDataAndType(contentUri, "application/vnd.android.package-archive")
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(installIntent)
            result.success(mapOf("status" to "launched"))
          } catch (err: Exception) {
            result.success(
              mapOf(
                "status" to "error",
                "message" to (err.localizedMessage ?: "Gagal membuka pemasang aplikasi Android."),
              ),
            )
          }
        }

        else -> result.notImplemented()
      }
    }

    MethodChannel(
      flutterEngine.dartExecutor.binaryMessenger,
      "com.ekalliptus.myekalliptus/permissions",
    ).setMethodCallHandler { call, result ->
      when (call.method) {
        "checkPermissions" -> {
          result.success(buildPermissionStatuses(afterDeniedKeys = emptySet()))
        }

        "requestPermissions" -> {
          if (pendingPermissionResult != null) {
            result.error("BUSY", "Permintaan izin lain sedang berlangsung.", null)
            return@setMethodCallHandler
          }

          val keys = call.argument<List<String>>("permissions")
            ?: listOf("location", "camera", "notifications")
          val toRequest = mutableListOf<String>()

          if (keys.contains("location") && !isLocationGranted()) {
            toRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
            toRequest.add(Manifest.permission.ACCESS_COARSE_LOCATION)
          }
          if (keys.contains("camera") && !isGranted(Manifest.permission.CAMERA)) {
            toRequest.add(Manifest.permission.CAMERA)
          }
          if (keys.contains("notifications") &&
            Build.VERSION.SDK_INT >= 33 &&
            !isGranted(Manifest.permission.POST_NOTIFICATIONS)
          ) {
            toRequest.add(Manifest.permission.POST_NOTIFICATIONS)
          }

          if (toRequest.isEmpty()) {
            result.success(buildPermissionStatuses(afterDeniedKeys = emptySet()))
            return@setMethodCallHandler
          }

          pendingPermissionResult = result
          pendingRequestedKeys = keys
          ActivityCompat.requestPermissions(
            this,
            toRequest.distinct().toTypedArray(),
            permissionRequestCode,
          )
        }

        "openAppSettings" -> {
          val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null),
          ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
          startActivity(intent)
          result.success(true)
        }

        "openLocationSettings" -> {
          val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
          startActivity(intent)
          result.success(true)
        }

        "openBiometricSettings" -> {
          val intent = if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_BIOMETRIC_ENROLL)
          } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
          }
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          try {
            startActivity(intent)
          } catch (_: Exception) {
            val fallback = Intent(Settings.ACTION_SECURITY_SETTINGS)
              .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            startActivity(fallback)
          }
          result.success(true)
        }

        else -> result.notImplemented()
      }
    }

    MethodChannel(
      flutterEngine.dartExecutor.binaryMessenger,
      "com.ekalliptus.myekalliptus/face_recognition",
    ).setMethodCallHandler { call, result ->
      when (call.method) {
        "scanFace" -> {
          if (pendingFaceResult != null) {
            result.error("BUSY", "Pemindaian wajah lain sedang berlangsung.", null)
            return@setMethodCallHandler
          }

          val mode = call.argument<String>("mode") ?: "verify"
          val title = call.argument<String>("title") ?: "Scan Wajah Langsung"
          val rawRefDesc = call.argument<List<Number>>("reference_descriptor")
          val rawRefDescs = call.argument<List<List<Number>>>("reference_descriptors")
          val refImageBytes = call.argument<ByteArray>("reference_image_bytes")

          var tempRefFile: File? = null
          if (refImageBytes != null && refImageBytes.isNotEmpty()) {
            try {
              tempRefFile = File(cacheDir, "face_ref_${System.currentTimeMillis()}.jpg")
              tempRefFile.writeBytes(refImageBytes)
            } catch (_: Exception) {
              tempRefFile?.delete()
              result.error("IO_ERROR", "Gagal menyiapkan foto acuan wajah.", null)
              return@setMethodCallHandler
            }
          }

          pendingFaceResult = result
          pendingRefImageFile = tempRefFile

          val scanIntent = Intent(this, FaceScanActivity::class.java).apply {
            putExtra(FaceScanActivity.EXTRA_MODE, mode)
            putExtra(FaceScanActivity.EXTRA_TITLE, title)
            if (rawRefDesc != null && rawRefDesc.isNotEmpty()) {
              putExtra(
                FaceScanActivity.EXTRA_REF_DESCRIPTOR,
                DoubleArray(rawRefDesc.size) { idx -> rawRefDesc[idx].toDouble() },
              )
            }
            if (rawRefDescs != null && rawRefDescs.isNotEmpty()) {
              val validLists = rawRefDescs.filter { it.isNotEmpty() }
              val firstDim = validLists.firstOrNull()?.size ?: 0
              if (validLists.isNotEmpty() && firstDim > 0 && validLists.all { it.size == firstDim }) {
                val flat = DoubleArray(validLists.size * firstDim)
                for (i in validLists.indices) {
                  val row = validLists[i]
                  for (j in 0 until firstDim) {
                    flat[i * firstDim + j] = row[j].toDouble()
                  }
                }
                putExtra(FaceScanActivity.EXTRA_REF_DESCRIPTORS, flat)
                putExtra(FaceScanActivity.EXTRA_REF_DESCRIPTOR_COUNT, validLists.size)
              }
            }
            if (tempRefFile != null) {
              putExtra(FaceScanActivity.EXTRA_REF_IMAGE_PATH, tempRefFile.absolutePath)
            }
          }

          @Suppress("DEPRECATION")
          startActivityForResult(scanIntent, faceScanRequestCode)
        }

        else -> result.notImplemented()
      }
    }
  }

  @Suppress("DEPRECATION")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != faceScanRequestCode) return

    pendingRefImageFile?.delete()
    pendingRefImageFile = null

    val pending = pendingFaceResult ?: return
    pendingFaceResult = null

    if (resultCode != Activity.RESULT_OK || data == null) {
      pending.success(mapOf("cancelled" to true))
      return
    }

    val imagePath = data.getStringExtra(FaceScanActivity.RESULT_IMAGE_PATH)
    val descriptor = data.getDoubleArrayExtra(FaceScanActivity.RESULT_DESCRIPTOR)
    val refDescriptor = data.getDoubleArrayExtra(FaceScanActivity.RESULT_REF_DESCRIPTOR)
    val flatSamples = data.getDoubleArrayExtra(FaceScanActivity.RESULT_SAMPLES)
    val sampleCount = data.getIntExtra(FaceScanActivity.RESULT_SAMPLE_COUNT, 0)
    val poses = data.getStringArrayExtra(FaceScanActivity.RESULT_POSES)
    val similarityPercent = data.getIntExtra(FaceScanActivity.RESULT_SIMILARITY_PERCENT, 100)
    val matched = data.getBooleanExtra(FaceScanActivity.RESULT_MATCHED, true)

    var imageBytes: ByteArray? = null
    if (!imagePath.isNullOrBlank()) {
      val captureFile = File(imagePath)
      if (captureFile.exists()) {
        try {
          imageBytes = captureFile.readBytes()
        } catch (_: Exception) {
        } finally {
          captureFile.delete()
        }
      }
    }

    if (descriptor == null || descriptor.isEmpty() || imageBytes == null) {
      pending.success(mapOf("cancelled" to true))
      return
    }

    val samplesList: List<List<Double>>? =
      if (flatSamples != null && sampleCount > 0 && flatSamples.size % sampleCount == 0) {
        val dim = flatSamples.size / sampleCount
        List(sampleCount) { i ->
          List(dim) { j -> flatSamples[i * dim + j] }
        }
      } else {
        null
      }

    pending.success(
      mapOf(
        "cancelled" to false,
        "descriptor" to descriptor.toList(),
        "reference_descriptor" to refDescriptor?.toList(),
        if (samplesList != null) "samples" to samplesList else "samples" to null,
        if (poses != null) "poses" to poses.toList() else "poses" to null,
        "image_bytes" to imageBytes,
        "similarity_percent" to similarityPercent,
        "matched" to matched,
      ),
    )
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != permissionRequestCode) return

    val pending = pendingPermissionResult ?: return
    val requestedKeys = pendingRequestedKeys.toSet()
    pendingPermissionResult = null
    pendingRequestedKeys = emptyList()

    pending.success(buildPermissionStatuses(afterDeniedKeys = requestedKeys))
  }

  private fun isGranted(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
  }

  private fun isLocationGranted(): Boolean {
    return isGranted(Manifest.permission.ACCESS_FINE_LOCATION) ||
      isGranted(Manifest.permission.ACCESS_COARSE_LOCATION)
  }

  private fun isNotificationsGranted(): Boolean {
    return if (Build.VERSION.SDK_INT >= 33) {
      isGranted(Manifest.permission.POST_NOTIFICATIONS)
    } else {
      NotificationManagerCompat.from(this).areNotificationsEnabled()
    }
  }

  private fun buildPermissionStatuses(afterDeniedKeys: Set<String>): Map<String, String> {
    val locationStatus = when {
      isLocationGranted() -> "granted"
      afterDeniedKeys.contains("location") &&
        !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION) &&
        !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_COARSE_LOCATION) ->
        "permanentlyDenied"
      else -> "denied"
    }

    val cameraStatus = when {
      isGranted(Manifest.permission.CAMERA) -> "granted"
      afterDeniedKeys.contains("camera") &&
        !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA) ->
        "permanentlyDenied"
      else -> "denied"
    }

    val notificationsStatus = when {
      isNotificationsGranted() -> "granted"
      Build.VERSION.SDK_INT < 33 -> "permanentlyDenied"
      afterDeniedKeys.contains("notifications") &&
        !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS) ->
        "permanentlyDenied"
      else -> "denied"
    }

    return mapOf(
      "location" to locationStatus,
      "preciseLocation" to (if (isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) "granted" else "denied"),
      "camera" to cameraStatus,
      "notifications" to notificationsStatus,
    )
  }
}
