const { withInfoPlist } = require('expo/config-plugins');

// Apple rejects background modes an app does not use. CSI Map only runs in the background during directions:
// location to follow the route, and audio to speak the turns. expo-task-manager adds "fetch" on its own,
// which the app never uses, so the list is set to exactly these two.
module.exports = function withBackgroundModes(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIBackgroundModes = ['location', 'audio'];
    return mod;
  });
};
