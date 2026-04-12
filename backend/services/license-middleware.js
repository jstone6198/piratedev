import { readVault } from './user-vault.js';

const TIER_FEATURES = {
  free: ['projects_3', 'ai_chat', 'file_editor', 'terminal'],
  pro: ['projects_3', 'ai_chat', 'file_editor', 'terminal',
        'projects_unlimited', 'agent', 'live_preview', 'git_sync', 'connectors_5', 'byok'],
  team: ['projects_3', 'ai_chat', 'file_editor', 'terminal',
         'projects_unlimited', 'agent', 'live_preview', 'git_sync', 'connectors_5', 'byok',
         'connectors_unlimited', 'collaboration', 'usage_dashboard', 'priority_support'],
};

export function getLicenseInfo() {
  const vault = readVault();
  const tier = vault.licenseTier || 'free';
  return {
    tier,
    features: TIER_FEATURES[tier] || TIER_FEATURES.free,
    valid: !!vault.licenseKey,
  };
}

export function requireLicense(feature) {
  return (_req, res, next) => {
    const info = getLicenseInfo();
    if (info.features.includes(feature)) {
      return next();
    }
    return res.status(403).json({
      error: `Feature "${feature}" requires a higher license tier`,
      currentTier: info.tier,
      requiredFeature: feature,
      upgradeUrl: '/settings/license',
    });
  };
}
