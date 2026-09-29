const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// The campus data and search live with the web app, so both apps always show the same buildings.
config.watchFolders = [
  path.resolve(__dirname, '../app/campus'),
  path.resolve(__dirname, '../app/src/data'),
  path.resolve(__dirname, '../app/src/lib'),
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
