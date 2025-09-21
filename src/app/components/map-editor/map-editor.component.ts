import { Component, OnDestroy, OnInit, effect, signal, computed } from '@angular/core';
import maplibregl, { Map, LngLatLike, MapMouseEvent, LngLatBoundsLike } from 'maplibre-gl';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStore } from '../../store/editor.store';
import { GeoJsonService } from '../../services/geojson.service';
import { PoiFeature } from '../../models/geojson';

type Cat =
  | 'park' | 'landmark' | 'square' | 'viewpoint'
  | 'mall' | 'stadium' | 'station' | 'bus_terminal'
  | 'airport' | 'misc';

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

  // mensajes breves
  importMessage = signal<string>('');

  // Totales calculados para el header: PROCESADAS = importadas + descartadas
  processedTotal = computed(() => {
    const s = this.store.importSummary();
    return s ? s.imported + s.discarded : 0;
  });
  discardedTotal = computed(() => this.store.importSummary()?.discarded ?? 0);

  // Colores por categoría (leyenda y estilo del mapa)
  readonly categoryColors: Record<Cat, string> = {
    park:        '#22c55e',
    landmark:    '#f59e0b',
    square:      '#fbbf24',
    viewpoint:   '#60a5fa',
    mall:        '#a78bfa',
    stadium:     '#22c55e',
    station:     '#0ea5e9',
    bus_terminal:'#ef4444',
    airport:     '#0284c7',
    misc:        '#3b82f6',
  };

  constructor(public store: EditorStore, private gj: GeoJsonService) {
    // Redibuja capa de válidos al cambiar el store
    effect(() => {
      void this.store.features(); // dependencia
      const src = this.map?.getSource('pois') as any;
      if (src) src.setData(this.store.asCollection());
    });
  }

  ngOnInit(): void {
    this.store.loadFromLocalStorage();
    this.initMap();
  }
  ngOnDestroy(): void { this.map?.remove(); }

  // ------------ MAPA ------------
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

    this.map.on('load', () => {
      // source de válidos
      this.map!.addSource('pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      } as any);

      // expresión de color por categoría
      const colorExpr: any[] = [
        'match',
        ['get', 'category'],
        'park', this.categoryColors.park,
        'landmark', this.categoryColors.landmark,
        'square', this.categoryColors.square,
        'viewpoint', this.categoryColors.viewpoint,
        'mall', this.categoryColors.mall,
        'stadium', this.categoryColors.stadium,
        'station', this.categoryColors.station,
        'bus_terminal', this.categoryColors.bus_terminal,
        'airport', this.categoryColors.airport,
        /* default */ this.categoryColors.misc,
      ];

      // círculos válidos
      this.map!.addLayer({
        id: 'pois-circle',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#111827',
          'circle-color': colorExpr as any,
        },
      });

      // halo al pasar el mouse
      this.map!.addLayer({
        id: 'pois-halo',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 14,
          'circle-color': '#000000',
          'circle-opacity': 0.08,
        },
        filter: ['==', ['id'], '___none___'],
      });

      // interacciones
      this.map!.on('mousemove', 'pois-circle', e => {
        const id = e.features?.[0]?.id ?? null;
        this.map!.getCanvas().style.cursor = 'pointer';
        this.map!.setFilter('pois-halo', ['==', ['id'], id]);
      });
      this.map!.on('mouseleave', 'pois-circle', () => {
        this.map!.getCanvas().style.cursor = '';
        this.map!.setFilter('pois-halo', ['==', ['id'], '___none___']);
      });

      this.map!.on('click', (e: MapMouseEvent) => this.onMapClick(e));
      this.map!.on('click', 'pois-circle', (e: any) => this.onPoiClick(e));
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
    const feat = e?.features?.[0]; if (!feat) return;
    const [lng, lat] = feat.geometry.coordinates as [number, number];
    const idx = this.store.features().findIndex(f => {
      const [L, A] = f.geometry.coordinates;
      return L === lng && A === lat;
    });
    this.store.selectByIdx(idx >= 0 ? idx : null);
    this.syncForm();
    e.originalEvent?.stopPropagation?.();
  }

  // ------------ Form / acciones ------------
  syncForm(): void {
    const sel = this.store.selected();
    this.name = sel?.properties.name ?? '';
    this.category = sel?.properties.category ?? '';
  }
  onSaveProps(): void { this.store.updateSelected({ name: this.name, category: this.category }); }
  onDeleteSelected(): void { this.store.deleteSelected(); this.name = ''; this.category = ''; }

  // Importar (solo válidos se guardan; inválidos solo cuentan)
  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;

    file.text().then(txt => {
      try {
        const { fc, summary } = this.gj.parseImport(txt);
        this.store.setFromImport(fc, summary);
        // centra a los válidos
        if (fc.features.length) {
          const b = new maplibregl.LngLatBounds();
          for (const ft of fc.features) b.extend(ft.geometry.coordinates as [number, number]);
          if (!b.isEmpty()) this.map?.fitBounds(b as LngLatBoundsLike, { padding: 60 });
        }
        this.importMessage.set(`Procesadas ${summary.imported + summary.discarded} • Importadas ${summary.imported} • Descartadas ${summary.discarded}`);
      } catch (err: any) {
        this.importMessage.set(`Error: ${err?.message ?? 'Archivo inválido'}`);
      } finally {
        input.value = '';
        setTimeout(() => this.importMessage.set(''), 4000);
      }
    });
  }

  onExport(): void {
    const blob = this.gj.toBlob(this.store.asCollection());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pois.export.geojson';
    document.body.appendChild(a); a.click(); a.remove();
  }
  onSaveLocal(): void { this.store.saveToLocalStorage(); }
  onClearAll(): void { this.store.clear(); this.importMessage.set(''); this.name = ''; this.category = ''; }
}
