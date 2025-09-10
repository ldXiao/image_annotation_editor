import React, { useCallback, useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

interface PolygonState {
  points: Point[];
  closed: boolean;
}

// Extra margin around the image to allow drawing polygons extending beyond edges
const EXTRA_MARGIN = 1000; // in world units (image pixel space)

const ImageAnnotationEditor: React.FC = () => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [polygon, setPolygon] = useState<PolygonState>({ points: [], closed: false });
  const [scale, setScale] = useState(1);
  const [mode, setMode] = useState<'move' | 'polygon'>('polygon');
  const [panningState, setPanningState] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // screen-space translation (px)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [userInteracted, setUserInteracted] = useState(false); // track manual zoom/pan changes

  // Load image dimensions when URL changes
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      setImageDims({ width: img.width, height: img.height });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const onSelectFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImageUrl(reader.result as string);
    reader.readAsDataURL(file);
    // Reset polygon when new image selected
    setPolygon({ points: [], closed: false });
    setScale(1);
  setUserInteracted(false);
  }, []);

  const addPoint = useCallback((pt: Point) => {
    setPolygon(p => ({ ...p, points: [...p.points, pt] }));
  }, []);

  const closePolygon = useCallback(() => {
    setPolygon(p => (p.points.length > 2 ? { ...p, closed: true } : p));
  }, []);

  const undoPoint = useCallback(() => {
    setPolygon(p => ({ ...p, points: p.points.slice(0, -1) }));
  }, []);

  const resetPolygon = useCallback(() => {
    setPolygon({ points: [], closed: false });
  }, []);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      closePolygon();
    } else if (e.key === 'Escape') {
      resetPolygon();
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      undoPoint();
    } else if (e.key.toLowerCase() === 'm') {
      setMode('move');
    } else if (e.key.toLowerCase() === 'p') {
      setMode('polygon');
    }
  }, [closePolygon, resetPolygon, undoPoint]);

  // Determine drawing extents for exporting (allow polygon to extend beyond image)
  const getExtents = () => {
    const pts = polygon.points;
    let maxX = imageDims?.width || 0;
    let maxY = imageDims?.height || 0;
    for (const p of pts) {
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
  };

  const exportSvg = useCallback(() => {
    if (!imageDims || !imageUrl || polygon.points.length === 0) return;
    const { width: extW, height: extH } = getExtents();
    const pointsAttr = polygon.points.map(p => `${p.x},${p.y}`).join(' ');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${extW}" height="${extH}" viewBox="0 0 ${extW} ${extH}">` +
      `<image href="${imageUrl}" x="0" y="0" width="${imageDims.width}" height="${imageDims.height}" />` +
      `<polygon points="${pointsAttr}" fill="rgba(255,0,0,0.3)" stroke="red" stroke-width="2" />` +
      `</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (imageFile?.name?.replace(/\.[^.]+$/, '') || 'annotation') + '.svg';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [imageDims, imageUrl, polygon.points, imageFile, getExtents]);

  const pointsPreview = polygon.points.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');

  const getWrapperSize = useCallback(() => {
    const el = wrapperRef.current;
    return { width: el?.clientWidth || 0, height: el?.clientHeight || 0 };
  }, []);

  const clampOffset = useCallback((ox: number, oy: number) => {
    if (!imageDims) return { x: ox, y: oy };
    const { width: ww, height: wh } = getWrapperSize();
    const scaledW = imageDims.width * scale;
    const scaledH = imageDims.height * scale;
    let x: number; let y: number;
    // If image smaller than viewport dimension, allow free panning (no centering) in that axis.
    if (ww >= scaledW) {
      x = ox; // no clamp horizontally
    } else {
      const minX = ww - scaledW; // negative
      x = Math.min(0, Math.max(minX, ox));
    }
    if (wh >= scaledH) {
      y = oy; // no clamp vertically
    } else {
      const minY = wh - scaledH; // negative
      y = Math.min(0, Math.max(minY, oy));
    }
    return { x, y };
  }, [imageDims, scale, getWrapperSize]);

  // Recenter/clamp on load & when scale changes
  useEffect(() => {
    if (!imageDims) return;
    setOffset(o => clampOffset(o.x, o.y));
  }, [imageDims, scale, clampOffset]);

  // Fit image into viewport (keeping aspect ratio) so it's fully visible
  const fitImage = useCallback(() => {
    if (!imageDims || !wrapperRef.current) return;
    const ww = wrapperRef.current.clientWidth;
    const wh = wrapperRef.current.clientHeight;
    if (!ww || !wh) return;
    const scaleFit = Math.min(ww / imageDims.width, wh / imageDims.height, 1); // don't upscale above 1
    setScale(scaleFit);
    const centeredX = (ww - imageDims.width * scaleFit) / 2;
    const centeredY = (wh - imageDims.height * scaleFit) / 2;
    setOffset({ x: centeredX, y: centeredY });
  }, [imageDims]);

  // Auto-fit on image load if user hasn't interacted yet
  useEffect(() => {
    if (!imageDims || userInteracted) return;
    // Wait a frame to ensure wrapper has layout
    const id = requestAnimationFrame(() => fitImage());
    return () => cancelAnimationFrame(id);
  }, [imageDims, userInteracted, fitImage]);

  // Refit on window resize if user hasn't interacted
  useEffect(() => {
    const onResize = () => {
      if (!userInteracted) fitImage();
      else setOffset(o => clampOffset(o.x, o.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [userInteracted, fitImage, clampOffset]);

  // Window resize handler to re-clamp
  useEffect(() => {
    const onResize = () => {
      setOffset(o => clampOffset(o.x, o.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampOffset]);

  // Wheel zoom (cursor-centered)
  const lastCursor = useRef<{ sx: number; sy: number } | null>(null);

  // Core zoom function: mult is multiplier; if absoluteTarget provided, use that scale directly.
  const applyZoomAtScreenPoint = useCallback((mult: number, sx: number, sy: number, absoluteTarget?: number) => {
    setUserInteracted(true);
    setScale(prev => {
      const target = absoluteTarget !== undefined ? absoluteTarget : prev * mult;
      const newScale = Math.min(10, Math.max(0.1, target));
      // Convert screen point to world coords before zoom
      const worldX = (sx - offset.x) / prev;
      const worldY = (sy - offset.y) / prev;
      // After scaling, reposition so same world point aligns under cursor
      const newOffsetX = sx - worldX * newScale;
      const newOffsetY = sy - worldY * newScale;
      setOffset(clampOffset(newOffsetX, newOffsetY));
      return newScale;
    });
  }, [offset.x, offset.y, clampOffset]);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    e.preventDefault();
    const delta = e.deltaY;
    const factor = delta > 0 ? 0.9 : 1.1;
  setUserInteracted(true);
    const rect = svgRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastCursor.current = { sx, sy };
    applyZoomAtScreenPoint(factor, sx, sy);
  }, [applyZoomAtScreenPoint]);

  // Simple zoom in/out buttons
  const zoomBy = useCallback((mult: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = lastCursor.current ? lastCursor.current.sx : rect.width / 2;
    const cy = lastCursor.current ? lastCursor.current.sy : rect.height / 2;
    applyZoomAtScreenPoint(mult, cx, cy);
  }, [applyZoomAtScreenPoint]);

  // Unified left-drag panning with click-to-add when no drag threshold crossed
  const isPanning = useRef(false);
  const dragState = useRef({ maybePoint: false, startX: 0, startY: 0 });
  const lastPos = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 4; // pixels

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    lastCursor.current = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    const leftButton = e.button === 0;
    if (mode === 'polygon' && leftButton && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      // potential point add (click vs drag)
      dragState.current = { maybePoint: true, startX: e.clientX, startY: e.clientY };
      isPanning.current = false;
    } else if (leftButton || e.button === 1 || e.button === 2) {
      // pan
      isPanning.current = true;
      dragState.current.maybePoint = false;
      setUserInteracted(true);
      setPanningState(true);
    }
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, [mode]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    lastCursor.current = { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    if (dragState.current.maybePoint && !isPanning.current) {
      const dxTest = e.clientX - dragState.current.startX;
      const dyTest = e.clientY - dragState.current.startY;
      if (Math.hypot(dxTest, dyTest) > DRAG_THRESHOLD) {
        isPanning.current = true; // switch to panning
        setUserInteracted(true);
      }
    }
  if (isPanning.current) {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setOffset(o => clampOffset(o.x + dx, o.y + dy));
    }
  }, [clampOffset]);

  const handleMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    if (mode === 'polygon' && dragState.current.maybePoint && !isPanning.current && !polygon.closed) {
      // treat as click to add point
      const rect = svgRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const x = (sx - offset.x) / scale;
      const y = (sy - offset.y) / scale;
      addPoint({ x, y });
    }
    dragState.current.maybePoint = false;
    isPanning.current = false;
    setPanningState(false);
  }, [polygon.closed, offset.x, offset.y, scale, addPoint, mode]);

  const handleMouseLeave = useCallback(() => {
    dragState.current.maybePoint = false;
    isPanning.current = false;
    setPanningState(false);
  }, []);

  return (
    <div className="annotation-root" onKeyDown={handleKey} tabIndex={0}>
      <div className="toolbar">
        <input type="file" accept="image/*" onChange={onSelectFile} />
        <div style={{ display: 'flex', gap: '0.25rem', marginRight: '0.5rem' }}>
          <button
            type="button"
            className={`icon-btn ${mode==='move'? 'active' : ''}`}
            onClick={() => setMode('move')}
            title="Move / Pan (M)"
            aria-label="Move / Pan"
          >
            {/* Hand / move icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11V5a2 2 0 0 1 4 0v6" />
              <path d="M13 11V4a2 2 0 1 1 4 0v7" />
              <path d="M9 11a2 2 0 1 0-4 0v2a8 8 0 0 0 8 8h1a7 7 0 0 0 7-7v-1a2 2 0 0 0-4 0" />
            </svg>
          </button>
          <button
            type="button"
            className={`icon-btn ${mode==='polygon'? 'active' : ''}`}
            onClick={() => setMode('polygon')}
            title="Polygon (P)"
            aria-label="Polygon"
          >
            {/* Polygon icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 3 19 7 21 17 9 21 3 11" />
              <circle cx="5" cy="3" r="2" fill="currentColor" />
              <circle cx="19" cy="7" r="2" fill="currentColor" />
              <circle cx="21" cy="17" r="2" fill="currentColor" />
              <circle cx="9" cy="21" r="2" fill="currentColor" />
              <circle cx="3" cy="11" r="2" fill="currentColor" />
            </svg>
          </button>
        </div>
        <label>Scale: {scale.toFixed(2)}</label>
        <input
          type="range"
          min={0.1}
          max={5}
          step={0.1}
          value={scale}
          onChange={e => {
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const anchorX = lastCursor.current ? lastCursor.current.sx : rect.width / 2;
            const anchorY = lastCursor.current ? lastCursor.current.sy : rect.height / 2;
            const targetScale = Number(e.target.value);
            // Determine multiplier relative to current scale
            const mult = targetScale / scale;
            applyZoomAtScreenPoint(mult, anchorX, anchorY, targetScale);
          }}
        />
        <button onClick={() => zoomBy(1/1.2)}>−</button>
        <button onClick={() => zoomBy(1.2)}>+</button>
        <button onClick={() => { setUserInteracted(false); fitImage(); }}>Fit</button>
  <button disabled={mode!=='polygon' || polygon.points.length < 3 || polygon.closed} onClick={closePolygon}>Close Polygon</button>
  <button disabled={mode!=='polygon' || polygon.points.length === 0} onClick={undoPoint}>Undo</button>
  <button disabled={mode!=='polygon' || polygon.points.length === 0} onClick={resetPolygon}>Reset</button>
  <button disabled={polygon.points.length === 0} onClick={exportSvg}>Save SVG</button>
      </div>
      <div className="canvas-wrapper" ref={wrapperRef}>
        <svg
          ref={svgRef}
          className="annotation-svg"
          // click handled via mouseup logic to allow drag threshold discrimination
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: mode === 'move' ? (panningState ? 'grabbing' : 'grab') : (polygon.closed ? 'default' : 'crosshair'), width: '100%', height: '100%' }}
        >
          {/* A background rect to allow clicking beyond image (with extra margin) */}
          {imageDims && (
            <g transform={`translate(${offset.x},${offset.y}) scale(${scale})`}>
              <rect
                x={-EXTRA_MARGIN}
                y={-EXTRA_MARGIN}
                width={imageDims.width + EXTRA_MARGIN * 2}
                height={imageDims.height + EXTRA_MARGIN * 2}
                fill="transparent"
                stroke="none"
              />
              {imageUrl && (
                <image
                  href={imageUrl}
                  x={0}
                  y={0}
                  width={imageDims.width}
                  height={imageDims.height}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                />
              )}
              {polygon.points.length > 0 && (
                <>
                  <polyline
                    points={polygon.points.map(p => `${p.x},${p.y}`).join(' ')}
                    fill={polygon.closed ? 'rgba(255,0,0,0.3)' : 'none'}
                    stroke="red"
                    strokeWidth={2 / scale}
                  />
                  {!polygon.closed && polygon.points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4 / scale} fill="red" />
                  ))}
                  {polygon.closed && (
                    <polygon
                      points={polygon.points.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="rgba(255,0,0,0.3)"
                      stroke="red"
                      strokeWidth={2 / scale}
                    />
                  )}
                </>
              )}
            </g>
          )}
        </svg>
      </div>
      <div className="info-panel">
        <p><strong>Instructions:</strong> Select an image, click to add points, Enter or Close Polygon to finish. Ctrl+Z to undo, Esc to reset. You can zoom with the range slider. Polygon points may extend beyond the image.</p>
        <p>Points: {pointsPreview}</p>
      </div>
    </div>
  );
};

export default ImageAnnotationEditor;
