import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { RotateCcw } from "lucide-react";
import { useSettings } from "@/lib/SettingsContext";

function generatePointCloud(type = "random", count = 50000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    let x, y, z;

    if (type === "sphere") {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1 + (Math.random() - 0.5) * 0.4;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta);
      z = r * Math.cos(phi);
    } else if (type === "bunny") {
      const t = Math.random() * Math.PI * 2;
      const layer = (Math.random() - 0.5) * 2;
      x = (Math.cos(t) * (1 + 0.5 * Math.cos(3 * t))) * 0.8 + (Math.random() - 0.5) * 0.15;
      y = layer + (Math.random() - 0.5) * 0.1;
      z = (Math.sin(t) * (1 + 0.5 * Math.cos(3 * t))) * 0.8 + (Math.random() - 0.5) * 0.15;
    } else {
      x = (Math.random() - 0.5) * 3;
      y = (Math.random() - 0.5) * 3;
      z = (Math.random() - 0.5) * 3;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Color by height (y) with cyan→lime gradient
    const t = (y + 1.5) / 3;
    const clamped = Math.max(0, Math.min(1, t));
    colors[i * 3] = clamped * 0.2;                     // R
    colors[i * 3 + 1] = 0.4 + clamped * 0.6;          // G
    colors[i * 3 + 2] = 1 - clamped * 0.6;            // B
  }
  return { positions, colors };
}

export default function PointCloudViewer({ cloudType = "sphere", pointCount = 50000 }) {
  const { settings } = useSettings();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const pointsRef = useRef(null);
  const gridRef = useRef(null);
  const axesRef = useRef(null);
  const frameRef = useRef(null);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef({ x: 0.3, y: 0 });
  const zoomRef = useRef(3.5);
  const autoRotateRef = useRef(settings.autoRotate);
  autoRotateRef.current = settings.autoRotate;

  const initScene = useCallback(() => {
    const container = mountRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050810);
    sceneRef.current = scene;

    const grid = new THREE.GridHelper(6, 20, 0x0a1628, 0x0a1628);
    grid.position.y = -1.5;
    grid.visible = !!settings.showGrid;
    gridRef.current = grid;
    scene.add(grid);

    const axes = new THREE.AxesHelper(1.5);
    axes.position.y = -1.5;
    axes.visible = !!settings.showAxes;
    axesRef.current = axes;
    scene.add(axes);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 100);
    camera.position.set(0, 0, zoomRef.current);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Point cloud
    const geometry = new THREE.BufferGeometry();
    const { positions, colors } = generatePointCloud(cloudType, pointCount);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: settings.highDensity ? 0.011 : 0.018,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (!isDraggingRef.current && autoRotateRef.current) {
        rotationRef.current.y += 0.003;
      }
      points.rotation.x = rotationRef.current.x;
      points.rotation.y = rotationRef.current.y;
      camera.position.z = zoomRef.current;
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [cloudType, pointCount]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = !!settings.showGrid;
    if (axesRef.current) axesRef.current.visible = !!settings.showAxes;
    if (pointsRef.current?.material) pointsRef.current.material.size = settings.highDensity ? 0.011 : 0.018;
  }, [settings.showGrid, settings.showAxes, settings.highDensity]);

  useEffect(() => {
    const cleanup = initScene();
    return () => {
      if (cleanup) cleanup();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        const el = rendererRef.current.domElement;
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }
    };
  }, [initScene]);

  // Rebuild point cloud when cloudType changes
  useEffect(() => {
    if (!sceneRef.current || !pointsRef.current) return;
    const { positions, colors } = generatePointCloud(cloudType, pointCount);
    const geo = pointsRef.current.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    rotationRef.current = { x: 0.3, y: 0 };
  }, [cloudType, pointCount]);

  const onMouseDown = (e) => {
    isDraggingRef.current = true;
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - prevMouseRef.current.x;
    const dy = e.clientY - prevMouseRef.current.y;
    rotationRef.current.y += dx * 0.008;
    rotationRef.current.x += dy * 0.008;
    prevMouseRef.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseUp = () => { isDraggingRef.current = false; };
  const onWheel = (e) => {
    zoomRef.current = Math.max(1.5, Math.min(8, zoomRef.current + e.deltaY * 0.005));
  };
  const resetView = () => {
    rotationRef.current = { x: 0.3, y: 0 };
    zoomRef.current = 3.5;
  };

  return (
    <div className="relative w-full h-full bg-[#050810] rounded-lg overflow-hidden border border-border">
      {/* Canvas mount */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      />

      {/* HUD overlay */}
      <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
        <div className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" />
        <span className="text-[10px] font-mono text-cyan/80 uppercase tracking-widest">3D Viewport · WebGL</span>
      </div>

      <div className="absolute top-3 right-3 flex gap-1.5">
        <button
          onClick={resetView}
          title="Reset view"
          className="w-7 h-7 rounded-md bg-card/80 border border-border backdrop-blur flex items-center justify-center hover:border-primary/40 hover:text-cyan transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      <div className="absolute bottom-3 left-3 pointer-events-none">
        <span className="text-[10px] font-mono text-muted-foreground">DRAG to rotate · SCROLL to zoom</span>
      </div>

      <div className="absolute bottom-3 right-3 bg-card/70 backdrop-blur border border-border rounded-md px-2 py-1 pointer-events-none">
        <span className="text-[10px] font-mono text-muted-foreground">{pointCount.toLocaleString()} pts</span>
      </div>
    </div>
  );
}