/**
 * Settings definitions go here (see core/Settings.js for the API).
 */
import { Settings } from '../core/Settings.js';
import { STR } from './strings.js';
import { CONFIG } from '../config.js';

Settings.define({ id: 'sunEffects', label: STR.settings.sunEffects, type: 'toggle', default: true, category: STR.settings.graphics });

Settings.define({ id: 'playerName', label: STR.net.playerName, type: 'text', maxLength: CONFIG.net.nameMax, default: `${STR.net.unnamed}${100 + Math.floor(Math.random() * 900)}`, category: STR.net.section });
// Keep the generated default: without this a new random name would be drawn on every page load.
if (!Settings.isSet('playerName')) Settings.set('playerName', Settings.get('playerName'));
