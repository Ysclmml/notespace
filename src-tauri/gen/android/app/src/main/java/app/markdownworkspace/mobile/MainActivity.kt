package app.markdownworkspace.mobile

import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null
  private var readerWebView: WebView? = null
  private var backPending = false
  private var lastRootBackAt = 0L
  private var exitToast: Toast? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (backPending) return
        val webView = readerWebView
        if (webView == null) {
          backAtRoot()
          return
        }
        backPending = true
        // A canceled event means a menu, document, or directory handled Back.
        webView.evaluateJavascript(
          "window.dispatchEvent(new Event('notespace-mobile-back', {cancelable:true}))"
        ) { unhandled ->
          backPending = false
          if (isFinishing || isDestroyed) return@evaluateJavascript
          if (unhandled == "true") backAtRoot() else {
            lastRootBackAt = 0L
            exitToast?.cancel()
          }
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    readerWebView = webView
  }

  private fun backAtRoot() {
    val now = SystemClock.elapsedRealtime()
    if (lastRootBackAt != 0L && now - lastRootBackAt <= 2000L) {
      exitToast?.cancel()
      finish()
    } else {
      lastRootBackAt = now
      exitToast?.cancel()
      exitToast = Toast.makeText(this, "再按一次返回退出 NoteSpace", Toast.LENGTH_SHORT)
      exitToast?.show()
    }
  }

  override fun onStart() {
    super.onStart()
    if (multicastLock?.isHeld == true) return
    val wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as? WifiManager
    multicastLock = wifiManager?.createMulticastLock("notespace-mdns")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onStop() {
    lastRootBackAt = 0L
    multicastLock?.takeIf { it.isHeld }?.release()
    multicastLock = null
    super.onStop()
  }
}
