const { withInfoPlist } = require('expo/config-plugins');

// Apple rejects background modes an app does not use.
module.exports = function withBackgroundModes(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIBackgroundModes = ['location', 'audio'];
    return mod;
  });
};
