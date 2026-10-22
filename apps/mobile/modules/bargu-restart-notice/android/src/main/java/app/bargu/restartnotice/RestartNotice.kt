package app.bargu.restartnotice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

/**
 * The "Paylaşım durdu" notice (docs/ADR/0028, addendum 2026-10-22). The only things kept are a
 * flag, "the location service should be running", and the notice's title and body as the app wrote
 * them in the user's language. Never a location, an id or a token, and nothing is logged.
 */
internal object RestartNotice {
  private const val PREFS = "bargu_restart_notice"
  private const val ARMED = "armed"
  private const val TITLE = "title"
  private const val BODY = "body"

  /** The channel the app already makes for its reminders: PRIVACY_CHANNEL in src/features/notifications/channels.ts. */
  private const val CHANNEL_ID = "privacy"
  private const val NOTIFICATION_ID = 41021

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun notifications(context: Context) = context.getSystemService(NotificationManager::class.java)

  /** Sharing is on. A notice still showing is taken back: the service runs again. */
  fun arm(context: Context, title: String, body: String) {
    prefs(context).edit().putBoolean(ARMED, true).putString(TITLE, title).putString(BODY, body).apply()
    notifications(context).cancel(NOTIFICATION_ID)
  }

  /** Sharing was ended on purpose: nothing to tell after a restart. */
  fun disarm(context: Context) {
    prefs(context).edit().clear().apply()
    notifications(context).cancel(NOTIFICATION_ID)
  }

  /** The phone started or the app was updated: tell the user if sharing was on. */
  fun postIfArmed(context: Context) {
    val stored = prefs(context)
    val title = stored.getString(TITLE, null)
    val body = stored.getString(BODY, null)
    if (!stored.getBoolean(ARMED, false) || title == null || body == null) return

    val manager = notifications(context)
    // False without the notification permission (Android 13+) or when the user turned them off.
    if (!manager.areNotificationsEnabled()) return
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val tap = PendingIntent.getActivity(
      context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // Normally there already (the app makes it when it is first opened); the title names it if not.
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, title, NotificationManager.IMPORTANCE_DEFAULT)
        )
      }
      Notification.Builder(context, CHANNEL_ID)
    } else {
      Notification.Builder(context)
    }
    // The app's notification icon and color (expo-notifications writes them under these names).
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    val color = context.resources.getIdentifier("notification_icon_color", "color", context.packageName)
    builder
      .setSmallIcon(if (icon != 0) icon else context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setContentIntent(tap)
      .setAutoCancel(true)
    if (color != 0) builder.setColor(context.getColor(color))
    manager.notify(NOTIFICATION_ID, builder.build())
  }
}
