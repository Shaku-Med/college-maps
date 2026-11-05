package expo.modules.phonesound

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhoneSoundModule : Module() {
  private val audio: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
  private val ignoreFocusChange = AudioManager.OnAudioFocusChangeListener {}
  private var focus: AudioFocusRequest? = null
  private var modeListener: AudioManager.OnModeChangedListener? = null

  override fun definition() = ModuleDefinition {
    Name("PhoneSound")

    Events("onCallChange")

    // Older Android has no mode listener, so a call there is only noticed when the next line is due.
    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val listener = AudioManager.OnModeChangedListener { mode ->
          sendEvent("onCallChange", mapOf("onCall" to isCall(mode)))
        }
        audio?.addOnModeChangedListener(context.mainExecutor, listener)
        modeListener = listener
      }
    }

    OnDestroy {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        modeListener?.let { audio?.removeOnModeChangedListener(it) }
      }
      endPrompt()
    }

    // Vibrate counts too: it is how Android phones are usually set to silent.
    AsyncFunction("isSilentAsync") {
      val mode = audio?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
      mode != AudioManager.RINGER_MODE_NORMAL
    }

    Function("isOnCall") {
      isCall(audio?.mode ?: AudioManager.MODE_NORMAL)
    }

    AsyncFunction("beginPrompt") {
      beginPrompt()
    }

    AsyncFunction("endPrompt") {
      endPrompt()
      true
    }
  }

  // Ringing, a phone call, or a voice or video call in another app.
  private fun isCall(mode: Int) = mode != AudioManager.MODE_NORMAL

  // Navigation guidance ducks music for the length of a line, the way the system expects directions to.
  private fun beginPrompt() {
    val audio = audio ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener(ignoreFocusChange)
        .build()
        .also { focus = it }
      audio.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(ignoreFocusChange, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun endPrompt() {
    val audio = audio ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focus?.let { audio.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(ignoreFocusChange)
    }
  }
}
