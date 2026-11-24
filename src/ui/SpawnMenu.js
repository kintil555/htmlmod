import { el, Button, Panel, Tabs, Card } from './ui.js';
import { STR } from '../content/strings.js';
import { SpawnTabRegistry, NextbotRegistry, PropRegistry } from '../core/registries.js';

/** Gmod-style Q menu. Tabs come from SpawnTabRegistry; clicking an item calls onSpawn(tab, item). */
export class SpawnMenu {
  constructor({ onSpawn, onClear, counts }) {
    this.isOpen = false;
    const defs = () => SpawnTabRegistry.all().map(tab => ({
      id: tab.id,
      label: tab.label,
      render: () => el('div', { class: 'ui-grid' },
        tab.items().map(item => Card({ ...item, onClick: () => onSpawn(tab, item) }))),
    }));
    this.tabDefs = defs();
    this.tabs = Tabs({ tabs: this.tabDefs });
    // Mods add and remove tabs/items at runtime: rebuild in place (Tabs reads the same array).
    const sync = () => {
      this.tabDefs.splice(0, this.tabDefs.length, ...defs());
      this.tabs.select(this.tabDefs.some(t => t.id === this.tabs.activeId) ? this.tabs.activeId : this.tabDefs[0]?.id);
    };
    for (const reg of [SpawnTabRegistry, NextbotRegistry, PropRegistry]) reg.subscribe(sync);
    this.count = el('span', { class: 'spawnmenu__count' });
    this.counts = counts;
    this.root = el('div', { class: 'spawnmenu' },
      Panel({
        body: this.tabs.root,
        className: 'spawnmenu__panel',
        footer: [this.count, Button({ label: STR.spawn.clear, size: 'sm', onClick: onClear })],
      }));
  }
  updateCounts() { this.count.textContent = this.counts(); }
  open() { this.isOpen = true; this.updateCounts(); this.root.classList.add('is-open'); }
  close() { this.isOpen = false; this.root.classList.remove('is-open'); }
}
