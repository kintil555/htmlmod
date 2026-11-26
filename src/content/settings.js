/**
 * Settings definitions go here (see core/Settings.js for the API).
 */
import { Settings } from '../core/Settings.js';
import { STR } from './strings.js';
import { CONFIG } from '../config.js';
import { Quality } from '../core/Quality.js';
import { detectTouch } from '../core/Input.js';

const Q = STR.settings.quality;
Settings.define({
  id: 'quality', label: Q.label, type: 'select', default: 'auto', category: STR.settings.graphics,
  options: [{ value: 'auto', label: Q.auto }, { value: 'low', label: Q.low }, { value: 'medium', label: Q.medium }, { value: 'high', label: Q.high }],
});
Settings.define({ id: 'renderScale', label: Q.scale, type: 'slider', min: 0.5, max: 1, step: 0.05, default: 1, category: STR.settings.graphics });
Settings.define({ id: 'adaptiveRes', label: Q.adaptive, type: 'toggle', default: detectTouch(), category: STR.settings.graphics });
// Off by default where the quality preset drops sun effects (phones), on otherwise.
Settings.define({ id: 'sunEffects', label: STR.settings.sunEffects, type: 'toggle', default: Quality.preset(Settings.get('quality')).sunEffects, category: STR.settings.graphics });

Settings.define({ id: 'playerName', label: STR.net.playerName, type: 'text', maxLength: CONFIG.net.nameMax, default: `${STR.net.unnamed}${100 + Math.floor(Math.random() * 900)}`, category: STR.net.section });
// Keep the generated default: without this a new random name would be drawn on every page load.
if (!Settings.isSet('playerName')) Settings.set('playerName', Settings.get('playerName'));
