import ExpoModulesCore

public class InstallSourceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("InstallSource")

    // TestFlight builds carry a sandbox receipt; App Store installs carry a real one; simulators and dev builds have none.
    Function("installSource") { () -> String in
      #if targetEnvironment(simulator)
      return "other"
      #else
      guard let receipt = Bundle.main.appStoreReceiptURL else { return "other" }
      if receipt.lastPathComponent == "sandboxReceipt" { return "testflight" }
      return FileManager.default.fileExists(atPath: receipt.path) ? "store" : "other"
      #endif
    }
  }
}
