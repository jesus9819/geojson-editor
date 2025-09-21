// src/app/components/map-editor/map-editor.component.ts
import { Component, OnDestroy, OnInit, effect, signal } from '@angular/core';
import maplibregl, { Map, LngLatLike, MapMouseEvent, LngLatBoundsLike } from 'maplibre-gl';
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
  styleUrls: ['./map-editor.component.scss'],
})
export class MapEditorComponent implements OnInit, OnDestroy {
  private map?: Map;

  // bindings formulario
  name = '';
  category = '';
  importMessage = signal<string>('');

  // >>> Contadores que usa el template (procesadas y descartadas)
  processedTotal = signal<number>(0);
  discardedTotal = signal<number>(0);

  constructor(public store: EditorStore, private gj: GeoJsonService) {
    // Al cambiar la lista de features, refresca la fuente del mapa
    effect(() => {
      const _ = this.store.features(); // dependencia
      const src = this.map?.getSource('pois') as any;
      if (src) src.setData(this.store.asCollection());
    });

    // Mantén sincronizados los contadores para el header/panel
    effect(() => {
      const summary = this.store.importSummary(); // {imported, discarded, reasons} | null
      if (summary) {
        // Cuando se importó un archivo recientemente
        this.processedTotal.set(summary.imported + summary.discarded);
        this.discardedTotal.set(summary.discarded);
      } else {
        // Caso auto-restore inicial o edición manual sin import reciente
        const count = this.store.features().length;
        this.processedTotal.set(count);
        this.discardedTotal.set(0);
      }
    });
  }

  ngOnInit(): void {
    // Auto-restore antes de montar el mapa
    this.store.loadFromLocalStorage();
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ---------------- Mapa ----------------
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
      center: [-70.65, -33.45] as LngLatLike, // Santiago
      zoom: 11,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this.map.on('load', () => {
      // Fuente SOLO de puntos válidos
      this.map!.addSource('pois', {
        type: 'geojson',
        data: this.store.asCollection(),
      } as any);

      // Círculos de los POI válidos
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

      // Interacciones
      this.map!.on('click', (e: MapMouseEvent) => this.onMapClick(e));
      this.map!.on('click', 'pois-circle', (e: any) => this.onPoiClick(e));
      this.map!.on('mousemove', 'pois-circle', () => (this.map!.getCanvas().style.cursor = 'pointer'));
      this.map!.on('mouseleave', 'pois-circle', () => (this.map!.getCanvas().style.cursor = 'default'));
    });
  }

  private onMapClick(e: MapMouseEvent): void {
    const coords = [e.lngLat.lng, e.lngLat.lat] as [number, number];
    const f: PoiFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { name: 'New POI', category: 'misc' },
    };
    this.store.addFeature(f);
    this.store.selectByIdx(this.store.features().length - 1);
    this.syncForm();
  }

  private onPoiClick(e: any): void {
    const feat = e?.features?.[0];
    if (!feat) return;
    const [lng, lat] = feat.geometry.coordinates as [number, number];
    const idx = this.store.features().findIndex((f) => {
      const [L, A] = f.geometry.coordinates;
      return L === lng && A === lat;
    });
    this.store.selectByIdx(idx >= 0 ? idx : null);
    this.syncForm();
    e.originalEvent?.stopPropagation?.();
  }

  // ---------------- Form / acciones ----------------
  syncForm(): void {
    const sel = this.store.selected();
    this.name = sel?.properties.name ?? '';
    this.category = sel?.properties.category ?? '';
  }

  onSaveProps(): void {
    this.store.updateSelected({ name: this.name, category: this.category });
  }

  onDeleteSelected(): void {
    this.store.deleteSelected();
    this.name = '';
    this.category = '';
  }

  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    file.text().then((txt) => {
      try {
        const { fc, summary } = this.gj.parseImport(txt);

        // Válidos -> store (y por el effect se dibujan y se actualizan contadores)
        this.store.setFromImport(fc, summary);

        this.importMessage.set(`Importadas ${summary.imported} / Descartadas ${summary.discarded}`);

        // centrar el mapa a los válidos si existen
        if (fc.features.length) {
          const bounds = new maplibregl.LngLatBounds();
          for (const ft of fc.features) {
            bounds.extend(ft.geometry.coordinates as [number, number]);
          }
          if (!bounds.isEmpty()) {
            this.map?.fitBounds(bounds as LngLatBoundsLike, { padding: 60 });
          }
        }
      } catch (err: any) {
        this.importMessage.set(`Error: ${err?.message ?? 'Archivo inválido'}`);
      } finally {
        input.value = '';
      }
    });
  }

  onExport(): void {
    const blob = this.gj.toBlob(this.store.asCollection());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pois.export.geojson';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  onSaveLocal(): void {
    this.store.saveToLocalStorage();
  }

  onClearAll(): void {
    this.store.clear();
    this.importMessage.set('');
    this.name = '';
    this.category = '';
    this.processedTotal.set(0);
    this.discardedTotal.set(0);
  }
}
