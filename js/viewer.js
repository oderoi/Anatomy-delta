import * as THREE from 'https://esm.sh/three@0.185.1';
import { OrbitControls } from 'https://esm.sh/three@0.185.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.185.1/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://esm.sh/three@0.185.1/examples/jsm/libs/meshopt_decoder.module.js';

const FIT_SIZE = 3.8;
const CACHE_LIMIT = 3;
const DOT_PIXELS = 34;
const CAMERA_FOV = 34;
const DEPTH_PREPASS = 'depth-prepass';
const PLINTH_Y = -2.5;
const PLINTH_TOP = PLINTH_Y + 0.17;
const HOME_CAMERA = { x: 0, y: 1.05, z: 8.2 };
const HOME_TARGET = { x: 0, y: 0.02, z: 0 };

function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => { if (v && v.dispose) v.dispose(); });
        m.dispose();
      });
    }
  });
}

class AnatomyAssetManager {
  constructor(renderer) {
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.cache = new Map();
    this.inflight = new Map();
    this.current = null;
  }

  get hasAnimation() { return Boolean(this.current?.mixer); }

  prefetch(url) {
    if (this.cache.has(url) || this.inflight.has(url)) return;
    fetch(url, { priority: 'low' }).catch(() => {});
  }

  async load(url, onProgress) {
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url); this.cache.set(url, cached);
      this.resetMaterials(cached);
      onProgress?.(1);
      this.current = cached;
      return cached;
    }
    const pending = this.inflight.get(url) ?? this.parse(url, onProgress);
    this.inflight.set(url, pending);
    try {
      const organ = await pending;
      this.cache.set(url, organ);
      this.evict();
      this.current = organ;
      return organ;
    } finally {
      this.inflight.delete(url);
    }
  }

  async parse(url, onProgress) {
    const gltf = await this.loader.loadAsync(url, (e) => {
      if (e.total > 0) onProgress?.(e.loaded / e.total);
    });
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = FIT_SIZE / Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(scale);
    model.position.copy(center.multiplyScalar(-scale));

    const pivot = new THREE.Group();
    pivot.name = 'organ-pivot';
    pivot.add(model);
    pivot.rotation.set(0.05, -0.28, 0);

    const meshes = [];
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      meshes.push(child);
      child.frustumCulled = false;
      child.castShadow = false;
      child.receiveShadow = false;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat.transparent = false; mat.opacity = 1; mat.depthWrite = true; mat.depthTest = true; mat.side = THREE.FrontSide;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.5, 0.42, 0.62);
          mat.metalness = 0; mat.envMapIntensity = 0.32;
          mat.emissive.set(0x000000); mat.emissiveIntensity = 0;
          if ('clearcoat' in mat) {
            mat.clearcoat = Math.min(Math.max(mat.clearcoat, 0.08), 0.12);
            mat.clearcoatRoughness = 0.62;
            mat.transmission = 0; mat.thickness = 0;
          }
          if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          if (mat.normalMap) mat.normalScale.multiplyScalar(0.62);
          [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap, mat.emissiveMap].forEach((map) => {
            if (!map) return;
            map.anisotropy = this.maxAnisotropy;
            map.generateMipmaps = true;
            map.minFilter = THREE.LinearMipmapLinearFilter;
            map.magFilter = THREE.LinearFilter;
            map.needsUpdate = true;
          });
        }
        mat.needsUpdate = true;
      });
    });

    let mixer = null;
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    }
    return { url, pivot, meshes, mixer };
  }

  resetMaterials(organ) {
    organ.pivot.rotation.set(0.05, -0.28, 0);
    organ.pivot.position.set(0, 0, 0);
    organ.meshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat) => {
        mat.transparent = false; mat.opacity = 1; mat.depthWrite = true;
        mat.clippingPlanes = null; mat.clipShadows = false;
        if (mat instanceof THREE.MeshStandardMaterial) mat.wireframe = false;
        mat.needsUpdate = true;
      });
    });
  }

  evict() {
    while (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) return;
      const organ = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (organ && organ !== this.current) this.destroy(organ);
    }
  }

  destroy(organ) {
    organ.mixer?.stopAllAction();
    organ.mixer?.uncacheRoot(organ.pivot);
    organ.pivot.removeFromParent();
    disposeObject(organ.pivot);
  }

  update(delta) { this.current?.mixer?.update(delta); }

  release(organ = this.current) {
    if (!organ) return;
    organ.mixer?.stopAllAction();
    organ.pivot.removeFromParent();
    if (organ === this.current) this.current = null;
  }

  dispose() {
    this.release();
    this.cache.forEach((o) => this.destroy(o));
    this.cache.clear();
  }
}

const TAU = Math.PI * 2;
const SURFACE_LIFT = 0.02;
const VIEW_LIFT = 0.3;
const PULSE_SECONDS = 4.5;

function rgba(color, alpha) {
  return `rgba(${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${alpha})`;
}

function dotTexture(hex) {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), c = size/2;
  const color = new THREE.Color(hex);
  const halo = ctx.createRadialGradient(c,c,size*0.3,c,c,size*0.5);
  halo.addColorStop(0, rgba(color,0.4)); halo.addColorStop(0.5, rgba(color,0.14)); halo.addColorStop(1, rgba(color,0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(c,c,c,0,TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(c,c,size*0.3,0,TAU); ctx.fillStyle='rgba(48,32,24,0.22)'; ctx.fill();
  ctx.beginPath(); ctx.arc(c,c,size*0.285,0,TAU); ctx.fillStyle='rgba(255,253,249,0.97)'; ctx.fill();
  ctx.beginPath(); ctx.arc(c,c,size*0.185,0,TAU); ctx.fillStyle=rgba(color,1); ctx.fill();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function ringTexture() {
  const size = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), c = size/2;
  ctx.strokeStyle='rgba(255,255,255,1)'; ctx.lineWidth=size*0.035;
  ctx.beginPath(); ctx.arc(c,c,size*0.42,0,TAU); ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

const DIRECTION_CONES = [0.94, 0.82, 0.6, -1.1];

function snapToSurface(hotspots, pivot, meshes) {
  const targets = hotspots.map((h) => new THREE.Vector3(...h.position));
  const directions = targets.map((t) => t.clone().normalize());
  const tiers = hotspots.map(() => DIRECTION_CONES.map(() => null));
  if (!meshes.length) return targets;
  pivot.updateWorldMatrix(true, true);
  const toPivot = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const vertex = new THREE.Vector3();

  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    local.multiplyMatrices(toPivot, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      vertex.fromBufferAttribute(pos, i).applyMatrix4(local);
      const radius = vertex.length();
      for (let h = 0; h < targets.length; h++) {
        const dist = vertex.distanceToSquared(targets[h]);
        const cosine = radius > 1e-5 ? vertex.dot(directions[h]) / radius : 1;
        for (let t = 0; t < DIRECTION_CONES.length; t++) {
          if (cosine < DIRECTION_CONES[t]) continue;
          const best = tiers[h][t];
          if (best && best.distance <= dist) continue;
          if (best) { best.distance = dist; best.mesh = mesh; best.index = i; best.point.copy(vertex); }
          else tiers[h][t] = { distance: dist, mesh, index: i, point: vertex.clone() };
        }
      }
    }
  }

  const normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  return targets.map((target, h) => {
    const chosen = tiers[h].find(Boolean);
    if (!chosen) return target;
    const normals = chosen.mesh.geometry.getAttribute('normal');
    local.multiplyMatrices(toPivot, chosen.mesh.matrixWorld);
    normalMatrix.getNormalMatrix(local);
    if (normals) normal.fromBufferAttribute(normals, chosen.index).applyMatrix3(normalMatrix).normalize();
    else normal.copy(chosen.point).normalize();
    if (normal.dot(chosen.point) < 0) normal.negate();
    return chosen.point.addScaledVector(normal, SURFACE_LIFT);
  });
}

class HotspotLayer {
  constructor() {
    this.markers = [];
    this.ring = ringTexture();
    this.group = new THREE.Group();
    this.group.name = 'hotspot-layer';
    this.group.renderOrder = 10;
    this.pixelScale = 0.021;
    this.time = 0;
    this.selectedAt = -PULSE_SECONDS;
    this.lastSelectedId = null;
    this.world = new THREE.Vector3();
    this.toCamera = new THREE.Vector3();
    this.outward = new THREE.Vector3();
    this.center = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.localCamera = new THREE.Vector3();
    this.lift = new THREE.Vector3();
  }

  get list() { return this.markers; }

  attach(pivot, hotspots, meshes) {
    this.clear();
    if (!hotspots.length) return;
    const anchors = snapToSurface(hotspots, pivot, meshes);
    hotspots.forEach((hotspot, index) => {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTexture(hotspot.color), transparent: true, depthWrite: false, depthTest: true,
        sizeAttenuation: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12,
      }));
      dot.position.copy(anchors[index]); dot.renderOrder = 11;
      const pulse = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.ring, color: new THREE.Color(hotspot.color), transparent: true, opacity: 0,
        depthWrite: false, depthTest: true, sizeAttenuation: false, toneMapped: false,
      }));
      pulse.position.copy(anchors[index]); pulse.renderOrder = 10;
      this.group.add(pulse, dot);
      this.markers.push({ hotspot, dot, pulse, anchor: anchors[index].clone(), opacity: 0, emphasis: 0 });
    });
    this.group.position.set(0,0,0);
    pivot.add(this.group);
    this.applyScale();
  }

  setPixelSize(pixels, viewportHeight, fovDegrees) {
    const fov = THREE.MathUtils.degToRad(fovDegrees);
    this.pixelScale = 2 * (pixels / Math.max(viewportHeight, 1)) * Math.tan(fov / 2);
    this.applyScale();
  }

  applyScale() {
    this.markers.forEach((m) => {
      const scale = this.pixelScale * (1 + m.emphasis * 0.3) * (0.74 + 0.26 * m.opacity);
      m.dot.scale.setScalar(scale);
    });
  }

  update(camera, delta, selectedId, hoveredId) {
    if (!this.markers.length) return true;
    this.time += delta;
    this.group.updateWorldMatrix(true, false);
    this.group.getWorldPosition(this.center);
    this.localCamera.copy(camera.position);
    this.group.worldToLocal(this.localCamera);
    if (selectedId !== this.lastSelectedId) { this.lastSelectedId = selectedId; this.selectedAt = this.time; }
    const beating = this.time - this.selectedAt < PULSE_SECONDS;
    let settled = true;
    for (const marker of this.markers) {
      this.lift.copy(this.localCamera).sub(marker.anchor);
      const span = this.lift.length();
      if (span > 1e-4) this.lift.multiplyScalar(VIEW_LIFT / span); else this.lift.set(0,0,0);
      marker.dot.position.copy(marker.anchor).add(this.lift);
      marker.pulse.position.copy(marker.dot.position);
      marker.dot.getWorldPosition(this.world);
      this.outward.copy(this.world).sub(this.center);
      const radius = this.outward.length();
      this.toCamera.copy(camera.position).sub(this.world).normalize();
      const facing = radius > 1e-4 ? this.outward.divideScalar(radius).dot(this.toCamera) : 1;
      const target = THREE.MathUtils.smoothstep(facing, -0.05, 0.3);
      const active = marker.hotspot.id === selectedId || marker.hotspot.id === hoveredId;
      const emphasisTarget = active ? 1 : 0;
      const ease = 1 - Math.exp(-delta * 12);
      if (Math.abs(target - marker.opacity) > 0.002) settled = false;
      if (Math.abs(emphasisTarget - marker.emphasis) > 0.002) settled = false;
      marker.opacity += (target - marker.opacity) * ease;
      marker.emphasis += (emphasisTarget - marker.emphasis) * ease;
      marker.dot.material.opacity = marker.opacity;
      marker.dot.visible = marker.opacity > 0.01;
      if (marker.emphasis > 0.01) {
        marker.pulse.visible = true;
        if (beating || marker.hotspot.id === hoveredId) {
          const beat = (this.time * 0.75) % 1;
          marker.pulse.material.opacity = marker.emphasis * marker.opacity * (1 - beat) * 0.85;
          marker.pulse.scale.setScalar(this.pixelScale * (1.15 + beat * 1.5));
          settled = false;
        } else {
          marker.pulse.material.opacity = marker.emphasis * marker.opacity * 0.42;
          marker.pulse.scale.setScalar(this.pixelScale * 1.6);
        }
      } else if (marker.pulse.visible) marker.pulse.visible = false;
    }
    this.applyScale();
    return settled;
  }

  pick(x, y, camera, width, height, radius = 24) {
    let best = null, bestDistance = radius;
    for (const marker of this.markers) {
      if (marker.opacity < 0.35) continue;
      marker.dot.getWorldPosition(this.projected).project(camera);
      if (this.projected.z > 1) continue;
      const px = (this.projected.x * 0.5 + 0.5) * width;
      const py = (-this.projected.y * 0.5 + 0.5) * height;
      const dist = Math.hypot(px - x, py - y);
      if (dist < bestDistance) { bestDistance = dist; best = marker; }
    }
    return best;
  }

  screenPosition(id, camera, width, height) {
    const marker = this.markers.find((m) => m.hotspot.id === id);
    if (!marker) return null;
    marker.dot.getWorldPosition(this.projected).project(camera);
    return {
      x: (this.projected.x * 0.5 + 0.5) * width,
      y: (-this.projected.y * 0.5 + 0.5) * height,
      opacity: marker.opacity,
    };
  }

  clear() {
    this.markers.forEach((m) => { m.dot.material.map?.dispose(); m.dot.material.dispose(); m.pulse.material.dispose(); });
    this.markers = [];
    this.group.clear();
    this.group.removeFromParent();
  }

  dispose() { this.clear(); this.ring.dispose(); }
}

export class AnatomyViewer {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    const lowPower = window.matchMedia('(max-width: 780px)').matches || (navigator.hardwareConcurrency ?? 8) < 6;
    this.basePixelRatio = Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !lowPower, alpha: true, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = false;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D anatomy model. Drag to rotate, scroll to zoom, and click a dot to read about that structure.');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    this.camera.position.set(HOME_CAMERA.x, HOME_CAMERA.y, HOME_CAMERA.z);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.8;
    this.controls.maxDistance = 12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.65;
    this.controls.target.set(HOME_TARGET.x, HOME_TARGET.y, HOME_TARGET.z);

    this.assets = new AnatomyAssetManager(this.renderer);
    this.hotspots = new HotspotLayer();
    this.buildEnvironment();

    this.frame = 0; this.clock = new THREE.Clock();
    this.width = 1; this.height = 1;
    this.isVisible = true; this.isPageVisible = true;
    this.dirty = true; this.busyUntil = 0; this.loadRequest = 0;
    this.autoRotateWanted = true; this.interactionUntil = 0;
    this.selectedId = null; this.hoveredId = null;
    this.hoverProbe = null; this.pointerId = null;
    this.pointerStart = { x: 0, y: 0 }; this.dragged = false;
    this.calloutEl = null; this.fadeTween = null;
    this.disposed = false; this.organ = null;
    this.crossSection = false; this.isolated = false;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(([e]) => {
      this.isVisible = e.isIntersecting;
      if (this.isVisible) this.dirty = true;
    }, { rootMargin: '120px' });
    this.intersectionObserver.observe(container);

    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.controls.addEventListener('start', this.onControlStart);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('keydown', this.onKeyDown);

    this.resize();
    this.animate();
  }

  buildEnvironment() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0x33252d, 0.72));
    const key = new THREE.DirectionalLight(0xfff3e7, 3.5); key.position.set(4.8, 6.5, 6.8); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xe6ecff, 1.12); fill.position.set(-4.5, 1.2, 5.2); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffb7a5, 1.6); rim.position.set(-4, 3.5, -5.5); this.scene.add(rim);
    const warm = new THREE.PointLight(0xff8d70, 0.72, 11, 2); warm.position.set(-3, -1.4, 3.5); this.scene.add(warm);
    const glow = new THREE.PointLight(0xee7c6a, 0.5, 8, 2); glow.name = 'organ-glow'; glow.position.set(2.8, 0.4, 2.8); this.scene.add(glow);
    this.scene.environment = this.buildEnvironmentMap();

    this.plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.48, 0.34, 56),
      new THREE.MeshStandardMaterial({ color: 0xead7c1, roughness: 0.78, metalness: 0 }),
    );
    this.plinth.position.y = PLINTH_Y; this.scene.add(this.plinth);

    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.MeshBasicMaterial({ map: this.contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.62, toneMapped: false }),
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = PLINTH_TOP + 0.005;
    this.contactShadow.renderOrder = 1;
    this.scene.add(this.contactShadow);

    const positions = new Float32Array(48 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (Math.random() - 0.5) * 9;
      positions[i+1] = (Math.random() - 0.5) * 6;
      positions[i+2] = (Math.random() - 0.5) * 5 - 2;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: 0xe7a18e, size: 0.013, transparent: true, opacity: 0.16 })));
  }

  buildEnvironmentMap() {
    const width = 16, height = 32, data = new Uint8Array(width * height * 4);
    const top = new THREE.Color(0xfff3e4), bottom = new THREE.Color(0x6b4f45), mixed = new THREE.Color();
    for (let y = 0; y < height; y++) {
      mixed.copy(bottom).lerp(top, Math.pow(1 - y / (height - 1), 0.7));
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = mixed.r * 255; data[i+1] = mixed.g * 255; data[i+2] = mixed.b * 255; data[i+3] = 255;
      }
    }
    const source = new THREE.DataTexture(data, width, height);
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.colorSpace = THREE.SRGBColorSpace;
    source.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(source).texture;
    pmrem.dispose(); source.dispose();
    return env;
  }

  contactShadowTexture() {
    const size = 256, canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, size*0.04, size/2, size/2, size*0.5);
    g.addColorStop(0, 'rgba(94,62,42,0.62)'); g.addColorStop(0.45, 'rgba(94,62,42,0.26)'); g.addColorStop(1, 'rgba(94,62,42,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }

  prefetch(url) { this.assets.prefetch(url); }

  async setOrgan(modelUrl, hotspots, accent) {
    const request = ++this.loadRequest;
    this.select(null);
    this.callbacks.onLoading(true, 0);
    const outgoing = this.organ;
    if (outgoing) {
      if (this.fadeTween) { this.fadeTween = null; }
      this.setDepthPrepass(outgoing, false);
      this.hotspots.clear();
      this.busy(0.8);
      await this.tween(outgoing.pivot.scale, { x: 0.72, y: 0.72, z: 0.72, duration: 0.34, ease: 'power2.in' });
      if (request !== this.loadRequest) return;
      this.assets.release(outgoing);
      this.organ = null; this.dirty = true;
    }
    if (request !== this.loadRequest) return;
    this.tween(this.camera.position, { z: 9.2, duration: 0.42, ease: 'power2.inOut' });
    let organ;
    try {
      organ = await this.assets.load(modelUrl, (p) => { if (request === this.loadRequest) this.callbacks.onLoading(true, p); });
    } catch (e) { 
      if (request === this.loadRequest) {
        this.callbacks.onLoading(false, 0);
        this.organ = null; 
      }
      throw e; 
    }
    if (request !== this.loadRequest || this.disposed) return;
    this.organ = organ;
    organ.pivot.scale.setScalar(1); organ.pivot.position.set(0,0,0);
    this.scene.add(organ.pivot); organ.pivot.updateWorldMatrix(true, true);
    this.hotspots.attach(organ.pivot, hotspots, organ.meshes);
    this.hotspots.setPixelSize(DOT_PIXELS, this.height, CAMERA_FOV);
    if (this.crossSection) this.applyClipping(true);
    const glow = this.scene.getObjectByName('organ-glow');
    if (glow) glow.color.set(accent);
    organ.pivot.scale.setScalar(0.58); organ.pivot.position.z = -1.3;
    this.busy(1.4); this.fade(organ, 1, 0.72);
    this.callbacks.onLoading(false, 1);
    this.tween(organ.pivot.scale, { x: 1, y: 1, z: 1, duration: 0.9, ease: 'back.out(1.25)' });
    this.tween(organ.pivot.position, { z: 0, duration: 0.85, ease: 'power3.out' });
    this.tween(this.camera.position, { z: 8.2, duration: 0.9, ease: 'power2.out', delay: 0.08 });
  }

  materials(organ) {
    const list = [];
    organ.meshes.forEach((mesh) => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => { if (!list.includes(m)) list.push(m); });
    });
    return list;
  }

  fade(organ, to, duration) {
    const materials = this.materials(organ);
    const state = { value: to >= 1 ? 0 : 1 };
    materials.forEach((m) => { m.transparent = true; m.opacity = state.value; m.depthWrite = true; });
    this.setDepthPrepass(organ, true);
    this.busy(duration + 0.1);
    const start = performance.now();
    const tick = () => {
      const t = Math.min((performance.now() - start) / (duration * 1000), 1);
      const eased = 1 - (1 - t) * (1 - t);
      const val = to >= 1 ? eased : 1 - eased;
      materials.forEach((m) => (m.opacity = val));
      this.dirty = true;
      if (t < 1) requestAnimationFrame(tick);
      else {
        if (to >= 1) materials.forEach((m) => { m.transparent = false; m.opacity = 1; m.depthWrite = true; });
        this.setDepthPrepass(organ, false);
        this.fadeTween = null; this.dirty = true;
      }
    };
    tick();
  }

  setDepthPrepass(organ, enabled) {
    organ.meshes.forEach((mesh) => {
      const existing = mesh.children.find((c) => c.name === DEPTH_PREPASS);
      if (!enabled) { existing?.removeFromParent(); return; }
      if (existing) return;
      const proxy = new THREE.Mesh(mesh.geometry, this.depthMaterial);
      proxy.name = DEPTH_PREPASS; proxy.frustumCulled = mesh.frustumCulled;
      mesh.add(proxy);
    });
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    if (!this.isVisible || !this.isPageVisible) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    this.applyAutoRotate(now);
    if (this.controls.update(delta)) this.dirty = true;
    if (this.assets.hasAnimation) { this.assets.update(delta); this.dirty = true; }
    if (this.hoverProbe) this.resolveHover();
    if (!this.dirty && now >= this.busyUntil) return;
    if (!this.hotspots.update(this.camera, delta, this.selectedId, this.hoveredId)) this.dirty = true;
    else this.dirty = false;
    if (now < this.busyUntil) this.dirty = true;
    this.positionCallout();
    this.renderer.render(this.scene, this.camera);
  };

  busy(seconds) { this.busyUntil = Math.max(this.busyUntil, performance.now() + seconds * 1000); this.dirty = true; }

  tween(target, vars) {
    this.busy(vars.duration ?? 0.5);
    const start = performance.now();
    const from = {};
    for (const k in vars) if (k !== 'duration' && k !== 'ease' && k !== 'delay') from[k] = target[k];
    const delay = (vars.delay ?? 0) * 1000;
    const dur = (vars.duration ?? 0.5) * 1000;
    const ease = vars.ease ?? 'power2.out';
    const tick = () => {
      const elapsed = performance.now() - start - delay;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }
      let t = Math.min(elapsed / dur, 1);
      if (ease === 'power2.in') t = t * t;
      else if (ease === 'power2.out') t = 1 - (1 - t) * (1 - t);
      else if (ease === 'power2.inOut') t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      else if (ease === 'power3.out') t = 1 - Math.pow(1 - t, 3);
      else if (ease === 'back.out(1.25)') { const c = 1.70158 * 1.25; t = 1 + c * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
      for (const k in from) target[k] = from[k] + (vars[k] - from[k]) * t;
      this.dirty = true;
      if (elapsed < dur) requestAnimationFrame(tick);
    };
    tick();
    return { then: (cb) => setTimeout(cb, dur + delay) };
  }

  applyAutoRotate(now) { this.controls.autoRotate = this.autoRotateWanted && !this.selectedId && now >= this.interactionUntil; }

  onVisibilityChange = () => {
    this.isPageVisible = !document.hidden;
    if (this.isPageVisible) { this.clock.start(); this.dirty = true; }
  };

  resize() {
    this.width = Math.max(this.container.clientWidth, 1);
    this.height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.hotspots.setPixelSize(DOT_PIXELS, this.height, CAMERA_FOV);
    this.dirty = true;
  }

  onControlStart = () => { this.interactionUntil = performance.now() + 3000; this.dirty = true; };
  onPointerDown = (e) => { this.pointerId = e.pointerId; this.pointerStart = { x: e.clientX, y: e.clientY }; this.dragged = false; };
  onPointerMove = (e) => {
    if (this.pointerId !== null) {
      if (Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y) > 5) this.dragged = true;
      return;
    }
    this.hoverProbe = { x: e.offsetX, y: e.offsetY }; this.dirty = true;
  };
  onPointerUp = (e) => {
    const wasDragging = this.dragged;
    this.pointerId = null; this.dragged = false;
    if (wasDragging) return;
    const marker = this.hotspots.pick(e.offsetX, e.offsetY, this.camera, this.width, this.height);
    this.select(marker && marker.hotspot.id !== this.selectedId ? marker.hotspot.id : null);
  };
  onPointerLeave = () => {
    this.pointerId = null; this.hoverProbe = null;
    if (this.hoveredId) { this.hoveredId = null; this.dirty = true; }
  };

  resolveHover() {
    const probe = this.hoverProbe; this.hoverProbe = null; if (!probe) return;
    const marker = this.hotspots.pick(probe.x, probe.y, this.camera, this.width, this.height);
    const id = marker?.hotspot.id ?? null;
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.dirty = true;
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id; this.busy(0.4);
    const marker = this.hotspots.list.find((m) => m.hotspot.id === id);
    this.callbacks.onSelect(marker?.hotspot ?? null);
  }

  clearSelection() { this.select(null); }

  attachCallout(element) { this.calloutEl = element; this.positionCallout(); this.dirty = true; }

  positionCallout() {
    if (!this.calloutEl || !this.selectedId) return;
    const point = this.hotspots.screenPosition(this.selectedId, this.camera, this.width, this.height);
    if (!point) return;
    this.calloutEl.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0)`;
    this.calloutEl.dataset.side = point.x > this.width * 0.6 ? 'left' : 'right';
    this.calloutEl.dataset.behind = point.opacity < 0.3 ? 'true' : 'false';
  }

  onKeyDown = (e) => {
    const pivot = this.organ?.pivot;
    if (e.key === 'ArrowLeft' && pivot) pivot.rotation.y -= 0.08;
    if (e.key === 'ArrowRight' && pivot) pivot.rotation.y += 0.08;
    if (e.key === '+' || e.key === '=') this.camera.position.z = Math.max(4.8, this.camera.position.z - 0.35);
    if (e.key === '-' || e.key === '_') this.camera.position.z = Math.min(12, this.camera.position.z + 0.35);
    if (e.key === 'Escape') this.select(null);
    this.dirty = true;
  };

  setAutoRotate(enabled) { this.autoRotateWanted = enabled; if (enabled) this.interactionUntil = 0; this.dirty = true; }

  reset() {
    this.select(null);
    this.tween(this.camera.position, { ...HOME_CAMERA, duration: 0.8, ease: 'power3.out' });
    this.tween(this.controls.target, { ...HOME_TARGET, duration: 0.8, ease: 'power3.out' });
    if (this.organ) this.tween(this.organ.pivot.rotation, { x: 0.05, y: -0.28, z: 0, duration: 0.8, ease: 'power3.out' });
  }

  zoom(direction) {
    this.tween(this.camera.position, { z: THREE.MathUtils.clamp(this.camera.position.z + direction * 1.2, 4.8, 12), duration: 0.5, ease: 'power2.out' });
  }

  toggleIsolate() {
    this.isolated = !this.isolated;
    const plinth = this.plinth.material;
    plinth.transparent = true;
    this.tween(plinth, { opacity: this.isolated ? 0.15 : 1, duration: 0.45 });
    this.tween(this.contactShadow.material, { opacity: this.isolated ? 0.08 : 0.55, duration: 0.45 });
    return this.isolated;
  }

  toggleCrossSection() {
    this.crossSection = !this.crossSection;
    this.applyClipping(this.crossSection);
    const from = this.clipPlane.constant, to = this.crossSection ? 0 : -1.8;
    const start = performance.now(), dur = 850;
    const tick = () => {
      const t = Math.min((performance.now() - start) / dur, 1);
      this.clipPlane.constant = from + (to - from) * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      this.dirty = true;
      if (t < 1) requestAnimationFrame(tick);
    };
    tick(); this.busy(0.95);
    return this.crossSection;
  }

  applyClipping(enabled) {
    if (!this.organ) return;
    const planes = enabled ? [this.clipPlane] : null;
    [...this.materials(this.organ), this.depthMaterial].forEach((m) => { m.clippingPlanes = planes; m.needsUpdate = true; });
    this.dirty = true;
  }

  toggleLayers() {
    if (!this.organ) return false;
    let enabled = false;
    this.materials(this.organ).forEach((m) => {
      if (m instanceof THREE.MeshStandardMaterial) { m.wireframe = !m.wireframe; enabled = m.wireframe; }
    });
    this.dirty = true; return enabled;
  }

  dispose() {
    this.disposed = true; this.loadRequest++;
    cancelAnimationFrame(this.frame);
    this.controls.removeEventListener('start', this.onControlStart);
    this.controls.dispose();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('keydown', this.onKeyDown);
    this.hotspots.dispose();
    this.depthMaterial.dispose();
    this.assets.dispose();
    this.scene.environment?.dispose();
    this.contactShadow.material.map?.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}