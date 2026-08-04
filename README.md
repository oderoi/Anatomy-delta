# Anatomy Atelier — Optimized for GitHub Pages

An interactive 3D human anatomy explorer, reimplemented for **GitHub Pages** with significant performance optimizations.

## ⚠️ Important: Use a Web Server for Local Testing

**Do NOT open `index.html` directly in your browser** (double-clicking the file). This will fail because:
- ES modules require a proper HTTP origin
- Three.js is loaded from CDN via `import` statements
- GLB models are fetched via `fetch()` which is blocked on `file://`

### Start a local server:
```bash
# Option 1: Python 3
python3 -m http.server 8000

# Option 2: Python 2
python -m SimpleHTTPServer 8000

# Option 3: Node.js (if you have npx)
npx serve .

# Option 4: PHP
php -S localhost:8000
```

Then open: **http://localhost:8000**

## 🚀 Optimizations Made

| Optimization | Impact |
|-------------|--------|
| **Removed React/Next.js/vinext** | Zero framework overhead. Pure vanilla JS. |
| **Removed GSAP** | Custom lightweight tween engine (~200 bytes vs 30KB). |
| **ESM via esm.sh CDN** | No build step, no node_modules, instant load. |
| **CSS inlined in HTML** | Single request for all styles, no FOUC. |
| **Service Worker** | Offline caching for models and assets. |
| **Render-on-demand preserved** | Three.js only renders when dirty (same as original). |
| **Intersection Observer** | Pauses rendering when off-screen. |
| **Visibility API** | Pauses when tab is hidden. |
| **3-model LRU cache** | Keeps recently viewed organs warm in memory. |
| **Depth-prepass fading** | Identical visual quality, no transparency artifacts. |
| **Baked contact shadow** | No real-time shadow maps (saves ~2ms/frame). |
| **Sprite hotspots** | No DOM overlay sync cost, GPU billboard dots. |
| **Vertex-snap (not raycast)** | Hotspots snap to mesh in O(n) vs per-frame raycast. |

## 📁 File Structure

```
anatomy-atelier/
├── index.html          # Single-file app shell (CSS inlined)
├── sw.js               # Service worker for offline caching
├── js/
│   ├── data.js         # Organ definitions & hotspots
│   ├── viewer.js       # Three.js engine (viewer + loaders + hotspots)
│   └── app.js          # UI binding & application logic
└── models/             # GLB files (download from original repo)
    ├── heart.glb
    ├── brain.glb
    ├── lungs.glb
    ├── liver.glb
    ├── kidneys.glb
    ├── eyeball.glb
    ├── intestine.glb
    ├── pancreas.glb
    └── skin.glb
```

## 🚀 Deploy to GitHub Pages

1. **Download the GLB models** from the original repository:
   ```bash
   # Clone the original to get models
   git clone https://github.com/thebuggeddev/anatomy.git temp
   cp temp/public/models/*.glb anatomy-atelier/models/
   rm -rf temp
   ```

2. **Push to your GitHub repo**:
   ```bash
   cd anatomy-atelier
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/anatomy-atelier.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   - Go to **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main / (root)**
   - Click **Save**
   - Your site will be live at `https://YOUR_USERNAME.github.io/anatomy-atelier/`

## 🎨 Features Preserved

- ✅ 9 fully interactive 3D organ models
- ✅ Clickable anatomy hotspots with callouts
- ✅ Auto-rotate with pause-on-interaction
- ✅ Cross-section clipping
- ✅ Wireframe / layers mode
- ✅ Isolate specimen mode
- ✅ Elegant atelier UI with responsive design
- ✅ Mobile drawer navigation
- ✅ Searchable organ library
- ✅ Learning cards with facts
- ✅ Keyboard controls (arrows, +/-, Escape)
- ✅ Accessibility: screen reader hotspots, focus states, ARIA labels

## 📄 License

Same as the original project. All 3D models and data remain property of their respective authors.
