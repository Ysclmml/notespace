package app.markdownworkspace.mobile

import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onStart() {
    super.onStart()
    if (!BuildConfig.DEBUG || multicastLock?.isHeld == true) return
    val wifiManager = applicationContext.getSystemService(WIFI_SERVICE) as? WifiManager
    multicastLock = wifiManager?.createMulticastLock("notespace-mdns")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onStop() {
    multicastLock?.takeIf { it.isHeld }?.release()
    multicastLock = null
    super.onStop()
  }
}
