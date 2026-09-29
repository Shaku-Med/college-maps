const { existsSync } = require('fs');

// Android push tokens come from Firebase Cloud Messaging, which needs google-services.json. It is picked up
// from an EAS file variable in cloud builds, or from the project folder, and left out until it exists.
module.exports = ({ config }) => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);
  return { ...config, android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) } };
};
