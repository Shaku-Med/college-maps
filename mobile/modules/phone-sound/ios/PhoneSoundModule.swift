import AVFoundation
import AudioToolbox
import CallKit
import ExpoModulesCore
import QuartzCore

public class PhoneSoundModule: Module {
  private var soundID: SystemSoundID = 0
  private let calls = CallWatcher()

  public func definition() -> ModuleDefinition {
    Name("PhoneSound")

    Events("onCallChange")

    OnCreate {
      self.calls.onChange = { [weak self] onCall in
        self?.sendEvent("onCallChange", ["onCall": onCall])
      }
    }

    // A silent system sound that ends at once means the switch is on silent; ambient so playback can't let it through.
    AsyncFunction("isSilentAsync") { (promise: Promise) in
      guard let sound = self.silentSound() else {
        promise.resolve(false)
        return
      }
      try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [])
      let started = CACurrentMediaTime()
      AudioServicesPlaySystemSoundWithCompletion(sound) {
        promise.resolve(CACurrentMediaTime() - started < 0.1)
      }
    }
    .runOnQueue(.main)

    Function("isOnCall") {
      self.calls.onCall
    }

    // Set up the way Apple asks turn by turn apps to: music ducks and podcasts pause while a line is said.
    AsyncFunction("beginPrompt") {
      let session = AVAudioSession.sharedInstance()
      let options: AVAudioSession.CategoryOptions = [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
      if session.category != .playback || session.mode != .voicePrompt || session.categoryOptions != options {
        try session.setCategory(.playback, mode: .voicePrompt, options: options)
      }
      try session.setActive(true)
    }
    .runOnQueue(.main)

    AsyncFunction("endPrompt") { () -> Bool in
      do {
        try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return true
      } catch {
        return false
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
        try PhoneSoundModule.silence().write(to: url)
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

// Phone, FaceTime and any calling app that shows its calls to iOS, whether ringing, going or on hold.
private final class CallWatcher: NSObject, CXCallObserverDelegate {
  private let observer = CXCallObserver()
  private(set) var onCall = false
  var onChange: ((Bool) -> Void)?

  override init() {
    super.init()
    observer.setDelegate(self, queue: nil)
    onCall = observer.calls.contains { !$0.hasEnded }
  }

  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    let now = callObserver.calls.contains { !$0.hasEnded }
    guard now != onCall else {
      return
    }
    onCall = now
    onChange?(now)
  }
}
