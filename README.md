# GeoJSON Editor

Angular application to visualize and edit Points of Interest (POI) on a map using MapLibre, with support for importing/exporting GeoJSON files.

## Requirements
- Node.js >= 18
- Angular CLI >= 17

## Installation
```bash
npm install
```

## Run
```bash
ng serve -o
```

## Features
- Import valid GeoJSON with validation.
- Create, edit, move, and delete points on the map.
- Save and restore from LocalStorage.
- Export to GeoJSON file.
- Filter by name/category.
- Confirmation prompts on all actions.
- Highlight on selected point and cancel selection button.

## Decisions
- **MapLibre GL** was chosen for being open-source and lightweight.
- State management handled with **Angular signals** for simplicity.
- Invalid points are not rendered, only reported in the summary.
