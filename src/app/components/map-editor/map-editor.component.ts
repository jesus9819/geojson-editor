import { Component, OnDestroy, OnInit, effect, signal } from '@angular/core';
import maplibregl, { Map, LngLatLike, MapMouseEvent } from 'maplibre-gl';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStore } from '../../store/editor.store';
import { GeoJsonService } from '../../services/geojson.service';
import { PoiFeature } from '../../models/geojson';

@Component({
  selector: 'app-map-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map-editor.component.html',
  styleUrls: ['./map-editor.component.scss']
})
export class MapEditorComponent implements OnInit, OnDestroy {
  private map?: Map;
  name = ''; category = '';
  importMessage = signal<string>('');

  constructor(public store: EditorStore, private gj: GeoJsonService) {
    effect(() => {
      const src = this.map?.getSource('pois') as any;
      if (src) src.setData(this.store.asCollection());
    });
  }

  ngOnInit(): void {
    this.store.loadFromLocalStorage();
    this.initMap();
  }
  ngOnDestroy(): void { this.map?.remove(); }

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
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      } as any,
      center: [-70.65, -33.45] as LngLatLike, // Santiago
      zoom: 11
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this.map.on('load', () => {
      this.map!.addSource('pois', { type: 'geojson', data: this.store.asCollection() } as any);
      this.map!.addLayer({
        id: 'pois-circle',
        type: 'circle',
        source: 'pois',
        paint: { 'circle-radius': 6, 'circle-color': '#3b82f6', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      });

      this.map!.on('click', (e: MapMouseEvent) => this.onMapClick(e));
      this.map!.on('click', 'pois-circle', (e: any) => this.onPoiClick(e));
      this.map!.on('mousemove', 'pois-circle', () => this.map!.getCanvas().style.cursor = 'pointer');
      this.map!.on('mouseleave', 'pois-circle', () => this.map!.getCanvas().style.cursor = 'default');
    });
  }

  private onMapClick(e: MapMouseEvent): void {
    const coords = [e.lngLat.lng, e.lngLat.lat] as [number, number];
    const f: PoiFeature = { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { name: 'New POI', category: 'misc' } };
    this.store.addFeature(f);
    this.store.selectByIdx(this.store.features().length - 1);
    this.syncForm();
  }

  private onPoiClick(e: any): void {
    const feat = e?.features?.[0]; if (!feat) return;
    const [lng, lat] = feat.geometry.coordinates as [number, number];
    const idx = this.store.features().findIndex(f => {
      const [L, A] = f.geometry.coordinates; return L === lng && A === lat;
    });
    this.store.selectByIdx(idx >= 0 ? idx : null);
    this.syncForm();
    e.originalEvent?.stopPropagation?.();
  }

  syncForm(): void {
    const sel = this.store.selected();
    this.name = sel?.properties.name ?? ''; this.category = sel?.properties.category ?? '';
  }
  onSaveProps(): void { this.store.updateSelected({ name: this.name, category: this.category }); }
  onDeleteSelected(): void { this.store.deleteSelected(); this.name = ''; this.category = ''; }

  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    file.text().then(txt => {
      try {
        const { fc, summary } = this.gj.parseImport(txt);
        this.store.setFromImport(fc, summary);
        this.importMessage.set(`Importadas ${summary.imported} / Descartadas ${summary.discarded}`);
      } catch (err: any) {
        this.importMessage.set(`Error: ${err?.message ?? 'Archivo inválido'}`);
      } finally { input.value = ''; }
    });
  }

  onExport(): void {
    const blob = this.gj.toBlob(this.store.asCollection());
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'pois.export.geojson'; document.body.appendChild(a); a.click(); a.remove();
  }
  onSaveLocal(): void { this.store.saveToLocalStorage(); }
  onClearAll(): void { this.store.clear(); this.importMessage.set(''); this.name = ''; this.category = ''; }
}
