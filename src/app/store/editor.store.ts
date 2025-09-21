import { Injectable, signal } from '@angular/core';
import { PoiFeature, PoiFeatureCollection, ImportSummary } from '../models/geojson';

const STORAGE_KEY = 'poi_editor_state_v1';

@Injectable({ providedIn: 'root' })
export class EditorStore {
  private _features = signal<PoiFeature[]>([]);
  private _summary = signal<ImportSummary | null>(null);
  private _selectedIdx = signal<number | null>(null);

  // Expuestos al componente
  features = this._features;
  importSummary = this._summary;

  selected() {
    const i = this._selectedIdx();
    const list = this._features();
    return i != null && i >= 0 && i < list.length ? list[i] : null;
  }

  // ----- Mutaciones -----
  setFromImport(fc: PoiFeatureCollection, summary: ImportSummary) {
    this._features.set(fc.features);       // << SOLO válidos
    this._summary.set(summary);
    this._selectedIdx.set(null);
    this.saveToLocalStorage();
  }

  addFeature(f: PoiFeature) {
    this._features.update(arr => [...arr, f]);
    this.saveToLocalStorage();
  }

  selectByIdx(i: number | null) {
    this._selectedIdx.set(i);
  }

  updateSelected(partial: Partial<PoiFeature['properties']>) {
    const idx = this._selectedIdx();
    if (idx == null) return;
    this._features.update(list => {
      const copy = [...list];
      copy[idx] = {
        ...copy[idx],
        properties: { ...copy[idx].properties, ...partial },
      };
      return copy;
    });
    this.saveToLocalStorage();
  }

  deleteSelected() {
    const idx = this._selectedIdx();
    if (idx == null) return;
    this._features.update(list => list.filter((_, i) => i !== idx));
    this._selectedIdx.set(null);
    this.saveToLocalStorage();
  }

  clear() {
    this._features.set([]);
    this._summary.set(null);
    this._selectedIdx.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  asCollection(): PoiFeatureCollection {
    return { type: 'FeatureCollection', features: this._features() };
  }

  // ----- Persistencia -----
  saveToLocalStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.asCollection()));
  }

  loadFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PoiFeatureCollection;
      if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        this._features.set(parsed.features);
      }
    } catch {
      // ignore
    }
  }
}
