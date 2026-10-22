package app.bargu.restartnotice

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What JavaScript tells the native side: sharing is on (with the notice's two texts), or it was
 * ended on purpose. See RestartNotice for what happens with it.
 */
class BarguRestartNoticeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BarguRestartNotice")

    Function("arm") { title: String, body: String ->
      RestartNotice.arm(context, title, body)
    }

    Function("disarm") {
      RestartNotice.disarm(context)
    }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
