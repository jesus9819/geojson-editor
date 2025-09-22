import { Component, OnDestroy, OnInit, effect, signal } from '@angular/core';
import maplibregl, { Map, LngLatLike, MapMouseEvent, LngLatBoundsLike } from 'maplibre-gl';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStore } from '../../store/editor.store';
import { GeoJsonService } from '../../services/geojson.service';
import { PoiFeature } from '../../models/geojson';

type IndexedPoi = PoiFeature & { properties: PoiFeature['properties'] & { _idx: number } };
type IndexedFC = { type: 'FeatureCollection'; features: IndexedPoi[] };

@Component({
  selector: 'app-map-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-editor.component.html',
  styleUrls: ['./map-editor.component.scss'],
})
export class MapEditorComponent implements OnInit, OnDestroy {
  private map?: Map;

  // form bindings
  name = '';
  category = '';

  // messages / counters
  importMessage = signal<string>('');
  processedTotal = signal<number>(0);
  discardedTotal = signal<number>(0);

  // filters
  filterName = '';
  filterCategory = '';

  // interaction flags
  private dragging = false;
  private suppressAdd = false;

  constructor(public store: EditorStore, private gj: GeoJsonService) {
    // When features change, refresh source with current filters applied
    effect(() => {
      const _ = this.store.features();
      this.refreshLayerWithFilters();
      this.updateSelectedHighlight(); // keep highlight in sync when data changes
    });

    // Keep header counters in sync
    effect(() => {
      const summary = this.store.importSummary();
      if (summary) {
        this.processedTotal.set(summary.imported + summary.discarded);
        this.discardedTotal.set(summary.discarded);
      } else {
        const count = this.store.features().length;
        this.processedTotal.set(count);
        this.discardedTotal.set(0);
      }
    });

    // Update highlight when selection changes
    effect(() => {
      const _ = this.store.selected();
      this.syncForm();
      this.updateSelectedHighlight();
    });
  }

  ngOnInit(): void {
    // auto-restore before mounting the map
    this.store.loadFromLocalStorage();
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ---------- helpers ----------

  private confirmAction(message: string): boolean {
    return window.confirm(message);
  }

  /** Build FC injecting _idx for all features (full dataset). */
  private buildIndexedFCAll(): IndexedFC {
    const list = this.store.features();
    return {
      type: 'FeatureCollection',
      features: list.map((f, i) => ({
        ...f,
        properties: { ...(f.properties ?? {}), _idx: i },
      })),
    };
  }

  /** Build FC for the filtered subset, preserving original _idx. */
  private buildIndexedFCFiltered(): IndexedFC {
    const nameQ = (this.filterName || '').trim().toLowerCase();
    const catQ = (this.filterCategory || '').trim();

    const list = this.store.features();
    const filtered = list
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => {
        const props = f.properties || ({} as any);
        const okName = nameQ ? String(props.name || '').toLowerCase().includes(nameQ) : true;
        const okCat = catQ ? String(props.category || '') === catQ : true;
        return okName && okCat;
      })
      .map(({ f, i }) => ({
        ...f,
        properties: { ...(f.properties ?? {}), _idx: i },
      }));

    return { type: 'FeatureCollection', features: filtered };
  }

  /** Apply filters to the map source. */
  private refreshLayerWithFilters(): void {
    const src = this.map?.getSource('pois') as any;
    if (!src) return;
    src.setData(this.buildIndexedFCFiltered());
  }

  /** Get selected index within store (by reference). */
  private getSelectedIdx(): number {
    const sel = this.store.selected();
    if (!sel) return -1;
    return this.store.features().indexOf(sel);
  }

  /** Update the highlight layer filter for the current selection. */
  private updateSelectedHighlight(): void {
    if (!this.map || !this.map.getLayer('pois-selected')) return;
    const idx = this.getSelectedIdx();
    // highlight only if the selected feature is part of the current filtered source
    const filter: any = ['==', ['get', '_idx'], idx >= 0 ? idx : -1];
    this.map.setFilter('pois-selected', filter);
  }

  /** Find a feature near the click (pixel-based). Returns store index or null. */
  private findFeatureNear(e: MapMouseEvent, tolerancePx = 10): number | null {
    if (!this.map) return null;
    const list = this.store.features();
    for (let i = 0; i < list.length; i++) {
      const [lng, lat] = list[i].geometry.coordinates as [number, number];
      const p = this.map.project({ lng, lat });
      const dx = p.x - e.point.x;
      const dy = p.y - e.point.y;
      if (dx * dx + dy * dy <= tolerancePx * tolerancePx) return i;
    }
    return null;
  }

  // ---------- map ----------

  private initMap(): void {
    this.map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      } as any,
      center: [-70.65, -33.45] as LngLatLike,
      zoom: 11,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.doubleClickZoom.disable();

    this.map.on('load', () => {
      // Source starts with filtered (initially no filters => all)
      this.map!.addSource('pois', {
        type: 'geojson',
        data: this.buildIndexedFCFiltered(),
      } as any);

      // Base points
      this.map!.addLayer({
        id: 'pois-circle',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000',
          'circle-color': [
            'match',
            ['get', 'category'],
            'park', '#16a34a',
            'landmark', '#eab308',
            'school', '#2563eb',
            'hospital', '#ef4444',
            'square', '#f59e0b',
            'viewpoint', '#a78bfa',
            'mall', '#fbbf24',
            'station', '#0ea5e9',
            'stadium', '#22c55e',
            'bus_terminal', '#ef4444',
            'airport', '#2563eb',
            /* default */ '#3b82f6',
          ],
        },
      });

      // Highlight layer (selected point focus)
      this.map!.addLayer({
        id: 'pois-selected',
        type: 'circle',
        source: 'pois',
        filter: ['==', ['get', '_idx'], -1], // start with none
        paint: {
          'circle-radius': 12,
          'circle-color': 'rgba(0, 0, 0, 0)',   // transparent fill
          'circle-stroke-width': 4,
          'circle-stroke-color': '#ffcc00',     // golden halo
        },
      });

      // Map click: create unless near an existing one
      this.map!.on('click', (e: MapMouseEvent) => this.onMapClick(e));

      // Click on point: select using _idx (works with filtered collection)
      this.map!.on('click', 'pois-circle', (e: any) => {
        const feat = e?.features?.[0];
        if (!feat) return;
        this.suppressAdd = true;
        const idx = feat.properties?._idx;
        if (typeof idx === 'number') {
          this.store.selectByIdx(idx);
          this.syncForm();
          this.updateSelectedHighlight();
        }
        setTimeout(() => (this.suppressAdd = false), 0);
      });

      // Drag to move a point
      this.map!.on('mousedown', 'pois-circle', (e: any) => {
        const feat = e?.features?.[0];
        if (!feat) return;
        const idx = feat.properties?._idx;
        if (typeof idx !== 'number') return;

        this.store.selectByIdx(idx);
        this.syncForm();

        this.suppressAdd = true;
        this.map!.dragPan.disable();
        this.dragging = true;

        this.map!.on('mousemove', this.onDragMove);
        this.map!.once('mouseup', this.onDragEnd);
        this.map!.once('mouseout', this.onDragEnd);
      });

      this.map!.on('mousemove', 'pois-circle', () => (this.map!.getCanvas().style.cursor = 'pointer'));
      this.map!.on('mouseleave', 'pois-circle', () => (this.map!.getCanvas().style.cursor = 'default'));
    });
  }

  private onDragMove = (e: MapMouseEvent) => {
    if (!this.dragging) return;
    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    this.store.updateSelectedCoords(coords);
    // keep filtered view and highlight fresh while dragging
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  };

  private onDragEnd = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.map?.off('mousemove', this.onDragMove);
    this.map?.dragPan.enable();
    setTimeout(() => (this.suppressAdd = false), 0);
  };

  private onMapClick(e: MapMouseEvent): void {
    if (this.dragging || this.suppressAdd) {
      this.suppressAdd = false;
      return;
    }

    // if there is a point near the click, select it instead of creating a new one
    const nearIdx = this.findFeatureNear(e, 10);
    if (nearIdx != null) {
      this.store.selectByIdx(nearIdx);
      this.syncForm();
      this.updateSelectedHighlight();
      return;
    }

    // create new point
    const coords = [e.lngLat.lng, e.lngLat.lat] as [number, number];
    const f: PoiFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { name: 'New POI', category: 'misc' },
    };
    this.store.addFeature(f);
    this.store.selectByIdx(this.store.features().length - 1);
    this.syncForm();

    // ensure it appears if current filter would hide it (we keep current filters, but data is updated)
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }

  // ---------- filters API (called from template) ----------

  applyFilters(): void {
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }

  clearFilters(): void {
    this.filterName = '';
    this.filterCategory = '';
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }

  // ---------- form / actions ----------

  private syncForm(): void {
    const sel = this.store.selected();
    this.name = sel?.properties.name ?? '';
    this.category = sel?.properties.category ?? '';
  }

  onCancelSelection(): void {
    this.store.selectByIdx(null);
    this.name = '';
    this.category = '';
    this.updateSelectedHighlight();
  }

  onSaveProps(): void {
    const sel = this.store.selected();
    if (!sel) return;
    const msg = `Update this point?\n\nName: "${this.name || sel.properties.name}"\nCategory: "${this.category || sel.properties.category}"`;
    if (!this.confirmAction(msg)) return;
    this.store.updateSelected({ name: this.name, category: this.category });
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }

  onDeleteSelected(): void {
    const sel = this.store.selected();
    if (!sel) return;
    const msg = `Delete this point?\n\nName: "${sel.properties.name}"\nCategory: "${sel.properties.category}"`;
    if (!this.confirmAction(msg)) return;
    this.store.deleteSelected();
    this.name = '';
    this.category = '';
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }

  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const replaceMsg = `Import file "${file.name}"?\n\nCurrent points will be replaced by the valid features from the file.`;
    if (!this.confirmAction(replaceMsg)) {
      input.value = '';
      return;
    }

    file.text().then((txt) => {
      try {
        const { fc, summary } = this.gj.parseImport(txt);

        // Valid features -> store (effect will render and update counters)
        this.store.setFromImport(fc, summary);

        this.importMessage.set(`Imported ${summary.imported} / Discarded ${summary.discarded}`);

        // Update filtered layer with fresh data
        this.refreshLayerWithFilters();
        this.updateSelectedHighlight();

        // Fit bounds to valid features if present
        if (fc.features.length) {
          const bounds = new maplibregl.LngLatBounds();
          for (const ft of fc.features) bounds.extend(ft.geometry.coordinates as [number, number]);
          if (!bounds.isEmpty()) this.map?.fitBounds(bounds as LngLatBoundsLike, { padding: 60 });
        }
      } catch (err: any) {
        this.importMessage.set(`Error: ${err?.message ?? 'Invalid file'}`);
      } finally {
        input.value = '';
      }
    });
  }

  onExport(): void {
    const count = this.store.features().length;
    const msg = count
      ? `Export ${count} point(s) to GeoJSON?`
      : `Export an empty dataset to GeoJSON?`;
    if (!this.confirmAction(msg)) return;

    const blob = this.gj.toBlob(this.store.asCollection());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pois.export.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  onSaveLocal(): void {
    const count = this.store.features().length;
    const msg = count
      ? `Save ${count} point(s) to LocalStorage?`
      : `Save empty state to LocalStorage?`;
    if (!this.confirmAction(msg)) return;
    this.store.saveToLocalStorage();
  }

  onClearAll(): void {
    const msg = `Clear all points and reset the app?\n\nThis will remove the saved state from LocalStorage.`;
    if (!this.confirmAction(msg)) return;
    this.store.clear();
    this.importMessage.set('');
    this.name = '';
    this.category = '';
    this.processedTotal.set(0);
    this.discardedTotal.set(0);
    this.refreshLayerWithFilters();
    this.updateSelectedHighlight();
  }
}
