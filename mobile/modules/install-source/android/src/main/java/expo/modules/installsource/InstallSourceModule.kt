package expo.modules.installsource

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InstallSourceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InstallSource")

    // Google Play installs, internal testing included, count as the store; anything else is a test build.
    Function("installSource") {
      val context = appContext.reactContext ?: return@Function "other"
      val installer = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getInstallerPackageName(context.packageName)
        }
      } catch (_: Exception) {
        null
      }
      if (installer == "com.android.vending") "store" else "other"
    }
  }
}
