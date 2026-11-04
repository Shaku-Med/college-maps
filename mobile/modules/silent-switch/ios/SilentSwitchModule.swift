import AudioToolbox
import ExpoModulesCore
import QuartzCore

// System sounds obey the ring switch, so a short silent one that finishes at once means the iPhone is set to silent.
public class SilentSwitchModule: Module {
  private var soundID: SystemSoundID = 0

  public func definition() -> ModuleDefinition {
    Name("SilentSwitch")

    AsyncFunction("isSilentAsync") { (promise: Promise) in
      guard let sound = self.silentSound() else {
        promise.resolve(false)
        return
      }
      let started = CACurrentMediaTime()
      AudioServicesPlaySystemSoundWithCompletion(sound) {
        promise.resolve(CACurrentMediaTime() - started < 0.1)
      }
    }
    .runOnQueue(.main)
  }

  private func silentSound() -> SystemSoundID? {
    if soundID != 0 {
      return soundID
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("csimap-silence.wav")
    if !FileManager.default.fileExists(atPath: url.path) {
      do {
        try SilentSwitchModule.silence().write(to: url)
      } catch {
        return nil
      }
    }
    var sound: SystemSoundID = 0
    guard AudioServicesCreateSystemSoundID(url as CFURL, &sound) == kAudioServicesNoError else {
      return nil
    }
    soundID = sound
    return sound
  }

  // A quarter second of silence as 16 bit mono PCM: long enough to time, never heard.
  private static func silence() -> Data {
    let rate: UInt32 = 8000
    let bytes: UInt32 = rate / 4 * 2
    var data = Data()
    func put<T: FixedWidthInteger>(_ value: T) {
      withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }
    data.append(contentsOf: Array("RIFF".utf8))
    put(UInt32(36) + bytes)
    data.append(contentsOf: Array("WAVEfmt ".utf8))
    put(UInt32(16))
    put(UInt16(1))
    put(UInt16(1))
    put(rate)
    put(rate * 2)
    put(UInt16(2))
    put(UInt16(16))
    data.append(contentsOf: Array("data".utf8))
    put(bytes)
    data.append(Data(count: Int(bytes)))
    return data
  }
}
