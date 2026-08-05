import { organs, organById } from './data.js';
import { AnatomyViewer } from './viewer.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

class AnatomyApp {
  constructor() {
    this.currentOrganId = null;
    this.viewer = null;
    this.compareMode = false;
    this.systems = [...new Set(organs.map((o) => o.system))];
  }

  init() {
    try {
      this.renderNav();
      this.renderOrganList();
      this.renderLearningCards();
      this.initViewer();
      this.bindEvents();
      console.log('Anatomy Atelier initialized successfully');
    } catch (err) {
      console.error('Failed to initialize:', err);
    }
  }

  initViewer() {
    const mount = $('#threeMount');
    if (!mount) throw new Error('3D mount element not found');
    this.viewer = new AnatomyViewer(mount, {
      onLoading: (loading, progress) => this.onLoading(loading, progress),
      onSelect: (hotspot) => this.onSelect(hotspot),
    });
    this.viewer.attachCallout($('#hotspotCallout'));
  }

  renderNav() {
    const nav = $('#mainNav');
    if (!nav) return;
    nav.innerHTML = '';
    this.systems.forEach((sys) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<span>${sys}</span>`;
      btn.onclick = () => {
        $$('.main-nav button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const first = organs.find((o) => o.system === sys);
        if (first) this.selectOrgan(first.id);
      };
      nav.appendChild(btn);
    });
  }

  renderOrganList(filter = '') {
    const list = $('#organList');
    if (!list) return;
    list.innerHTML = '';
    const term = filter.toLowerCase();
    let count = 0;
    organs.forEach((organ) => {
      if (term && !organ.name.toLowerCase().includes(term) && !organ.system.toLowerCase().includes(term)) return;
      count++;
      const btn = document.createElement('button');
      btn.className = 'organ-item';
      btn.dataset.id = organ.id;
      btn.style.setProperty('--item-accent', organ.accent);
      btn.innerHTML = `
        <div class="organ-glyph" style="background:radial-gradient(circle at 35% 28%, #fff, ${organ.accent}22);color:${organ.accent}">${organ.icon}</div>
        <div>
          <b>${organ.name}</b>
          <small>${organ.system}</small>
        </div>
        <span style="color:${organ.accent}">→</span>
      `;
      btn.onclick = () => this.selectOrgan(organ.id);
      list.appendChild(btn);
    });
    if (count === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px;">No organs found</div>';
    }
  }

  renderLearningCards() {
    const container = $('#learningCards');
    if (!container) return;
    container.innerHTML = '';
    const cards = [
      { type: 'curiosity', title: 'Daily Curiosity', text: organs[0]?.funFact ?? '', icon: '✦' },
      ...organs.slice(0, 5).map((o) => ({
        type: 'organ',
        organ: o,
        title: o.comparison,
        accent: o.accent,
      })),
    ];
    cards.forEach((card) => {
      const article = document.createElement('article');
      if (card.type === 'curiosity') {
        article.className = 'curiosity-card';
        article.innerHTML = `
          <span>${card.icon}</span>
          <p>${card.text}</p>
          <em>— from the ${organs[0]?.name ?? 'Heart'}</em>
        `;
      } else {
        article.style.setProperty('--art-accent', card.accent);
        article.innerHTML = `
          <header>
            <div>
              <em>${card.organ.system}</em>
              <h3>${card.title}</h3>
            </div>
          </header>
          <div class="organ-card-image">
            <div class="art-fallback" style="background:radial-gradient(circle at 40% 32%, #fff, ${card.accent}22);color:${card.accent}">${card.organ.icon}</div>
          </div>
          <button class="view-all">Explore ${card.organ.name}</button>
        `;
        article.querySelector('button').onclick = () => this.selectOrgan(card.organ.id);
      }
      container.appendChild(article);
    });
  }

  // async selectOrgan(id) {
  //   if (this.currentOrganId === id && this.viewer?.organ) return;
  //   const organ = organById[id];
  //   if (!organ) {
  //     console.error('Organ not found:', id);
  //     return;
  //   }
  //   this.currentOrganId = id;

  //   $$('.organ-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.id === id));
  //   $$('.main-nav button').forEach((btn, i) => {
  //     btn.classList.toggle('active', this.systems[i] === organ.system);
  //   });

  //   $('#infoSystem').textContent = organ.system;
  //   $('#infoName').textContent = organ.name;
  //   $('#infoScientific').textContent = organ.scientificName;
  //   $('#infoStamp').textContent = organ.icon;
  //   $('#infoStamp').style.color = organ.accent;
  //   $('#infoDescription').textContent = organ.description;
  //   $('#infoMedical').textContent = organ.medical;
  //   $('#infoFunFact').textContent = organ.funFact;
  //   $('#captionOrgan').textContent = organ.name;
  //   $('#viewerGlow').style.background = organ.accent + '0F';
  //   $('#tipText').textContent = organ.funFact;

  //   const facts = [
  //     { label: 'Size', value: organ.size, icon: '◎' },
  //     { label: 'Weight', value: organ.weight, icon: '⚖' },
  //     { label: 'Location', value: organ.location, icon: '⌖' },
  //     { label: 'Function', value: organ.function, icon: '⚙' },
  //     { label: 'Tissue', value: organ.tissue, icon: '◈' },
  //     { label: 'Blood Supply', value: organ.bloodSupply, icon: '♥' },
  //   ];
  //   $('#infoFacts').innerHTML = facts.map((f) => `
  //     <div>
  //       <dt><span>${f.icon}</span> ${f.label}</dt>
  //       <dd>${f.value}</dd>
  //     </div>
  //   `).join('');

  //   $('#hotspotIndex').innerHTML = organ.hotspots.map((h) => `
  //     <li><button onclick="app.selectHotspot('${h.id}')">${h.label}: ${h.detail}</button></li>
  //   `).join('');

  //   // Load 3D model — viewer handles retries internally, never throws to us
  //   const ok = await this.viewer.setOrgan(organ.model, organ.hotspots, organ.accent);
  //   if (!ok) {
  //     console.warn('Model load failed for', organ.name, '- user can click again to retry');
  //     // Reset currentOrganId so the user can click the same organ again
  //     this.currentOrganId = null;
  //     $$('.organ-item').forEach((btn) => btn.classList.remove('active'));
  //     return;
  //   }

  //   const idx = organs.findIndex((o) => o.id === id);
  //   [1, 2].forEach((offset) => {
  //     const next = organs[(idx + offset) % organs.length];
  //     this.viewer.prefetch(next.model);
  //   });
  // }

    async selectOrgan(id) {
    if (this.currentOrganId === id && this.viewer?.organ) return;
    const organ = organById[id];
    if (!organ) {
      console.error('Organ not found:', id);
      return;
    }
    this.currentOrganId = id;

    $$('.organ-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.id === id));
    $$('.main-nav button').forEach((btn, i) => {
      btn.classList.toggle('active', this.systems[i] === organ.system);
    });

    $('#infoSystem').textContent = organ.system;
    $('#infoName').textContent = organ.name;
    $('#infoScientific').textContent = organ.scientificName;
    $('#infoStamp').textContent = organ.icon;
    $('#infoStamp').style.color = organ.accent;
    $('#infoDescription').textContent = organ.description;
    $('#infoMedical').textContent = organ.medical;
    $('#infoFunFact').textContent = organ.funFact;
    $('#captionOrgan').textContent = organ.name;
    $('#viewerGlow').style.background = organ.accent + '0F';
    $('#tipText').textContent = organ.funFact;

    const facts = [
      { label: 'Size', value: organ.size, icon: '◎' },
      { label: 'Weight', value: organ.weight, icon: '⚖' },
      { label: 'Location', value: organ.location, icon: '⌖' },
      { label: 'Function', value: organ.function, icon: '⚙' },
      { label: 'Tissue', value: organ.tissue, icon: '◈' },
      { label: 'Blood Supply', value: organ.bloodSupply, icon: '♥' },
    ];
    $('#infoFacts').innerHTML = facts.map((f) => `
      <div>
        <dt><span>${f.icon}</span> ${f.label}</dt>
        <dd>${f.value}</dd>
      </div>
    `).join('');

    $('#hotspotIndex').innerHTML = organ.hotspots.map((h) => `
      <li><button onclick="app.selectHotspot('${h.id}')">${h.label}: ${h.detail}</button></li>
    `).join('');

    const ok = await this.viewer.setOrgan(organ.model, organ.hotspots, organ.accent);
    if (!ok) {
      console.warn('Model load failed for', organ.name);
      this.currentOrganId = null;
      $$('.organ-item').forEach((btn) => btn.classList.remove('active'));
      this.onLoading(false, 0);
      return;
    }

    const idx = organs.findIndex((o) => o.id === id);
    [1, 2].forEach((offset) => {
      const next = organs[(idx + offset) % organs.length];
      this.viewer.prefetch(next.model);
    });
  }

  onLoading(loading, progress) {
    const loader = $('#modelLoader');
    const text = $('#loaderText');
    const pct = $('#loaderPercent');
    if (!loader) return;
    if (loading) {
      loader.classList.remove('hidden');
      if (text) text.textContent = `Preparing the ${organById[this.currentOrganId]?.name?.toLowerCase() ?? 'organ'}`;
      if (pct) pct.textContent = `${Math.max(8, Math.round(progress * 100))}%`;
    } else {
      setTimeout(() => loader.classList.add('hidden'), 300);
    }
  }

  onSelect(hotspot) {
    const callout = $('#hotspotCallout');
    if (!callout) return;
    if (!hotspot) { callout.style.display = 'none'; return; }
    callout.style.display = 'block';
    $('#calloutLabel').textContent = hotspot.label;
    $('#calloutDetail').textContent = hotspot.detail;
    const body = callout.querySelector('.callout-body');
    if (body) body.style.setProperty('--hotspot-color', hotspot.color);
  }

  selectHotspot(id) {
    this.viewer.select(id);
    const organ = organById[this.currentOrganId];
    const h = organ?.hotspots?.find((x) => x.id === id);
    this.onSelect(h || null);
  }

  bindEvents() {
    const searchInput = $('#searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.renderOrganList(e.target.value));
    }

    const trigger = $('#mobileLibraryTrigger');
    const closeBtn = $('#mobileLibraryClose');
    const backdrop = $('#drawerBackdrop');
    const library = $('#organLibrary');

    if (trigger) trigger.onclick = () => {
      library?.classList.add('open');
      backdrop?.classList.add('open');
    };
    const closeDrawer = () => {
      library?.classList.remove('open');
      backdrop?.classList.remove('open');
    };
    if (closeBtn) closeBtn.onclick = closeDrawer;
    if (backdrop) backdrop.onclick = closeDrawer;

    const tools = $('#viewerTools');
    if (tools) tools.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (!btn) return;
      const tool = btn.dataset.tool;
      if (tool === 'reset') { this.viewer.reset(); btn.classList.remove('active'); }
      if (tool === 'zoomIn') this.viewer.zoom(-1);
      if (tool === 'isolate') btn.classList.toggle('active', this.viewer.toggleIsolate());
      if (tool === 'crossSection') btn.classList.toggle('active', this.viewer.toggleCrossSection());
      if (tool === 'layers') btn.classList.toggle('active', this.viewer.toggleLayers());
      if (tool === 'compare') this.toggleCompare();
    });

    const autoRotateBtn = $('#autoRotateBtn');
    if (autoRotateBtn) autoRotateBtn.onclick = () => {
      const sw = $('#autoRotateSwitch');
      const isOn = sw?.classList.toggle('on');
      this.viewer.setAutoRotate(!!isOn);
      autoRotateBtn.setAttribute('aria-pressed', String(!!isOn));
    };

    const calloutClose = $('#calloutClose');
    if (calloutClose) calloutClose.onclick = () => {
      this.viewer.clearSelection();
      $('#hotspotCallout').style.display = 'none';
    };

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.viewer.clearSelection();
        const callout = $('#hotspotCallout');
        if (callout) callout.style.display = 'none';
      }
    });
  }

  toggleCompare() {
    this.compareMode = !this.compareMode;
    if (this.compareMode) {
      const next = organs[(organs.findIndex((o) => o.id === this.currentOrganId) + 1) % organs.length];
      alert(`Compare mode: ${organById[this.currentOrganId]?.name ?? 'Current'} vs ${next?.name ?? 'Next'} (visual comparison coming in v2)`);
      this.compareMode = false;
    }
  }
}

const app = new AnatomyApp();
window.app = app;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}