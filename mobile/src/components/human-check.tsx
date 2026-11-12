import { DomWebView } from '@expo/dom-webview';
import { requireOptionalNativeModule } from 'expo';
import { useState } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { WEB_ORIGIN } from '@/lib/links';

// Cloudflare's check runs on the website, so a build without the web view's native code cannot sign in here.
export const HUMAN_CHECK_AVAILABLE = requireOptionalNativeModule('ExpoDomWebViewModule') !== null;

const VERIFY_URL = `${WEB_ORIGIN}/verify`;
// Printable ASCII only; the server does the real check.
const TOKEN = /^[!-~]{1,2048}$/;
const SHOWN_HEIGHT = 72;

function fromVerifyPage(url: string) {
  try {
    const page = new URL(url);
    return page.origin === WEB_ORIGIN && page.pathname === '/verify';
  } catch {
    return false;
  }
}

function readMessage(raw: string) {
  try {
    const message: unknown = JSON.parse(raw);
    return typeof message === 'object' && message !== null ? (message as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Proof that a person asked for the code. The box stays out of sight unless Cloudflare wants a tap. Each token works
 * once, so a new `round` loads a fresh check.
 */
export function HumanCheck({ round, onToken }: { round: number; onToken: (token: string | null) => void }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [key, setKey] = useState(`${round}`);
  if (key !== `${round}`) {
    setKey(`${round}`);
    setShown(false);
    setFailed(false);
  }

  if (!HUMAN_CHECK_AVAILABLE) {
    return <Text className="text-sm text-danger">Update CSI Map from the store to sign in on this phone.</Text>;
  }

  function restart() {
    setShown(false);
    onToken(null);
    setReloads((count) => count + 1);
  }

  function handle(url: string, raw: string) {
    if (!fromVerifyPage(url) || raw.length > 4096) return;
    const message = readMessage(raw);
    if (!message) return;
    if (message.type === 'token' && typeof message.token === 'string' && TOKEN.test(message.token)) {
      setFailed(false);
      onToken(message.token);
    } else if (message.type === 'cleared') {
      onToken(null);
    } else if (message.type === 'failed') {
      setFailed(true);
      onToken(null);
    } else if (message.type === 'interactive' && typeof message.shown === 'boolean') {
      setShown(message.shown);
    }
  }

  return (
    <View>
      <View style={shown ? styles.shown : styles.hidden} pointerEvents={shown ? 'auto' : 'none'}>
        <DomWebView
          key={`${round}-${scheme}-${reloads}`}
          source={{ uri: `${VERIFY_URL}?theme=${scheme}` }}
          onMessage={(event) => handle(event.nativeEvent.url, event.nativeEvent.data)}
          onContentProcessDidTerminate={restart}
          onRenderProcessGone={restart}
          scrollEnabled={false}
          style={styles.web}
        />
      </View>
      {failed ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          We couldn&apos;t check that you&apos;re a person. Check your connection, then try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full width even while hidden, since the check lays itself out for the width it starts at.
  hidden: { position: 'absolute', left: 0, right: 0, height: 1, opacity: 0, overflow: 'hidden' },
  shown: { height: SHOWN_HEIGHT },
  web: { flex: 1, backgroundColor: 'transparent' },
});
