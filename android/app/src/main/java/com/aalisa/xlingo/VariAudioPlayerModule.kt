package com.aalisa.xlingo

import android.media.MediaPlayer
import android.media.PlaybackParams
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * VariAudioPlayer — wraps Android MediaPlayer with rate + loop support.
 * Mirrors the iOS AVAudioPlayer-based module.
 */
class VariAudioPlayerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "VariAudioPlayer"

    private val players = mutableMapOf<String, MediaPlayer>()
    private val loops = mutableMapOf<String, Boolean>()
    private val uris = mutableMapOf<String, String>()

    private fun sendEvent(playerId: String, isPlaying: Boolean, position: Long, duration: Long, didFinish: Boolean) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onPlaybackStatus", Arguments.makeNativeMap(mapOf(
                "id" to playerId,
                "isPlaying" to isPlaying,
                "position" to position,
                "duration" to duration,
                "didFinish" to didFinish,
            )))
    }

    @ReactMethod
    fun load(playerId: String, uri: String, rate: Double, loop: Boolean, promise: Promise) {
        try {
            val path = uri.removePrefix("file://").let { java.net.URLDecoder.decode(it, "UTF-8") }
            val mp = MediaPlayer().apply {
                setDataSource(path)
                setOnPreparedListener {
                    // Apply rate
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                        try {
                            val params = PlaybackParams().setSpeed(rate.toFloat())
                            playbackParams = params
                        } catch (_: Exception) {}
                    }
                    start()
                }
                setOnCompletionListener {
                    if (loops[playerId] == true) {
                        seekTo(0)
                        start()
                    } else {
                        sendEvent(playerId, false, (duration / 1000).toLong(), (duration / 1000).toLong(), true)
                    }
                }
                setOnErrorListener { _, what, extra ->
                    false
                }
                prepareAsync()
            }
            players[playerId]?.release()
            players[playerId] = mp
            loops[playerId] = loop
            uris[playerId] = uri
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOAD_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun play(playerId: String, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        mp.start()
        sendEvent(playerId, true, (mp.currentPosition).toLong(), (mp.duration).toLong(), false)
        promise.resolve(true)
    }

    @ReactMethod
    fun pause(playerId: String, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        mp.pause()
        sendEvent(playerId, false, (mp.currentPosition).toLong(), (mp.duration).toLong(), false)
        promise.resolve(true)
    }

    @ReactMethod
    fun stop(playerId: String, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        mp.pause()
        mp.seekTo(0)
        sendEvent(playerId, false, 0L, (mp.duration).toLong(), false)
        promise.resolve(true)
    }

    @ReactMethod
    fun setRate(playerId: String, rate: Double, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            try {
                mp.playbackParams = PlaybackParams().setSpeed(rate.toFloat())
            } catch (_: Exception) {}
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun setLooping(playerId: String, loop: Boolean, promise: Promise) {
        loops[playerId] = loop
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        mp.isLooping = loop
        promise.resolve(true)
    }

    @ReactMethod
    fun seek(playerId: String, positionMs: Double, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        mp.seekTo(positionMs.toInt())
        sendEvent(playerId, mp.isPlaying, mp.currentPosition.toLong(), mp.duration.toLong(), false)
        promise.resolve(true)
    }

    @ReactMethod
    fun getStatus(playerId: String, promise: Promise) {
        val mp = players[playerId] ?: return promise.reject("NO_PLAYER", "Player not loaded", null)
        val map = Arguments.makeNativeMap(mapOf(
            "isPlaying" to mp.isPlaying,
            "position" to mp.currentPosition,
            "duration" to mp.duration,
            "rate" to 1.0,
            "loop" to (loops[playerId] ?: false),
        ))
        promise.resolve(map)
    }

    @ReactMethod
    fun unload(playerId: String, promise: Promise) {
        players[playerId]?.release()
        players.remove(playerId)
        loops.remove(playerId)
        uris.remove(playerId)
        promise.resolve(true)
    }
}
