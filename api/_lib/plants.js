export const PLANT_IDS = Object.freeze({
  LT: 'LT',
  LWT: 'LWT',
  RCLH: 'RCLH',
  RCLE: 'RCLE'
});

export const PLANT_NAMES = Object.freeze({
  [PLANT_IDS.LT]: 'Lanka Tiles',
  [PLANT_IDS.LWT]: 'Lanka Wall Tiles',
  [PLANT_IDS.RCLH]: 'Rocell Horana',
  [PLANT_IDS.RCLE]: 'Rocell Eheliyagoda'
});

const ALIAS_MAP = Object.freeze({
  [PLANT_IDS.LT]: [
    'lt',
    'lanka tiles',
    'lanka tile',
    'lankatiles',
    'lanka-tiles',
    'lanka_tile'
  ],
  [PLANT_IDS.LWT]: [
    'lwt',
    'lanka wall tiles',
    'lanka wall tile',
    'lankawalltiles',
    'lanka-wall-tiles',
    'lanka_wall_tiles'
  ],
  [PLANT_IDS.RCLH]: [
    'rclh',
    'rcl-h',
    'rcl h',
    'rocell horana',
    'rocellhorana',
    'horana'
  ],
  [PLANT_IDS.RCLE]: [
    'rcle',
    'rcl-e',
    'rcl e',
    'rocell eheliyagoda',
    'rocelleheliyagoda',
    'eheliyagoda'
  ]
});

function normalizeAliasInput(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return '';
  }
  return String(rawValue).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function normalizePlantId(rawValue, options = {}) {
  const { allowUnknown = false } = options;
  const candidate = normalizeAliasInput(rawValue);

  if (!candidate) {
    if (allowUnknown) return undefined;
    throw new Error('Plant is required. Supported plants: LT, LWT, RCLH, RCLE.');
  }

  for (const [plantId, aliases] of Object.entries(ALIAS_MAP)) {
    if (aliases.some(alias => candidate === alias || candidate.includes(alias))) {
      return plantId;
    }
  }

  if (allowUnknown) {
    return undefined;
  }

  throw new Error(`Unknown plant "${rawValue}". Supported plants: LT, LWT, RCLH, RCLE.`);
}

export function getPlantDisplayName(plantId) {
  const normalized = normalizePlantId(plantId, { allowUnknown: true });
  return normalized ? PLANT_NAMES[normalized] || normalized : plantId;
}

export function isKnownPlantId(plantId) {
  return Object.values(PLANT_IDS).includes(plantId);
}
