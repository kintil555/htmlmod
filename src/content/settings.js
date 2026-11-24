/**
 * Settings definitions go here (see core/Settings.js for the API).
 */
import { Settings } from '../core/Settings.js';
import { STR } from './strings.js';

Settings.define({ id: 'sunEffects', label: STR.settings.sunEffects, type: 'toggle', default: true, category: STR.settings.graphics });
