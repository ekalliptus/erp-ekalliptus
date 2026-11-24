package com.ekalliptus.ekalliptus_erp_mobile

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.ExifInterface
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.android.gms.tflite.java.TfLite
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import org.tensorflow.lite.InterpreterApi

class FaceScanActivity : ComponentActivity() {
  companion object {
    const val EXTRA_MODE = "mode"
    const val EXTRA_TITLE = "title"
    const val EXTRA_REF_DESCRIPTOR = "reference_descriptor"
    const val EXTRA_REF_DESCRIPTORS = "reference_descriptors"
    const val EXTRA_REF_DESCRIPTOR_COUNT = "reference_descriptor_count"
    const val EXTRA_REF_IMAGE_PATH = "reference_image_path"

    const val RESULT_IMAGE_PATH = "image_path"
    const val RESULT_DESCRIPTOR = "descriptor"
    const val RESULT_REF_DESCRIPTOR = "reference_descriptor"
    const val RESULT_SAMPLES = "samples"
    const val RESULT_SAMPLE_COUNT = "sample_count"
    const val RESULT_POSES = "poses"
    const val RESULT_SIMILARITY_PERCENT = "similarity_percent"
    const val RESULT_MATCHED = "matched"

    private const val CAMERA_PERMISSION_CODE = 1001
    private const val MODEL_INPUT_SIZE = 112
    private const val DEFAULT_EMBEDDING_DIM = 192
    private const val ENROLL_STEP_SAMPLES = 2
    private const val VERIFY_REQUIRED_STABILITY = 2
    private const val MAX_VERIFY_RETRY = 3
    private const val MOBILE_COSINE_THRESHOLD = 0.56
    private val ENROLL_POSE_KEYS = arrayOf("front", "side_1", "side_2", "front_confirm")
    private val ENROLL_STEP_LABELS = arrayOf("1. Lurus", "2. Kiri", "3. Kanan", "4. Selesai")
  }

  private enum class GuideTone { NEUTRAL, ACCENT, DANGER }
  private enum class Phase { INITIALIZING, SCANNING, VERIFIED, MISMATCH, FATAL_ERROR }

  private lateinit var rootFrame: FrameLayout
  private lateinit var previewView: PreviewView
  private lateinit var guideOverlay: FaceGuideOverlayView
  private lateinit var titleText: TextView
  private lateinit var subtitleText: TextView
  private lateinit var statusText: TextView
  private lateinit var stepText: TextView
  private lateinit var alertBanner: TextView
  private lateinit var retryButton: Button
  private lateinit var enrollStepsRow: LinearLayout
  private val enrollChipViews = ArrayList<TextView>(4)

  private var mode: String = "verify"
  private var referenceTemplates: List<DoubleArray> = emptyList()
  private var bridgeRefTemplates: List<DoubleArray> = emptyList()
  private var refImagePath: String? = null

  private val isProcessingFrame = AtomicBoolean(false)
  private val isSettled = AtomicBoolean(false)
  private val scanLock = Any()

  // Verification state
  private val verifySamples = ArrayList<DoubleArray>(3)
  private var verifyRetryCount: Int = 0

  // Guided 4-step enrollment state
  private var enrollStepIndex: Int = 0
  private val enrollStepFrames = ArrayList<DoubleArray>(ENROLL_STEP_SAMPLES)
  private val enrollPoseSamples = ArrayList<DoubleArray>(4)
  private var firstTurnSign: Int = 0
  private var capturedFrontBitmap: Bitmap? = null

  @Volatile private var lastAnalyzeMs: Long = 0L
  @Volatile private var currentPhase: Phase = Phase.INITIALIZING
  @Volatile private var bridgeReady: Boolean = false
  @Volatile private var tfliteReady: Boolean = false

  private var cameraProvider: ProcessCameraProvider? = null
  private var interpreter: InterpreterApi? = null
  private var embeddingDim: Int = DEFAULT_EMBEDDING_DIM
  private lateinit var faceDetector: FaceDetector
  private lateinit var analysisExecutor: ExecutorService

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    mode = intent.getStringExtra(EXTRA_MODE) ?: "verify"
    val heading = intent.getStringExtra(EXTRA_TITLE) ?: when (mode) {
      "enroll" -> "Daftarkan Wajah Karyawan"
      "bridge_verify" -> "Penyelarasan Data Wajah"
      else -> "Scan Wajah Langsung"
    }

    referenceTemplates = parseReferenceTemplates(intent)
    refImagePath = intent.getStringExtra(EXTRA_REF_IMAGE_PATH)
    bridgeReady = mode != "bridge_verify"

    analysisExecutor = Executors.newSingleThreadExecutor()
    faceDetector = FaceDetection.getClient(
      FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
        .setMinFaceSize(0.12f)
        .build(),
    )

    buildUi(heading)

    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      startCameraAndModels()
    } else {
      requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_CODE)
    }
  }

  private fun parseReferenceTemplates(intent: Intent): List<DoubleArray> {
    val flat = intent.getDoubleArrayExtra(EXTRA_REF_DESCRIPTORS)
    val count = intent.getIntExtra(EXTRA_REF_DESCRIPTOR_COUNT, 0)
    if (flat != null && count > 0 && flat.size >= count && flat.size % count == 0) {
      val dim = flat.size / count
      val out = ArrayList<DoubleArray>(count)
      for (i in 0 until count) {
        val slice = DoubleArray(dim) { j -> flat[i * dim + j] }
        out.add(l2Normalize(slice))
      }
      return out
    }
    val single = intent.getDoubleArrayExtra(EXTRA_REF_DESCRIPTOR)
    return if (single != null && single.isNotEmpty()) listOf(l2Normalize(single)) else emptyList()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != CAMERA_PERMISSION_CODE) return
    if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
      startCameraAndModels()
    } else {
      showFatalError("Izin kamera ditolak. Aktifkan izin kamera untuk melanjutkan absensi scan wajah.")
    }
  }

  private fun dp(value: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP,
    value.toFloat(),
    resources.displayMetrics,
  ).roundToInt()

  private fun buildUi(heading: String) {
    rootFrame = FrameLayout(this).apply {
      setBackgroundColor(Color.parseColor("#0B1110"))
    }

    previewView = PreviewView(this).apply {
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
    }
    rootFrame.addView(
      previewView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )

    guideOverlay = FaceGuideOverlayView(this)
    rootFrame.addView(
      guideOverlay,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ),
    )

    val topBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(16), dp(42), dp(16), dp(12))
    }

    val headerCol = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }
    titleText = TextView(this).apply {
      text = heading
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      typeface = Typeface.DEFAULT_BOLD
    }
    subtitleText = TextView(this).apply {
      text = if (mode == "enroll") {
        "Lakukan 4 langkah pemindaian agar wajah akurat dikenali saat absensi."
      } else {
        "Deteksi otomatis berlangsung. Jika wajah berbeda, absensi akan ditolak."
      }
      setTextColor(Color.parseColor("#CBD5E1"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(0, dp(4), dp(8), 0)
    }
    headerCol.addView(titleText)
    headerCol.addView(subtitleText)

    val closeBtn = Button(this).apply {
      text = "✕"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = Typeface.DEFAULT_BOLD
      contentDescription = "Tutup pemindai wajah"
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#B0111827"))
        setStroke(dp(1), Color.parseColor("#64748B"))
      }
      setOnClickListener {
        setResult(Activity.RESULT_CANCELED)
        finish()
      }
    }
    topBar.addView(headerCol)
    topBar.addView(closeBtn, LinearLayout.LayoutParams(dp(44), dp(44)))

    rootFrame.addView(
      topBar,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.TOP,
      ),
    )

    val bottomCard = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(16), dp(14), dp(16), dp(18))
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.parseColor("#E6111827"))
        setStroke(dp(1), Color.parseColor("#334155"))
      }
    }

    alertBanner = TextView(this).apply {
      visibility = View.GONE
      setTextColor(Color.parseColor("#FEE2E2"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        setColor(Color.parseColor("#B37F1D1D"))
        setStroke(dp(1), Color.parseColor("#EF4444"))
      }
    }
    bottomCard.addView(alertBanner)

    enrollStepsRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      visibility = if (mode == "enroll") View.VISIBLE else View.GONE
      setPadding(0, dp(2), 0, dp(8))
    }
    enrollChipViews.clear()
    for (i in 0 until 4) {
      val chip = TextView(this).apply {
        text = ENROLL_STEP_LABELS[i]
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
        typeface = Typeface.DEFAULT_BOLD
        setPadding(dp(4), dp(5), dp(4), dp(5))
      }
      val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        if (i > 0) leftMargin = dp(6)
      }
      enrollChipViews.add(chip)
      enrollStepsRow.addView(chip, lp)
    }
    bottomCard.addView(enrollStepsRow)
    refreshEnrollStepChips(activeIndex = 0)

    statusText = TextView(this).apply {
      text = "Menyiapkan kamera dan model wajah..."
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(0, dp(4), 0, dp(2))
    }
    bottomCard.addView(statusText)

    stepText = TextView(this).apply {
      text = "Tunggu sebentar..."
      setTextColor(Color.parseColor("#94A3B8"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(6))
    }
    bottomCard.addView(stepText)

    retryButton = Button(this).apply {
      text = "Scan Ulang"
      visibility = View.GONE
      setAllCaps(false)
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      background = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        setColor(Color.parseColor("#0F766E"))
      }
      setOnClickListener {
        if (currentPhase == Phase.FATAL_ERROR) {
          setResult(Activity.RESULT_CANCELED)
          finish()
        } else {
          resumeScanning()
        }
      }
    }
    bottomCard.addView(
      retryButton,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(44),
      ).apply { topMargin = dp(8) },
    )

    val bottomParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.WRAP_CONTENT,
      Gravity.BOTTOM,
    ).apply {
      leftMargin = dp(16)
      rightMargin = dp(16)
      bottomMargin = dp(24)
    }
    rootFrame.addView(bottomCard, bottomParams)

    setContentView(rootFrame)
  }

  private fun refreshEnrollStepChips(activeIndex: Int) {
    for (i in enrollChipViews.indices) {
      val chip = enrollChipViews[i]
      val completed = i < activeIndex
      val current = i == activeIndex
      chip.setTextColor(
        when {
          completed -> Color.parseColor("#064E3B")
          current -> Color.WHITE
          else -> Color.parseColor("#94A3B8")
        },
      )
      chip.background = GradientDrawable().apply {
        cornerRadius = dp(8).toFloat()
        when {
          completed -> {
            setColor(Color.parseColor("#6EE7B7"))
            setStroke(dp(1), Color.parseColor("#10B981"))
          }
          current -> {
            setColor(Color.parseColor("#0F766E"))
            setStroke(dp(1), Color.parseColor("#34D399"))
          }
          else -> {
            setColor(Color.parseColor("#1E293B"))
            setStroke(dp(1), Color.parseColor("#334155"))
          }
        }
      }
    }
  }

  private fun triggerConfirmHaptic() {
    runOnUiThread {
      val flag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        HapticFeedbackConstants.CONFIRM
      } else {
        HapticFeedbackConstants.KEYBOARD_TAP
      }
      rootFrame.performHapticFeedback(flag)
    }
  }

  private fun startCameraAndModels() {
    updateGuide(
      status = "Menyiapkan kamera dan model pengenalan wajah...",
      step = "Memuat MobileFaceNet...",
      tone = GuideTone.NEUTRAL,
      progress = 0f,
    )
    startCameraPreviewAndAnalysis()
    initializeTfliteAndBridgeReference()
  }

  private fun startCameraPreviewAndAnalysis() {
    val providerFuture = ProcessCameraProvider.getInstance(this)
    providerFuture.addListener(
      {
        try {
          val provider = providerFuture.get()
          cameraProvider = provider
          val preview = Preview.Builder().build().also {
            it.surfaceProvider = previewView.surfaceProvider
          }
          val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
            .also {
              it.setAnalyzer(analysisExecutor) { imageProxy ->
                analyzeCameraFrame(imageProxy)
              }
            }

          provider.unbindAll()
          provider.bindToLifecycle(
            this,
            CameraSelector.DEFAULT_FRONT_CAMERA,
            preview,
            analysis,
          )
        } catch (err: Exception) {
          showFatalError("Kamera depan gagal dibuka: ${err.message ?: "kesalahan kamera"}")
        }
      },
      ContextCompat.getMainExecutor(this),
    )
  }

  private fun initializeTfliteAndBridgeReference() {
    TfLite.initialize(this)
      .addOnSuccessListener(analysisExecutor) {
        try {
          val modelBytes = assets.open("mobilefacenet.tflite").use { it.readBytes() }
          val buffer = ByteBuffer.allocateDirect(modelBytes.size).order(ByteOrder.nativeOrder())
          buffer.put(modelBytes)
          buffer.rewind()

          val options = InterpreterApi.Options()
            .setRuntime(InterpreterApi.Options.TfLiteRuntime.FROM_SYSTEM_ONLY)
          val interp = InterpreterApi.create(buffer, options)
          val outShape = interp.getOutputTensor(0).shape()
          if (outShape.isNotEmpty() && outShape.last() > 0) {
            embeddingDim = outShape.last()
          }
          interpreter = interp
          tfliteReady = true

          if (mode == "bridge_verify") {
            prepareBridgeReferenceDescriptor(interp)
          } else {
            markReadyToScan()
          }
        } catch (err: Exception) {
          showFatalError("Model wajah gagal dimuat: ${err.message ?: "error"}")
        }
      }
      .addOnFailureListener { err ->
        showFatalError("Layanan pengenalan wajah tidak siap: ${err.message ?: "error"}")
      }
  }

  private fun prepareBridgeReferenceDescriptor(interp: InterpreterApi) {
    val path = refImagePath
    if (path.isNullOrBlank()) {
      showFatalError("Foto referensi wajah tidak ditemukan untuk akun ini.")
      return
    }
    val raw = BitmapFactory.decodeFile(path)
    if (raw == null) {
      showFatalError("Foto referensi wajah gagal didekode.")
      return
    }
    val oriented = applyExifRotation(path, raw)
    faceDetector.process(InputImage.fromBitmap(oriented, 0))
      .addOnSuccessListener(analysisExecutor) { faces ->
        try {
          if (faces.isEmpty()) {
            showFatalError("Wajah tidak terdeteksi di foto acuan akun. Perbarui data wajah dari menu Profil.")
            return@addOnSuccessListener
          }
          val primary = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]
          val emb = extractEmbeddingFromFace(interp, oriented, primary)
          bridgeRefTemplates = listOf(emb)
          bridgeReady = true
          markReadyToScan()
        } catch (err: Exception) {
          showFatalError("Gagal memproses foto acuan akun: ${err.message ?: "error"}")
        } finally {
          oriented.recycle()
        }
      }
      .addOnFailureListener { err ->
        oriented.recycle()
        showFatalError("Gagal membaca wajah acuan: ${err.message ?: "error"}")
      }
  }

  private fun markReadyToScan() {
    if (currentPhase == Phase.FATAL_ERROR) return
    currentPhase = Phase.SCANNING
    if (mode == "enroll") {
      updateGuide(
        status = "Tahap 1/4: Hadap Lurus ke Kamera",
        step = "Pastikan wajah berada di dalam bingkai oval",
        tone = GuideTone.NEUTRAL,
        progress = 0f,
        enrollIdx = 0,
      )
    } else {
      updateGuide(
        status = "Arahkan wajah Anda ke dalam bingkai oval",
        step = "Deteksi wajah otomatis aktif",
        tone = GuideTone.NEUTRAL,
        progress = 0f,
      )
    }
  }

  private fun analyzeCameraFrame(imageProxy: ImageProxy) {
    val now = System.currentTimeMillis()
    if (!tfliteReady || !bridgeReady || isSettled.get() || currentPhase == Phase.FATAL_ERROR) {
      imageProxy.close()
      return
    }
    if (now - lastAnalyzeMs < 150L || !isProcessingFrame.compareAndSet(false, true)) {
      imageProxy.close()
      return
    }
    lastAnalyzeMs = now

    var uprightBitmap: Bitmap? = null
    try {
      val rotation = imageProxy.imageInfo.rotationDegrees
      val raw = imageProxy.toBitmap()
      uprightBitmap = if (rotation != 0) {
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also {
          if (it !== raw) raw.recycle()
        }
      } else {
        raw
      }
    } catch (_: Exception) {
      uprightBitmap?.recycle()
      isProcessingFrame.set(false)
      imageProxy.close()
      return
    } finally {
      imageProxy.close()
    }

    val frameBitmap = uprightBitmap ?: run {
      isProcessingFrame.set(false)
      return
    }

    faceDetector.process(InputImage.fromBitmap(frameBitmap, 0))
      .addOnSuccessListener(analysisExecutor) { faces ->
        handleDetectedFaces(frameBitmap, faces)
      }
      .addOnFailureListener {
        frameBitmap.recycle()
        isProcessingFrame.set(false)
      }
  }

  private fun handleDetectedFaces(frameBitmap: Bitmap, faces: List<Face>) {
    try {
      if (isSettled.get() || currentPhase != Phase.SCANNING) return

      if (faces.isEmpty()) {
        clearActiveFrameBuffer()
        updateGuide(
          status = if (mode == "enroll") {
            "Tahap ${enrollStepIndex + 1}/4: Arahkan wajah ke bingkai"
          } else {
            "Arahkan wajah Anda ke dalam bingkai oval"
          },
          step = "Belum ada wajah terdeteksi",
          tone = GuideTone.NEUTRAL,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }
      if (faces.size > 1) {
        clearActiveFrameBuffer()
        updateGuide(
          status = "Hanya 1 wajah yang diizinkan di depan kamera",
          step = "Terdeteksi ${faces.size} wajah",
          tone = GuideTone.DANGER,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }

      val face = faces[0]
      val box = face.boundingBox
      val shortSide = min(frameBitmap.width, frameBitmap.height).coerceAtLeast(1).toFloat()
      val faceSizeRatio = max(box.width(), box.height()).toFloat() / shortSide
      if (faceSizeRatio < 0.22f) {
        clearActiveFrameBuffer()
        updateGuide(
          status = "Dekatkan wajah ke bingkai oval",
          step = "Posisi wajah masih terlalu jauh",
          tone = GuideTone.NEUTRAL,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }
      if (faceSizeRatio > 0.88f) {
        clearActiveFrameBuffer()
        updateGuide(
          status = "Jauhkan sedikit wajah dari kamera",
          step = "Posisi wajah terlalu dekat",
          tone = GuideTone.NEUTRAL,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }

      val cx = box.exactCenterX() / frameBitmap.width.coerceAtLeast(1)
      val cy = box.exactCenterY() / frameBitmap.height.coerceAtLeast(1)
      if (abs(cx - 0.50f) > 0.28f || abs(cy - 0.46f) > 0.30f) {
        clearActiveFrameBuffer()
        updateGuide(
          status = "Posisikan wajah tepat di tengah bingkai oval",
          step = "Wajah belum berada di tengah bingkai",
          tone = GuideTone.NEUTRAL,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }

      val meanLuma = estimateBoxMeanLuminance(frameBitmap, box)
      if (meanLuma < 36f) {
        clearActiveFrameBuffer()
        updateGuide(
          status = "Pencahayaan terlalu gelap",
          step = "Pindah ke area yang lebih terang",
          tone = GuideTone.NEUTRAL,
          progress = currentProgress(),
          enrollIdx = enrollStepIndex,
        )
        return
      }

      val interp = interpreter ?: return
      if (mode == "enroll") {
        handleEnrollmentFrame(frameBitmap, face, interp)
      } else {
        handleVerifyFrame(frameBitmap, face, interp)
      }
    } catch (err: Exception) {
      clearActiveFrameBuffer()
      updateGuide(
        status = "Gagal membaca fitur wajah, posisikan ulang",
        step = err.message ?: "Silakan coba lagi",
        tone = GuideTone.DANGER,
        progress = currentProgress(),
        enrollIdx = enrollStepIndex,
      )
    } finally {
      frameBitmap.recycle()
      isProcessingFrame.set(false)
    }
  }

  private fun handleEnrollmentFrame(
    frameBitmap: Bitmap,
    face: Face,
    interp: InterpreterApi,
  ) {
    val yaw = face.headEulerAngleY
    val pitch = face.headEulerAngleX
    val leftEyeOpen = face.leftEyeOpenProbability
    val rightEyeOpen = face.rightEyeOpenProbability

    val stepIdx: Int
    val turnSignNow: Int
    synchronized(scanLock) {
      stepIdx = enrollStepIndex
      turnSignNow = firstTurnSign
    }

    when (stepIdx) {
      0, 3 -> {
        if ((leftEyeOpen != null && leftEyeOpen < 0.35f) ||
          (rightEyeOpen != null && rightEyeOpen < 0.35f)
        ) {
          clearActiveFrameBuffer()
          updateGuide(
            status = "Tahap ${stepIdx + 1}/4: Buka kedua mata",
            step = "Tatap lurus ke kamera tanpa memejamkan mata",
            tone = GuideTone.NEUTRAL,
            progress = stepIdx / 4f,
            enrollIdx = stepIdx,
          )
          return
        }
        if (abs(yaw) > 12f || abs(pitch) > 16f) {
          clearActiveFrameBuffer()
          updateGuide(
            status = if (stepIdx == 0) {
              "Tahap 1/4: Hadap Lurus ke Kamera"
            } else {
              "Tahap 4/4: Hadap Lurus Kembali"
            },
            step = "Luruskan posisi kepala menghadap depan",
            tone = GuideTone.NEUTRAL,
            progress = stepIdx / 4f,
            enrollIdx = stepIdx,
          )
          return
        }
      }
      1 -> {
        if (abs(yaw) < 11f || abs(yaw) > 42f || abs(pitch) > 22f) {
          clearActiveFrameBuffer()
          updateGuide(
            status = "Tahap 2/4: Tengok Sedikit ke Kiri",
            step = "Putar wajah ±20° ke kiri/samping lalu tahan",
            tone = GuideTone.NEUTRAL,
            progress = 0.25f,
            enrollIdx = 1,
          )
          return
        }
      }
      2 -> {
        val requiredOppositeYaw = yaw * (-turnSignNow)
        if (requiredOppositeYaw < 11f || abs(yaw) > 42f || abs(pitch) > 22f) {
          clearActiveFrameBuffer()
          val sameSideHint = yaw * turnSignNow > 8f
          updateGuide(
            status = "Tahap 3/4: Tengok Sedikit ke Kanan",
            step = if (sameSideHint) {
              "Tengok ke sisi sebaliknya dari langkah sebelumnya"
            } else {
              "Putar wajah ±20° ke arah berlawanan lalu tahan"
            },
            tone = GuideTone.NEUTRAL,
            progress = 0.50f,
            enrollIdx = 2,
          )
          return
        }
      }
    }

    val embedding = extractEmbeddingFromFace(interp, frameBitmap, face)
    var stepJustCompleted = false
    var nextStep = stepIdx
    var consistencyFailed = false
    var completedAll = false
    var finalCentroid: DoubleArray? = null
    var allSamples: List<DoubleArray>? = null

    synchronized(scanLock) {
      if (isSettled.get() || enrollStepIndex != stepIdx) return
      enrollStepFrames.add(embedding)
      if (enrollStepFrames.size >= ENROLL_STEP_SAMPLES) {
        val poseAvg = averageVectors(enrollStepFrames)
        enrollStepFrames.clear()
        stepJustCompleted = true

        if (stepIdx == 0) {
          capturedFrontBitmap?.recycle()
          capturedFrontBitmap = frameBitmap.copy(Bitmap.Config.ARGB_8888, false)
          enrollPoseSamples.clear()
          enrollPoseSamples.add(poseAvg)
          enrollStepIndex = 1
          nextStep = 1
        } else if (stepIdx == 1) {
          firstTurnSign = if (yaw >= 0f) 1 else -1
          enrollPoseSamples.add(poseAvg)
          enrollStepIndex = 2
          nextStep = 2
        } else if (stepIdx == 2) {
          enrollPoseSamples.add(poseAvg)
          enrollStepIndex = 3
          nextStep = 3
        } else {
          val selfSim = cosineSimilarity(enrollPoseSamples[0], poseAvg)
          if (selfSim < 0.48) {
            consistencyFailed = true
            enrollStepIndex = 0
            firstTurnSign = 0
            enrollPoseSamples.clear()
            capturedFrontBitmap?.recycle()
            capturedFrontBitmap = null
          } else {
            enrollPoseSamples.add(poseAvg)
            isSettled.set(true)
            completedAll = true
            finalCentroid = averageVectors(enrollPoseSamples)
            allSamples = enrollPoseSamples.toList()
          }
        }
      }
    }

    if (consistencyFailed) {
      updateGuide(
        status = "Wajah tidak konsisten, ulangi Tahap 1/4",
        step = "Pastikan orang yang sama di semua tahap pemindaian",
        tone = GuideTone.DANGER,
        progress = 0f,
        enrollIdx = 0,
      )
      return
    }

    if (completedAll && finalCentroid != null && allSamples != null) {
      triggerConfirmHaptic()
      val refBitmap = capturedFrontBitmap ?: frameBitmap
      val snapshotFile = saveUprightSnapshot(refBitmap)
      capturedFrontBitmap?.recycle()
      capturedFrontBitmap = null

      val dim = finalCentroid!!.size
      val flatSamples = DoubleArray(allSamples!!.size * dim)
      for (sIdx in allSamples!!.indices) {
        val vec = allSamples!![sIdx]
        for (j in 0 until dim) {
          flatSamples[sIdx * dim + j] = vec[j]
        }
      }

      currentPhase = Phase.VERIFIED
      runOnUiThread {
        refreshEnrollStepChips(activeIndex = 4)
        guideOverlay.setState(GuideTone.ACCENT, 1f)
        alertBanner.visibility = View.GONE
        retryButton.visibility = View.GONE
        statusText.text = "4 tahap pemindaian selesai! Menyimpan profil wajah..."
        stepText.text = "Pendaftaran berhasil"
      }

      val out = Intent().apply {
        putExtra(RESULT_IMAGE_PATH, snapshotFile.absolutePath)
        putExtra(RESULT_DESCRIPTOR, finalCentroid)
        putExtra(RESULT_SAMPLES, flatSamples)
        putExtra(RESULT_SAMPLE_COUNT, allSamples!!.size)
        putExtra(RESULT_POSES, ENROLL_POSE_KEYS)
        putExtra(RESULT_SIMILARITY_PERCENT, 100)
        putExtra(RESULT_MATCHED, true)
      }
      setResult(Activity.RESULT_OK, out)
      finish()
      return
    }

    if (stepJustCompleted) {
      triggerConfirmHaptic()
      val (promptStatus, promptSub) = when (nextStep) {
        1 -> "Bagus! Tahap 2/4: Tengok Sedikit ke Kiri" to "Putar wajah ±20° ke samping"
        2 -> "Bagus! Tahap 3/4: Tengok Sedikit ke Kanan" to "Putar wajah ke sisi sebaliknya"
        else -> "Bagus! Tahap 4/4: Hadap Lurus Kembali" to "Tatap kamera untuk konfirmasi akhir"
      }
      updateGuide(
        status = promptStatus,
        step = promptSub,
        tone = GuideTone.ACCENT,
        progress = nextStep / 4f,
        enrollIdx = nextStep,
      )
    } else {
      val collected = synchronized(scanLock) { enrollStepFrames.size }
      val partialProgress = (stepIdx + (collected.toFloat() / ENROLL_STEP_SAMPLES)) / 4f
      val holdLabel = when (stepIdx) {
        0 -> "Tahap 1/4: Tahan posisi hadap lurus..."
        1 -> "Tahap 2/4: Tahan posisi samping..."
        2 -> "Tahap 3/4: Tahan posisi sisi sebaliknya..."
        else -> "Tahap 4/4: Mengunci konfirmasi wajah..."
      }
      updateGuide(
        status = holdLabel,
        step = "Menangkap sampel sudut ($collected/$ENROLL_STEP_SAMPLES)",
        tone = GuideTone.ACCENT,
        progress = partialProgress,
        enrollIdx = stepIdx,
      )
    }
  }

  private fun handleVerifyFrame(
    frameBitmap: Bitmap,
    face: Face,
    interp: InterpreterApi,
  ) {
    val yaw = face.headEulerAngleY
    val pitch = face.headEulerAngleX
    if (abs(yaw) > 24f || abs(pitch) > 24f) {
      clearActiveFrameBuffer()
      updateGuide(
        status = "Hadapkan wajah langsung ke kamera",
        step = "Posisi kepala terlalu miring untuk verifikasi",
        tone = GuideTone.NEUTRAL,
        progress = 0f,
      )
      return
    }

    val embedding = extractEmbeddingFromFace(interp, frameBitmap, face)
    var collected = 0
    var averaged: DoubleArray? = null
    synchronized(scanLock) {
      verifySamples.add(embedding)
      if (verifySamples.size > VERIFY_REQUIRED_STABILITY) {
        verifySamples.removeAt(0)
      }
      collected = verifySamples.size
      if (collected >= VERIFY_REQUIRED_STABILITY) {
        isSettled.set(true)
        averaged = averageVectors(verifySamples)
      }
    }

    if (averaged == null) {
      updateGuide(
        status = "Tahan posisi... mengunci wajah ($collected/$VERIFY_REQUIRED_STABILITY)",
        step = "Tetap menghadap kamera",
        tone = GuideTone.ACCENT,
        progress = collected.toFloat() / VERIFY_REQUIRED_STABILITY.toFloat(),
      )
      return
    }

    completeVerificationWithEmbedding(frameBitmap, averaged!!)
  }

  private fun completeVerificationWithEmbedding(frameBitmap: Bitmap, probeDescriptor: DoubleArray) {
    val activeTemplates = when (mode) {
      "bridge_verify" -> bridgeRefTemplates
      "verify" -> referenceTemplates
      else -> emptyList()
    }

    var similarityPercent = 100
    if (activeTemplates.isNotEmpty()) {
      val bestCosine = activeTemplates.maxOf { cosineSimilarity(it, probeDescriptor) }
      similarityPercent = max(0, min(100, (max(0.0, bestCosine) * 100.0).roundToInt()))
      if (bestCosine < MOBILE_COSINE_THRESHOLD) {
        val shouldAutoRetry = synchronized(scanLock) {
          if (verifyRetryCount < MAX_VERIFY_RETRY) {
            verifyRetryCount += 1
            verifySamples.clear()
            true
          } else {
            false
          }
        }
        if (shouldAutoRetry) {
          isSettled.set(false)
          updateGuide(
            status = "Mencocokkan ulang ($verifyRetryCount/$MAX_VERIFY_RETRY)...",
            step = "Hadapkan wajah jelas ke kamera dengan cahaya cukup",
            tone = GuideTone.NEUTRAL,
            progress = 0.15f,
          )
          return
        }

        currentPhase = Phase.MISMATCH
        runOnUiThread {
          guideOverlay.setState(GuideTone.DANGER, 1f)
          alertBanner.text =
            "Wajah tidak cocok dengan karyawan terdaftar (kemiripan $similarityPercent%). Absensi ditolak."
          alertBanner.visibility = View.VISIBLE
          statusText.text = "Identitas wajah tidak cocok"
          stepText.text = "Tekan Scan Ulang untuk mencoba lagi"
          retryButton.text = "Scan Ulang"
          retryButton.visibility = View.VISIBLE
        }
        return
      }
    }

    val snapshotFile = saveUprightSnapshot(frameBitmap)
    currentPhase = Phase.VERIFIED
    triggerConfirmHaptic()
    runOnUiThread {
      guideOverlay.setState(GuideTone.ACCENT, 1f)
      alertBanner.visibility = View.GONE
      retryButton.visibility = View.GONE
      statusText.text = "Wajah cocok ($similarityPercent%). Mengirim absensi..."
      stepText.text = "Verifikasi berhasil"
    }

    val out = Intent().apply {
      putExtra(RESULT_IMAGE_PATH, snapshotFile.absolutePath)
      putExtra(RESULT_DESCRIPTOR, probeDescriptor)
      if (mode == "bridge_verify" && bridgeRefTemplates.isNotEmpty()) {
        putExtra(RESULT_REF_DESCRIPTOR, bridgeRefTemplates.first())
      }
      putExtra(RESULT_SIMILARITY_PERCENT, similarityPercent)
      putExtra(RESULT_MATCHED, true)
    }
    setResult(Activity.RESULT_OK, out)
    finish()
  }

  private fun clearActiveFrameBuffer() {
    synchronized(scanLock) {
      if (mode == "enroll") {
        enrollStepFrames.clear()
      } else {
        verifySamples.clear()
      }
    }
  }

  private fun currentProgress(): Float {
    synchronized(scanLock) {
      return if (mode == "enroll") enrollStepIndex / 4f else 0f
    }
  }

  private fun resumeScanning() {
    synchronized(scanLock) {
      verifySamples.clear()
      verifyRetryCount = 0
      enrollStepFrames.clear()
      enrollPoseSamples.clear()
      enrollStepIndex = 0
      firstTurnSign = 0
      capturedFrontBitmap?.recycle()
      capturedFrontBitmap = null
    }
    currentPhase = Phase.SCANNING
    isSettled.set(false)
    runOnUiThread {
      alertBanner.visibility = View.GONE
      retryButton.visibility = View.GONE
      refreshEnrollStepChips(activeIndex = 0)
      guideOverlay.setState(GuideTone.NEUTRAL, 0f)
      statusText.text = if (mode == "enroll") {
        "Tahap 1/4: Hadap Lurus ke Kamera"
      } else {
        "Arahkan wajah Anda ke dalam bingkai oval"
      }
      stepText.text = "Deteksi wajah otomatis aktif"
    }
  }

  private fun updateGuide(
    status: String,
    step: String,
    tone: GuideTone,
    progress: Float,
    enrollIdx: Int = 0,
  ) {
    runOnUiThread {
      if (currentPhase == Phase.MISMATCH || currentPhase == Phase.FATAL_ERROR) return@runOnUiThread
      if (mode == "enroll") {
        refreshEnrollStepChips(activeIndex = enrollIdx)
      }
      guideOverlay.setState(tone, progress)
      statusText.text = status
      stepText.text = step
    }
  }

  private fun showFatalError(message: String) {
    currentPhase = Phase.FATAL_ERROR
    isSettled.set(true)
    runOnUiThread {
      guideOverlay.setState(GuideTone.DANGER, 0f)
      alertBanner.text = message
      alertBanner.visibility = View.VISIBLE
      statusText.text = "Pemindaian tidak dapat dilanjutkan"
      stepText.text = "Tutup lalu periksa izin atau status wajah"
      retryButton.text = "Tutup"
      retryButton.visibility = View.VISIBLE
    }
  }

  private fun estimateBoxMeanLuminance(bitmap: Bitmap, box: Rect): Float {
    val left = max(0, box.left)
    val top = max(0, box.top)
    val right = min(bitmap.width - 1, box.right)
    val bottom = min(bitmap.height - 1, box.bottom)
    if (right <= left || bottom <= top) return 128f

    val cols = 10
    val rows = 10
    var sum = 0f
    var count = 0
    for (r in 0 until rows) {
      val y = top + ((bottom - top) * (r + 0.5f) / rows).toInt().coerceIn(0, bottom - top)
      for (c in 0 until cols) {
        val x = left + ((right - left) * (c + 0.5f) / cols).toInt().coerceIn(0, right - left)
        val px = bitmap.getPixel(x, y)
        val rr = (px shr 16) and 0xFF
        val gg = (px shr 8) and 0xFF
        val bb = px and 0xFF
        sum += 0.299f * rr + 0.587f * gg + 0.114f * bb
        count++
      }
    }
    return if (count > 0) sum / count else 128f
  }

  private fun extractEmbeddingFromFace(
    interp: InterpreterApi,
    source: Bitmap,
    face: Face,
  ): DoubleArray {
    val box = face.boundingBox
    val cropSide = max(box.width(), box.height()).toFloat() * 1.18f
    if (cropSide < 16f) {
      throw IllegalStateException("Area wajah terlalu kecil.")
    }

    // Align face horizontally using eye landmark coordinates when both eyes are detected.
    var alignAngleDeg = 0f
    val le = face.getLandmark(FaceLandmark.LEFT_EYE)?.position
    val re = face.getLandmark(FaceLandmark.RIGHT_EYE)?.position
    if (le != null && re != null) {
      val leftMost = if (le.x <= re.x) le else re
      val rightMost = if (le.x <= re.x) re else le
      val dx = (rightMost.x - leftMost.x).toDouble()
      val dy = (rightMost.y - leftMost.y).toDouble()
      if (dx > 4.0) {
        alignAngleDeg = (-Math.toDegrees(atan2(dy, dx))).toFloat().coerceIn(-45f, 45f)
      }
    }

    val matrix = Matrix().apply {
      postTranslate(-box.exactCenterX(), -box.exactCenterY())
      if (abs(alignAngleDeg) > 3.5f) {
        postRotate(alignAngleDeg)
      }
      val scale = MODEL_INPUT_SIZE.toFloat() / cropSide
      postScale(scale, scale)
      postTranslate(MODEL_INPUT_SIZE / 2f, MODEL_INPUT_SIZE / 2f)
    }

    val scaled = Bitmap.createBitmap(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(scaled)
    canvas.drawColor(Color.BLACK)
    canvas.drawBitmap(source, matrix, Paint(Paint.FILTER_BITMAP_FLAG))

    val inputBuffer = ByteBuffer.allocateDirect(4 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE * 3)
      .order(ByteOrder.nativeOrder())
    val pixels = IntArray(MODEL_INPUT_SIZE * MODEL_INPUT_SIZE)
    scaled.getPixels(pixels, 0, MODEL_INPUT_SIZE, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
    scaled.recycle()

    for (pixel in pixels) {
      val r = (((pixel shr 16) and 0xFF) - 127.5f) / 128f
      val g = (((pixel shr 8) and 0xFF) - 127.5f) / 128f
      val b = ((pixel and 0xFF) - 127.5f) / 128f
      inputBuffer.putFloat(r)
      inputBuffer.putFloat(g)
      inputBuffer.putFloat(b)
    }
    inputBuffer.rewind()

    val output = Array(1) { FloatArray(embeddingDim) }
    interp.run(inputBuffer, output)

    val rawVec = DoubleArray(embeddingDim) { idx -> output[0][idx].toDouble() }
    return l2Normalize(rawVec)
  }

  private fun saveUprightSnapshot(source: Bitmap): File {
    val maxDim = max(source.width, source.height)
    val outBitmap = if (maxDim > 720) {
      val scale = 720f / maxDim.toFloat()
      val targetW = max(1, (source.width * scale).roundToInt())
      val targetH = max(1, (source.height * scale).roundToInt())
      Bitmap.createScaledBitmap(source, targetW, targetH, true)
    } else {
      source
    }

    val file = File(cacheDir, "face_capture_${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { stream ->
      outBitmap.compress(Bitmap.CompressFormat.JPEG, 86, stream)
    }
    if (outBitmap !== source) {
      outBitmap.recycle()
    }
    return file
  }

  private fun applyExifRotation(path: String, raw: Bitmap): Bitmap {
    return try {
      val exif = ExifInterface(path)
      val orientation = exif.getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
      val matrix = Matrix()
      when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
        else -> return raw
      }
      Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true).also {
        if (it !== raw) raw.recycle()
      }
    } catch (_: Exception) {
      raw
    }
  }

  private fun l2Normalize(vec: DoubleArray): DoubleArray {
    var normSq = 0.0
    for (v in vec) {
      normSq += v * v
    }
    val norm = sqrt(normSq)
    if (norm <= 1e-6) return vec
    return DoubleArray(vec.size) { i -> vec[i] / norm }
  }

  private fun averageVectors(list: List<DoubleArray>): DoubleArray {
    val dim = list.first().size
    val sum = DoubleArray(dim)
    for (vec in list) {
      for (i in 0 until dim) {
        sum[i] += vec[i]
      }
    }
    val count = list.size.toDouble()
    for (i in 0 until dim) {
      sum[i] /= count
    }
    return l2Normalize(sum)
  }

  private fun cosineSimilarity(a: DoubleArray, b: DoubleArray): Double {
    val len = min(a.size, b.size)
    var dot = 0.0
    for (i in 0 until len) {
      dot += a[i] * b[i]
    }
    return dot
  }

  override fun onDestroy() {
    super.onDestroy()
    synchronized(scanLock) {
      capturedFrontBitmap?.recycle()
      capturedFrontBitmap = null
    }
    try {
      cameraProvider?.unbindAll()
    } catch (_: Exception) {
    }
    try {
      faceDetector.close()
    } catch (_: Exception) {
    }
    try {
      interpreter?.close()
    } catch (_: Exception) {
    }
    analysisExecutor.shutdownNow()
  }

  private class FaceGuideOverlayView(context: Context) : View(context) {
    private val scrimPath = Path().apply { fillType = Path.FillType.EVEN_ODD }
    private val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#8C000000")
      style = Paint.Style.FILL
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 3f * context.resources.displayMetrics.density
      color = Color.parseColor("#E2E8F0")
    }
    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeWidth = 5f * context.resources.displayMetrics.density
      color = Color.parseColor("#10B981")
    }
    private val ovalRect = RectF()
    private var progress: Float = 0f

    fun setState(tone: GuideTone, progressValue: Float) {
      borderPaint.color = when (tone) {
        GuideTone.NEUTRAL -> Color.parseColor("#E2E8F0")
        GuideTone.ACCENT -> Color.parseColor("#10B981")
        GuideTone.DANGER -> Color.parseColor("#EF4444")
      }
      arcPaint.color = if (tone == GuideTone.DANGER) {
        Color.parseColor("#EF4444")
      } else {
        Color.parseColor("#10B981")
      }
      progress = progressValue.coerceIn(0f, 1f)
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val w = width.toFloat()
      val h = height.toFloat()
      val ovalW = min(w * 0.66f, 290f * resources.displayMetrics.density)
      val ovalH = ovalW * 1.32f
      val left = (w - ovalW) / 2f
      val top = (h - ovalH) * 0.42f
      ovalRect.set(left, top, left + ovalW, top + ovalH)

      scrimPath.reset()
      scrimPath.addRect(0f, 0f, w, h, Path.Direction.CW)
      scrimPath.addOval(ovalRect, Path.Direction.CW)
      canvas.drawPath(scrimPath, scrimPaint)
      canvas.drawOval(ovalRect, borderPaint)

      if (progress > 0f) {
        canvas.drawArc(ovalRect, -90f, 360f * progress, false, arcPaint)
      }
    }
  }
}
