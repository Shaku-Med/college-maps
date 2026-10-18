import { DomWebView } from '@expo/dom-webview';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { ENGINE_URL, engineGone, engineHost, handleEngineMessage, registerEngine, subscribeEngine } from '@/lib/voice-engine';

/** The hidden web view that runs the natural voices, mounted only once someone picks one. */
export function VoiceEngineHost() {
  const host = useSyncExternalStore(subscribeEngine, engineHost);
  if (!host.wanted) return null;
  return (
    <View pointerEvents="none" style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <DomWebView
        key={host.generation}
        ref={registerEngine}
        source={{ uri: ENGINE_URL }}
        onMessage={(event) => handleEngineMessage(event.nativeEvent.data)}
        onContentProcessDidTerminate={engineGone}
        onRenderProcessGone={engineGone}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  web: { width: 1, height: 1 },
});
