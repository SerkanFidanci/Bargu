package app.bargu.restartnotice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The phone started (BOOT_COMPLETED) or the app was updated (MY_PACKAGE_REPLACED): either one
 * stops the location service, and without the background location permission Android does not
 * let the app start it again from here. All this can do is tell the user. JavaScript cannot run
 * at this moment, which is why this is native.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED ->
        RestartNotice.postIfArmed(context)
    }
  }
}
