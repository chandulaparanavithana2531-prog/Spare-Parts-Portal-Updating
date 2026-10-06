export function resolvePlantCanonical(rawName) {
  if (!rawName) return '';
  const s = String(rawName).trim().toLowerCase();
  if (s === 'lwt' || (s.includes('lanka') && s.includes('wall'))) return 'Lanka Wall Tiles';
  if (s === 'lt' || (s.includes('lanka') && s.includes('tile'))) return 'Lanka Tiles';
  if (s === 'rcl-h' || s === 'rclh' || s.includes('horana')) return 'Rocell Horana';
  if (s === 'rcl-e' || s === 'rcle' || s.includes('eheliyagoda') || s === 'gsc') return 'Rocell Eheliyagoda';
  return String(rawName).trim();
}
