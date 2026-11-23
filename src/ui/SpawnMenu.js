import { el, Button, Panel, Tabs, Card } from './ui.js';
import { STR } from '../content/strings.js';
import { SpawnTabRegistry } from '../core/registries.js';

/** Gmod-style Q menu. Tabs come from SpawnTabRegistry; clicking an item calls onSpawn(tab, item). */
export class SpawnMenu {
  constructor({ onSpawn, onClear, counts }) {
    this.isOpen = false;
    const tabDefs = SpawnTabRegistry.all().map(tab => ({
      id: tab.id,
      label: tab.label,
      render: () => el('div', { class: 'ui-grid' },
        tab.items().map(item => Card({ ...item, onClick: () => onSpawn(tab, item) }))),
    }));
    this.tabs = Tabs({ tabs: tabDefs });
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
