// === Floor Plan Editor ===
(function () {
  'use strict';

  const canvas = document.getElementById('floor-canvas');
  const ctx = canvas.getContext('2d');
  const contextMenu = document.getElementById('context-menu');

  // State
  let items = [];
  let rooms = [];
  let selectedItem = null;
  let selectedRoom = null;
  let draggingItem = null;
  let dragOffset = { x: 0, y: 0 };
  let gridSize = 20;
  let showGrid = true;
  let snapToGrid = true;

  // View transform (pan & zoom)
  let viewScale = 1;
  let viewOffsetX = 0;
  let viewOffsetY = 0;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let spaceHeld = false;

  // Room drawing state
  let drawMode = false;
  let isTracing = false;
  let currentRoomPoints = [];
  let mousePos = { x: 0, y: 0 };

  // Rectangle room drawing state
  let rectMode = false;
  let rectStart = null;
  let rectEnd = null;
  let isRectDragging = false;

  // Room editing state
  let draggingRoom = null;
  let roomDragOffset = { x: 0, y: 0 };
  let draggingLabel = null; // room whose label is being dragged
  let draggingItemLabel = null; // item whose label is being dragged
  let draggingRailNumber = null; // rail item whose number is being dragged
  let resizingRoom = null;
  let resizeHandle = null; // 'tl','tr','bl','br','t','b','l','r'
  let resizeStartBounds = null;
  let resizeStartMouse = null;

  // Item resize state
  let resizingItem = null;
  let itemResizeHandle = null; // 'l','r','t','b'
  let itemResizeStart = null; // { x, y, w, h, mx, my }

  // Free rotation state
  let rotatingItem = null;
  let rotateStartAngle = 0;

  // Stamp mode (click to place)
  let stampMode = false;
  let stampType = null;
  let stampDragging = false;
  let stampStart = null;
  let stampEnd = null;

  // Line drawing mode
  let lineMode = false;
  let lineStart = null;
  let lineEnd = null;
  let isLineDragging = false;

  // Edge toggle mode (hide/show room edges)
  let edgeToggleMode = false;

  // Undo/Redo history
  let undoStack = [];
  let redoStack = [];
  const MAX_HISTORY = 50;

  function saveState() {
    const state = JSON.stringify({ items, rooms });
    // Don't save if nothing changed
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === state) return;
    undoStack.push(state);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }

  function undo() {
    if (undoStack.length === 0) return;
    const currentState = JSON.stringify({ items, rooms });
    redoStack.push(currentState);
    const prev = undoStack.pop();
    const data = JSON.parse(prev);
    items = data.items || [];
    rooms = data.rooms || [];
    selectedItem = null;
    selectedRoom = null;
    draw();
    updateUndoButtons();
    updateStatus('元に戻しました');
  }

  function redo() {
    if (redoStack.length === 0) return;
    const currentState = JSON.stringify({ items, rooms });
    undoStack.push(currentState);
    const next = redoStack.pop();
    const data = JSON.parse(next);
    items = data.items || [];
    rooms = data.rooms || [];
    selectedItem = null;
    selectedRoom = null;
    draw();
    updateUndoButtons();
    updateStatus('やり直しました');
  }

  function updateUndoButtons() {
    document.getElementById('btn-undo').disabled = undoStack.length === 0;
    document.getElementById('btn-redo').disabled = redoStack.length === 0;
  }

  // === Auto-backup before PDF export ===
  function autoBackupBeforePDF() {
    try {
      const now = new Date();
      const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
      const backupData = JSON.stringify({ gridSize, items, rooms, backupTime: now.toISOString() });
      
      // Save to LocalStorage with rotating backup (keep last 5)
      const backupKey = `floorplan_backup_${timestamp}`;
      localStorage.setItem(backupKey, backupData);
      
      // Keep only last 5 backups
      const allKeys = Object.keys(localStorage).filter(k => k.startsWith('floorplan_backup_'));
      if (allKeys.length > 5) {
        allKeys.sort();
        const toRemove = allKeys.slice(0, allKeys.length - 5);
        toRemove.forEach(k => localStorage.removeItem(k));
      }
      
      console.log(`[自動バックアップ] ${backupKey} に保存しました`);
    } catch (e) {
      console.warn('自動バックアップに失敗しました:', e);
    }
  }

  // Room colors
  const ROOM_COLORS = [
    'rgba(173, 216, 230, 0.3)',
    'rgba(144, 238, 144, 0.3)',
    'rgba(255, 228, 181, 0.3)',
    'rgba(221, 160, 221, 0.3)',
    'rgba(255, 255, 200, 0.3)',
    'rgba(255, 200, 200, 0.3)',
  ];
  let roomColorIndex = 0;

  // Item definitions
  const ITEM_DEFS = {
    wall:    { w: 5, h: 0.5, color: '#333',    label: '壁' },
    door:    { w: 2, h: 0.5, color: '#8B4513', label: 'ドア' },
    'door-swing':   { w: 2, h: 2,   color: '#DEB887', label: '開き戸' },
    'door-swing-r': { w: 2, h: 2,   color: '#DEB887', label: '開き戸(右)' },
    'door-slide':   { w: 3, h: 0.5, color: '#C4A882', label: '引き戸' },
    'door-slide2':  { w: 3, h: 0.5, color: '#C4A882', label: '引違い戸' },
    'door-double':  { w: 3, h: 2,   color: '#D2A679', label: '両開き戸' },
    'door-fold':    { w: 2, h: 0.5, color: '#BFA070', label: '折れ戸' },
    'door-pocket':  { w: 2, h: 0.5, color: '#B8A070', label: '引込み戸' },
    'door-accordion': { w: 3, h: 0.5, color: '#A08060', label: 'アコーディオン' },
    'door-open':    { w: 2, h: 0.3, color: '#999',    label: '開口' },
    window:  { w: 2, h: 0.3, color: '#87CEEB', label: '窓' },
    stairs:  { w: 2, h: 4,   color: '#D2B48C', label: '直階段' },
    'stairs-l':       { w: 3, h: 3,   color: '#D2B48C', label: 'L字階段' },
    'stairs-u':       { w: 3, h: 5,   color: '#D2B48C', label: 'U字階段' },
    'stairs-kaneore': { w: 3, h: 3,   color: '#D2B48C', label: 'かね折れ階段' },
    'stairs-spiral':  { w: 3, h: 3,   color: '#D2B48C', label: 'らせん階段' },
    'stairs-circular':{ w: 3, h: 3,   color: '#D2B48C', label: '円形階段' },
    'stairs-curve':   { w: 3, h: 4,   color: '#D2B48C', label: '曲線階段' },
    'stairs-mawari':  { w: 3, h: 3,   color: '#D2B48C', label: '回り階段' },
    'step-up':        { w: 3, h: 0.5, color: '#888',    label: '段差' },
    'bath-step':      { w: 3, h: 1,   color: '#888',    label: '浴槽段差' },
    'rail-h':         { w: 4, h: 0.3, color: '#e94560', label: '横手すり' },
    'rail-v':         { w: 0.3, h: 3, color: '#e94560', label: '縦手すり' },
    'rail-l':         { w: 2, h: 2,   color: '#e94560', label: 'L字手すり' },
    sofa:    { w: 4, h: 2,   color: '#6B8E23', label: 'ソファ' },
    bed:     { w: 2.5, h: 5,   color: '#DEB887', label: 'ベッド' },
    table:   { w: 3, h: 2,   color: '#CD853F', label: 'テーブル' },
    chair:   { w: 1.5, h: 1.5, color: '#A0522D', label: 'イス' },
    desk:    { w: 3, h: 1.5, color: '#8B7355', label: 'デスク' },
    toilet:  { w: 1.5, h: 2, color: '#F5F5F5', label: '洋式トイレ' },
    'toilet-jp': { w: 1.5, h: 3, color: '#F5F5F5', label: '和式トイレ' },
    'toilet-kisha': { w: 1.5, h: 3, color: '#F5F5F5', label: '汽車便器' },
    bath:    { w: 3, h: 4,   color: '#B0E0E6', label: '浴槽' },
    sink:    { w: 1.5, h: 1, color: '#E0E0E0', label: '洗面台' },
    kitchen: { w: 5, h: 1.5, color: '#C0C0C0', label: 'キッチン' },
  };

  // === Canvas Resize ===
  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    draw();
  }
  window.addEventListener('resize', resizeCanvas);

  // === Custom Scrollbars ===
  const scrollbarV = document.getElementById('scrollbar-v');
  const scrollbarVThumb = document.getElementById('scrollbar-v-thumb');
  const scrollbarH = document.getElementById('scrollbar-h');
  const scrollbarHThumb = document.getElementById('scrollbar-h-thumb');

  // Virtual world bounds (defines how far you can scroll)
  const WORLD_SIZE = 5000; // total world span in each direction

  function updateScrollbars() {
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    // Visible area in world coordinates
    const visibleW = canvasW / viewScale;
    const visibleH = canvasH / viewScale;
    const worldW = WORLD_SIZE;
    const worldH = WORLD_SIZE;

    // Horizontal scrollbar
    const trackW = scrollbarH.clientWidth;
    const thumbW = Math.max(30, (visibleW / worldW) * trackW);
    // viewOffsetX=0 means world origin at left edge, negative means scrolled right
    const scrollFractionX = (-viewOffsetX / viewScale + WORLD_SIZE / 2) / worldW;
    const thumbX = Math.max(0, Math.min(trackW - thumbW, scrollFractionX * trackW - thumbW / 2));
    scrollbarHThumb.style.width = thumbW + 'px';
    scrollbarHThumb.style.left = thumbX + 'px';

    // Vertical scrollbar
    const trackH = scrollbarV.clientHeight;
    const thumbH = Math.max(30, (visibleH / worldH) * trackH);
    const scrollFractionY = (-viewOffsetY / viewScale + WORLD_SIZE / 2) / worldH;
    const thumbY = Math.max(0, Math.min(trackH - thumbH, scrollFractionY * trackH - thumbH / 2));
    scrollbarVThumb.style.height = thumbH + 'px';
    scrollbarVThumb.style.top = thumbY + 'px';
  }

  // Drag vertical scrollbar
  (function() {
    let dragging = false;
    let startY = 0;
    let startOffset = 0;

    scrollbarVThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      startOffset = viewOffsetY;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const trackH = scrollbarV.clientHeight;
      const dy = e.clientY - startY;
      // Convert pixel movement on track to world movement
      const worldMove = (dy / trackH) * WORLD_SIZE * viewScale;
      viewOffsetY = startOffset - worldMove;
      draw();
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = '';
      }
    });
  })();

  // Drag horizontal scrollbar
  (function() {
    let dragging = false;
    let startX = 0;
    let startOffset = 0;

    scrollbarHThumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startX = e.clientX;
      startOffset = viewOffsetX;
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const trackW = scrollbarH.clientWidth;
      const dx = e.clientX - startX;
      const worldMove = (dx / trackW) * WORLD_SIZE * viewScale;
      viewOffsetX = startOffset - worldMove;
      draw();
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.userSelect = '';
      }
    });
  })();

  // === Snap helper ===
  function snap(value) {
    if (!snapToGrid) return value;
    // Snap to half-grid for finer placement (allows placing items on wall lines)
    const halfGrid = gridSize / 2;
    return Math.round(value / halfGrid) * halfGrid;
  }

  // === View transform helpers ===
  // Convert screen (pixel) coords to world coords
  function screenToWorld(sx, sy) {
    return {
      x: (sx - viewOffsetX) / viewScale,
      y: (sy - viewOffsetY) / viewScale
    };
  }

  // === Room bounding box helpers ===
  function getRoomBounds(room) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of room.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function getRoomCenter(room) {
    const b = getRoomBounds(room);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  // Get resize handle at position for selected room
  function getHandleAt(room, mx, my) {
    const b = getRoomBounds(room);
    const hs = 7; // handle size
    const handles = [
      { id: 'tl', x: b.x, y: b.y },
      { id: 'tr', x: b.x + b.w, y: b.y },
      { id: 'bl', x: b.x, y: b.y + b.h },
      { id: 'br', x: b.x + b.w, y: b.y + b.h },
      { id: 't', x: b.x + b.w / 2, y: b.y },
      { id: 'b', x: b.x + b.w / 2, y: b.y + b.h },
      { id: 'l', x: b.x, y: b.y + b.h / 2 },
      { id: 'r', x: b.x + b.w, y: b.y + b.h / 2 },
    ];
    for (const h of handles) {
      if (Math.abs(mx - h.x) <= hs && Math.abs(my - h.y) <= hs) return h.id;
    }
    return null;
  }

  function getCursorForHandle(handle) {
    const cursors = {
      tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize',
      t: 'n-resize', b: 's-resize', l: 'w-resize', r: 'e-resize',
    };
    return cursors[handle] || 'default';
  }

  // Resize a room by scaling its points relative to its bounding box
  function resizeRoomTo(room, newBounds, origBounds, origPoints) {
    for (let i = 0; i < room.points.length; i++) {
      const op = origPoints[i];
      // Normalize point within original bounds (0-1)
      const nx = origBounds.w > 0 ? (op.x - origBounds.x) / origBounds.w : 0;
      const ny = origBounds.h > 0 ? (op.y - origBounds.y) / origBounds.h : 0;
      // Map to new bounds
      room.points[i] = {
        x: snap(newBounds.x + nx * newBounds.w),
        y: snap(newBounds.y + ny * newBounds.h),
      };
    }
  }

  // Move all room points by dx, dy
  function moveRoom(room, dx, dy) {
    for (const p of room.points) {
      p.x += dx;
      p.y += dy;
    }
  }

  // === Drawing ===
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f9f9f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background image (下絵) if loaded and visible (not during PDF export)
    if (bgImage && bgVisible && !canvas._pdfExporting) {
      ctx.save();
      ctx.globalAlpha = bgOpacity;
      // Fit image to canvas while maintaining aspect ratio
      const useRotated = (bgRotation === 90 || bgRotation === 270);
      const imgW = useRotated ? bgImage.height : bgImage.width;
      const imgH = useRotated ? bgImage.width : bgImage.height;
      const imgAspect = imgW / imgH;
      const canvasAspect = canvas.width / canvas.height;
      let drawW, drawH, drawX, drawY;
      if (imgAspect > canvasAspect) {
        drawW = canvas.width;
        drawH = canvas.width / imgAspect;
        drawX = 0;
        drawY = (canvas.height - drawH) / 2;
      } else {
        drawH = canvas.height;
        drawW = canvas.height * imgAspect;
        drawX = (canvas.width - drawW) / 2;
        drawY = 0;
      }
      // Rotate around center
      ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
      ctx.rotate(bgRotation * Math.PI / 180);
      if (useRotated) {
        ctx.drawImage(bgImage, -drawH / 2, -drawW / 2, drawH, drawW);
      } else {
        ctx.drawImage(bgImage, -drawW / 2, -drawH / 2, drawW, drawH);
      }
      ctx.restore();
    }

    // Apply view transform (pan & zoom)
    ctx.save();
    ctx.translate(viewOffsetX, viewOffsetY);
    ctx.scale(viewScale, viewScale);

    if (showGrid) drawGrid();

    for (const room of rooms) drawRoom(room);

    if (drawMode && currentRoomPoints.length > 1) drawCurrentRoom();
    if (rectMode && rectStart && rectEnd) drawCurrentRect();
    if (stampMode && stampDragging && stampStart && stampEnd) drawStampPreview();
    if (lineMode && isLineDragging && lineStart && lineEnd) drawLinePreview();

    for (const item of items) drawItem(item);

    ctx.restore(); // End view transform

    // Auto-show/hide context menu based on selection
    updateContextMenuPosition();
    updateEditBtnVisibility();
    updateScrollbars();
    // Sync text size/color selector when a text item is selected
    if (selectedItem && selectedItem.type === 'text') {
      document.getElementById('text-size').value = selectedItem.fontSize || 13;
      document.getElementById('text-color').value = selectedItem.color || '#333333';
    }
  }

  function drawGrid() {
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 0.5 / viewScale;
    // Calculate visible world area
    const startX = Math.floor((-viewOffsetX / viewScale) / gridSize) * gridSize;
    const startY = Math.floor((-viewOffsetY / viewScale) / gridSize) * gridSize;
    const endX = startX + Math.ceil(canvas.width / viewScale / gridSize + 2) * gridSize;
    const endY = startY + Math.ceil(canvas.height / viewScale / gridSize + 2) * gridSize;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY); ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  function drawRoom(room) {
    if (room.points.length < 3) return;
    ctx.save();

    // Fill
    ctx.beginPath();
    ctx.moveTo(room.points[0].x, room.points[0].y);
    for (let i = 1; i < room.points.length; i++) {
      ctx.lineTo(room.points[i].x, room.points[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = room.color;
    ctx.fill();

    // Draw walls segment by segment (supports per-edge visibility)
    const roomColor = room.lineColor || '#333';
    ctx.strokeStyle = room === selectedRoom ? '#4a9eff' : roomColor;
    ctx.lineWidth = room === selectedRoom ? 4 : 3;

    const pts = room.points;
    const hiddenEdges = room.hiddenEdges || [];
    for (let i = 0; i < pts.length; i++) {
      if (hiddenEdges.indexOf(i) !== -1) {
        // Edge is hidden - show dashed hint only when room is selected
        if (room === selectedRoom) {
          ctx.save();
          ctx.strokeStyle = 'rgba(233, 69, 96, 0.3)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        continue;
      }
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Room label
    if (room.label) {
      const center = getRoomCenter(room);
      const lx = center.x + (room.labelOffsetX || 0);
      const ly = center.y + (room.labelOffsetY || 0);
      const fontSize = room.labelFontSize || 13;
      ctx.fillStyle = '#333';
      ctx.font = fontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (room.labelVertical) {
        // 縦書き: 1文字ずつ縦に描画
        const chars = Array.from(room.label);
        const lineHeight = fontSize * 1.2;
        const totalHeight = lineHeight * chars.length;
        const startY = ly - totalHeight / 2 + lineHeight / 2;
        for (let ci = 0; ci < chars.length; ci++) {
          ctx.fillText(chars[ci], lx, startY + ci * lineHeight);
        }
        // Show label drag handle when room is selected
        if (room === selectedRoom) {
          ctx.strokeStyle = '#e94560';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          const boxW = fontSize + 8;
          ctx.strokeRect(lx - boxW / 2, startY - lineHeight / 2, boxW, totalHeight);
          ctx.setLineDash([]);
        }
      } else {
        // 横書き（通常）
        ctx.fillText(room.label, lx, ly);
        // Show label drag handle when room is selected
        if (room === selectedRoom) {
          ctx.strokeStyle = '#e94560';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          const tw = ctx.measureText(room.label).width;
          const boxH = fontSize + 6;
          ctx.strokeRect(lx - tw / 2 - 4, ly - boxH / 2, tw + 8, boxH);
          ctx.setLineDash([]);
        }
      }
    }

    // Hatching (diagonal lines) - shown if room.hatching is true
    if (room.hatching) {
      const b = getRoomBounds(room);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(room.points[0].x, room.points[0].y);
      for (let i = 1; i < room.points.length; i++) {
        ctx.lineTo(room.points[i].x, room.points[i].y);
      }
      ctx.closePath();
      ctx.clip();
      // Use room's line color for hatching (with transparency)
      const hatchColor = room.lineColor || '#333';
      ctx.strokeStyle = hatchColor;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1;
      const spacing = 12;
      const maxLen = b.w + b.h;
      for (let d = -maxLen; d < maxLen; d += spacing) {
        ctx.beginPath();
        ctx.moveTo(b.x + d, b.y);
        ctx.lineTo(b.x + d + b.h, b.y + b.h);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw resize handles when selected
    if (room === selectedRoom) {
      const b = getRoomBounds(room);
      const handles = [
        { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
        { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w / 2, y: b.y + b.h },
        { x: b.x, y: b.y + b.h / 2 }, { x: b.x + b.w, y: b.y + b.h / 2 },
      ];
      for (const h of handles) {
        ctx.fillStyle = '#e94560';
        ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
      }
    }

    ctx.restore();
  }

  // Draw a wall segment from point a to b, cutting out any door overlaps
  function drawWallSegmentWithDoors(a, b, color, lineWidth) {
    // Get all door items
    const doorItems = items.filter(it => it.type && it.type.startsWith('door-'));
    if (doorItems.length === 0) {
      // No doors, just draw the line
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      return;
    }

    // Parametrize the wall segment: point = a + t*(b-a), t in [0,1]
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1) return;

    // Find intervals to cut (door overlaps on this wall segment)
    const cuts = []; // array of [t_start, t_end] to skip
    const tolerance = gridSize * 1.2; // how close a door must be to the wall

    for (const door of doorItems) {
      // Get door's world-space bounding box accounting for rotation
      const doorCx = door.x + door.w / 2;
      const doorCy = door.y + door.h / 2;
      const rot = (door.rotation || 0) * Math.PI / 180;

      // Compute rotated corners
      const hw = door.w / 2, hh = door.h / 2;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const localCorners = [
        { x: -hw, y: -hh }, { x: hw, y: -hh },
        { x: hw, y: hh }, { x: -hw, y: hh },
      ];
      const corners = localCorners.map(c => ({
        x: doorCx + c.x * cosR - c.y * sinR,
        y: doorCy + c.x * sinR + c.y * cosR,
      }));

      // Distance from door center to the wall line
      const wallDist = Math.abs(dy * doorCx - dx * doorCy + b.x * a.y - b.y * a.x) / segLen;

      if (wallDist > tolerance) continue; // door is too far from this wall

      // Project rotated corners onto the wall segment parameter t
      let tMin = Infinity, tMax = -Infinity;
      for (const c of corners) {
        const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / (segLen * segLen);
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }

      // Clamp to [0, 1]
      tMin = Math.max(0, tMin);
      tMax = Math.min(1, tMax);

      if (tMax > tMin) {
        cuts.push([tMin, tMax]);
      }
    }

    if (cuts.length === 0) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      return;
    }

    // Sort cuts and merge overlapping
    cuts.sort((a, b) => a[0] - b[0]);
    const merged = [cuts[0]];
    for (let i = 1; i < cuts.length; i++) {
      const last = merged[merged.length - 1];
      if (cuts[i][0] <= last[1]) {
        last[1] = Math.max(last[1], cuts[i][1]);
      } else {
        merged.push(cuts[i]);
      }
    }

    // Draw the segments that are NOT cut
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    let currentT = 0;
    for (const [cutStart, cutEnd] of merged) {
      if (cutStart > currentT) {
        // Draw from currentT to cutStart
        ctx.beginPath();
        ctx.moveTo(a.x + currentT * dx, a.y + currentT * dy);
        ctx.lineTo(a.x + cutStart * dx, a.y + cutStart * dy);
        ctx.stroke();
      }
      currentT = cutEnd;
    }
    // Draw remaining after last cut
    if (currentT < 1) {
      ctx.beginPath();
      ctx.moveTo(a.x + currentT * dx, a.y + currentT * dy);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function drawCurrentRoom() {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(currentRoomPoints[0].x, currentRoomPoints[0].y);
    for (let i = 1; i < currentRoomPoints.length; i++) {
      ctx.lineTo(currentRoomPoints[i].x, currentRoomPoints[i].y);
    }
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawCurrentRect() {
    const x = Math.min(rectStart.x, rectEnd.x);
    const y = Math.min(rectStart.y, rectEnd.y);
    const w = Math.abs(rectEnd.x - rectStart.x);
    const h = Math.abs(rectEnd.y - rectStart.y);
    ctx.save();
    ctx.fillStyle = 'rgba(233, 69, 96, 0.1)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#e94560';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(w)} × ${Math.round(h)}`, x + w / 2, y + h / 2);
    ctx.restore();
  }

  function drawStampPreview() {
    const x = Math.min(stampStart.x, stampEnd.x);
    const y = Math.min(stampStart.y, stampEnd.y);
    const w = Math.max(gridSize, Math.abs(stampEnd.x - stampStart.x));
    const h = Math.max(gridSize, Math.abs(stampEnd.y - stampStart.y));
    ctx.save();
    ctx.fillStyle = 'rgba(100, 180, 255, 0.15)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // Label
    const def = ITEM_DEFS[stampType];
    ctx.fillStyle = '#4a9eff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${def ? def.label : ''} ${Math.round(w)}×${Math.round(h)}`, x + w / 2, y + h / 2);
    ctx.restore();
  }

  function drawLinePreview() {
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(lineStart.x, lineStart.y);
    ctx.lineTo(lineEnd.x, lineEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawItem(item) {
    const isDoor = item.type && item.type.startsWith('door-');
    const hasCustomRender = isDoor || item.type === 'toilet' || item.type === 'toilet-jp' || item.type === 'toilet-kisha' || item.type === 'step-up' || item.type === 'bath-step' || item.type === 'text' || item.type === 'line' || (item.type && item.type.startsWith('rail-'));
    ctx.save();
    ctx.translate(item.x + item.w / 2, item.y + item.h / 2);
    ctx.rotate((item.rotation || 0) * Math.PI / 180);
    ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    ctx.translate(-(item.w / 2), -(item.h / 2));

    // Draw bounding box only for items without custom rendering
    if (!hasCustomRender) {
      ctx.fillStyle = item.color;
      ctx.fillRect(0, 0, item.w, item.h);
      ctx.strokeStyle = item === selectedItem ? '#e94560' : (item.itemColor || '#333');
      ctx.lineWidth = item === selectedItem ? 2.5 : 1;
      ctx.strokeRect(0, 0, item.w, item.h);
    }

    const lineColor = item.itemColor || '#333';

    // Special rendering for stairs
    if (item.type === 'stairs') {
      const steps = Math.max(3, Math.round(item.h / gridSize));
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      for (let i = 1; i < steps; i++) {
        const sy = (item.h / steps) * i;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(item.w, sy);
        ctx.stroke();
      }
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(item.w / 2 - 6, item.h * 0.2);
      ctx.lineTo(item.w / 2 + 6, item.h * 0.2);
      ctx.lineTo(item.w / 2, item.h * 0.05);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-l') {
      // L-shaped stairs: steps going up then turning right
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      const turnY = item.h * 0.6;
      // Straight section (bottom)
      const stepsA = Math.max(2, Math.round(turnY / gridSize));
      for (let i = 1; i <= stepsA; i++) {
        const sy = item.h - (turnY / stepsA) * i + (item.h - turnY);
        ctx.beginPath();
        ctx.moveTo(0, item.h - (turnY / stepsA) * (i - 1));
        if (i <= stepsA) { ctx.moveTo(0, item.h - (turnY / stepsA) * i); ctx.lineTo(item.w * 0.6, item.h - (turnY / stepsA) * i); }
        ctx.stroke();
      }
      // Turn section (top-right)
      const stepsB = Math.max(2, Math.round((item.h - turnY) / gridSize));
      for (let i = 1; i <= stepsB; i++) {
        const sx = (item.w * 0.4 / stepsB) * i + item.w * 0.6;
        ctx.beginPath();
        ctx.moveTo(item.w * 0.6, (item.h - turnY) / stepsB * (i-1));
        ctx.lineTo(item.w * 0.6, (item.h - turnY) / stepsB * i);
        ctx.stroke();
      }
      // L-shape outline
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, item.h);
      ctx.lineTo(0, item.h - turnY);
      ctx.lineTo(item.w * 0.6, item.h - turnY);
      ctx.lineTo(item.w * 0.6, 0);
      ctx.lineTo(item.w, 0);
      ctx.lineTo(item.w, item.h);
      ctx.closePath();
      ctx.stroke();
      // Arrow
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(item.w * 0.3 - 4, item.h * 0.7);
      ctx.lineTo(item.w * 0.3 + 4, item.h * 0.7);
      ctx.lineTo(item.w * 0.3, item.h * 0.6);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-u') {
      // U-shaped (折返し) stairs
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      const halfW = item.w / 2;
      // Left side going up
      const stepsUp = Math.max(3, Math.round(item.h * 0.8 / gridSize));
      for (let i = 1; i < stepsUp; i++) {
        const sy = item.h - (item.h * 0.8 / stepsUp) * i;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(halfW - 2, sy);
        ctx.stroke();
      }
      // Right side going down
      for (let i = 1; i < stepsUp; i++) {
        const sy = (item.h * 0.8 / stepsUp) * i;
        ctx.beginPath();
        ctx.moveTo(halfW + 2, sy);
        ctx.lineTo(item.w, sy);
        ctx.stroke();
      }
      // Center divider
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(halfW, 0);
      ctx.lineTo(halfW, item.h);
      ctx.stroke();
      // Arrows
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(halfW * 0.5 - 4, item.h * 0.3);
      ctx.lineTo(halfW * 0.5 + 4, item.h * 0.3);
      ctx.lineTo(halfW * 0.5, item.h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(halfW + halfW * 0.5 - 4, item.h * 0.7);
      ctx.lineTo(halfW + halfW * 0.5 + 4, item.h * 0.7);
      ctx.lineTo(halfW + halfW * 0.5, item.h * 0.8);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-spiral') {
      // Spiral stairs
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      const cx = item.w / 2;
      const cy = item.h / 2;
      const r = Math.min(cx, cy) * 0.85;
      // Outer circle
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // Inner circle (center pole)
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // Radiating step lines
      ctx.lineWidth = 1;
      const numSteps = 8;
      for (let i = 0; i < numSteps; i++) {
        const angle = (Math.PI * 2 / numSteps) * i;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r * 0.15, cy + Math.sin(angle) * r * 0.15);
        ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        ctx.stroke();
      }
      // Arrow (curved)
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 1.2);
      ctx.stroke();
      // Arrowhead
      const arrowAngle = Math.PI * 1.2;
      const ax = cx + Math.cos(arrowAngle) * r * 0.6;
      const ay = cy + Math.sin(arrowAngle) * r * 0.6;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + 5, ay - 3);
      ctx.lineTo(ax + 2, ay + 4);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-kaneore') {
      // かね折れ階段: no landing, fan-shaped treads at turn
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      // Straight section (bottom half)
      const turnY = item.h * 0.5;
      const stepsA = Math.max(2, Math.round(turnY / gridSize));
      for (let i = 0; i <= stepsA; i++) {
        const sy = item.h - (turnY / stepsA) * i;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(item.w * 0.6, sy);
        ctx.stroke();
      }
      // Fan-shaped treads at corner (3 wedge steps)
      const cornerX = item.w * 0.6;
      const cornerY = item.h - turnY;
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const angle = (Math.PI / 2 / 3) * i;
        ctx.beginPath();
        ctx.moveTo(cornerX, cornerY);
        ctx.lineTo(cornerX + Math.cos(-angle) * item.w * 0.4, cornerY - Math.sin(-angle) * item.h * 0.4);
        ctx.stroke();
      }
      // Upper straight section
      const stepsB = Math.max(2, Math.round((item.h * 0.3) / gridSize));
      for (let i = 0; i <= stepsB; i++) {
        const sy = (item.h * 0.3 / stepsB) * i;
        ctx.beginPath();
        ctx.moveTo(item.w * 0.6, sy);
        ctx.lineTo(item.w, sy);
        ctx.stroke();
      }
      // Arrow
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(item.w * 0.3 - 4, item.h * 0.85);
      ctx.lineTo(item.w * 0.3 + 4, item.h * 0.85);
      ctx.lineTo(item.w * 0.3, item.h * 0.75);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-circular') {
      // 円形階段: hollow center, treads between inner and outer walls
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      const cx = item.w / 2;
      const cy = item.h / 2;
      const rOuter = Math.min(cx, cy) * 0.9;
      const rInner = rOuter * 0.4;
      // Outer circle
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.stroke();
      // Inner circle (hollow)
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
      ctx.stroke();
      // Radiating step lines between inner and outer
      ctx.lineWidth = 1;
      const numSteps = 10;
      for (let i = 0; i < numSteps; i++) {
        const angle = (Math.PI * 2 / numSteps) * i;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
        ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
        ctx.stroke();
      }
      // Arrow
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, (rInner + rOuter) / 2, 0, Math.PI * 1.3);
      ctx.stroke();
    }

    if (item.type === 'stairs-curve') {
      // 曲線階段: gentle curve from bottom to top
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      const steps = Math.max(5, Math.round(item.h / gridSize));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = item.h * (1 - t);
        // Curve offset (gentle S-curve)
        const xOffset = Math.sin(t * Math.PI) * item.w * 0.3;
        ctx.beginPath();
        ctx.moveTo(xOffset, y);
        ctx.lineTo(xOffset + item.w * 0.5, y);
        ctx.stroke();
      }
      // Side rails (curved)
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const y = item.h * (1 - t);
        const xOffset = Math.sin(t * Math.PI) * item.w * 0.3;
        if (i === 0) ctx.moveTo(xOffset, y);
        else ctx.lineTo(xOffset, y);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const y = item.h * (1 - t);
        const xOffset = Math.sin(t * Math.PI) * item.w * 0.3 + item.w * 0.5;
        if (i === 0) ctx.moveTo(xOffset, y);
        else ctx.lineTo(xOffset, y);
      }
      ctx.stroke();
      // Arrow
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(item.w * 0.4 - 4, item.h * 0.2);
      ctx.lineTo(item.w * 0.4 + 4, item.h * 0.2);
      ctx.lineTo(item.w * 0.4, item.h * 0.1);
      ctx.closePath();
      ctx.fill();
    }

    if (item.type === 'stairs-mawari') {
      // 回り階段: winder treads (fan-shaped) instead of landing
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      // Bottom straight steps
      const straightSteps = 3;
      for (let i = 0; i <= straightSteps; i++) {
        const sy = item.h - (item.h * 0.3 / straightSteps) * i;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(item.w, sy);
        ctx.stroke();
      }
      // Winder steps (fan at middle)
      const centerX = item.w / 2;
      const centerY = item.h * 0.5;
      const winderR = item.w * 0.5;
      ctx.lineWidth = 1;
      const winderSteps = 4;
      for (let i = 0; i <= winderSteps; i++) {
        const angle = -Math.PI / 2 + (Math.PI / winderSteps) * i;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + Math.cos(angle) * winderR, centerY + Math.sin(angle) * winderR);
        ctx.stroke();
      }
      // Top straight steps
      for (let i = 0; i <= straightSteps; i++) {
        const sy = (item.h * 0.3 / straightSteps) * i;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(item.w, sy);
        ctx.stroke();
      }
      // Arrow
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.moveTo(item.w / 2 - 4, item.h * 0.85);
      ctx.lineTo(item.w / 2 + 4, item.h * 0.85);
      ctx.lineTo(item.w / 2, item.h * 0.75);
      ctx.closePath();
      ctx.fill();
    }

    // Bed rendering: add pillow at the top
    if (item.type === 'bed') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1;
      // Pillow (rounded rectangle at top)
      const pillowH = item.h * 0.15;
      const pillowMargin = item.w * 0.1;
      const pillowW = item.w - pillowMargin * 2;
      const pr = Math.min(pillowH * 0.4, pillowW * 0.1);
      ctx.beginPath();
      ctx.moveTo(pillowMargin + pr, item.h * 0.05);
      ctx.lineTo(pillowMargin + pillowW - pr, item.h * 0.05);
      ctx.quadraticCurveTo(pillowMargin + pillowW, item.h * 0.05, pillowMargin + pillowW, item.h * 0.05 + pr);
      ctx.lineTo(pillowMargin + pillowW, item.h * 0.05 + pillowH - pr);
      ctx.quadraticCurveTo(pillowMargin + pillowW, item.h * 0.05 + pillowH, pillowMargin + pillowW - pr, item.h * 0.05 + pillowH);
      ctx.lineTo(pillowMargin + pr, item.h * 0.05 + pillowH);
      ctx.quadraticCurveTo(pillowMargin, item.h * 0.05 + pillowH, pillowMargin, item.h * 0.05 + pillowH - pr);
      ctx.lineTo(pillowMargin, item.h * 0.05 + pr);
      ctx.quadraticCurveTo(pillowMargin, item.h * 0.05, pillowMargin + pr, item.h * 0.05);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      // Blanket fold line
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.3);
      ctx.lineTo(item.w, item.h * 0.3);
      ctx.stroke();
    }

    // Toilet rendering: top-down view showing tank and seat
    if (item.type === 'toilet') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      const cw = item.w;
      const ch = item.h;

      // Tank (rectangle at back/top)
      const tankH = ch * 0.25;
      ctx.beginPath();
      ctx.rect(cw * 0.15, 0, cw * 0.7, tankH);
      ctx.stroke();

      // Seat (rounded oval, single line)
      ctx.beginPath();
      ctx.ellipse(cw / 2, tankH + (ch - tankH) * 0.5, cw * 0.4, (ch - tankH) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 和式トイレ: 上から見た長細い楕円（便器）+ 足場のくぼみ
    if (item.type === 'toilet-jp') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      const cw = item.w;
      const ch = item.h;

      // 外枠（床面）
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.stroke();

      // 便器（細長い楕円）
      ctx.beginPath();
      ctx.ellipse(cw / 2, ch * 0.5, cw * 0.25, ch * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 足場の溝（左右の線）
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cw * 0.1, ch * 0.2);
      ctx.lineTo(cw * 0.1, ch * 0.8);
      ctx.moveTo(cw * 0.9, ch * 0.2);
      ctx.lineTo(cw * 0.9, ch * 0.8);
      ctx.stroke();

      // フード（前方の半円）
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cw / 2, ch * 0.2, cw * 0.2, Math.PI, 0);
      ctx.stroke();
    }

    // 汽車便器: 跨ぎ式の長方形便器
    if (item.type === 'toilet-kisha') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      const cw = item.w;
      const ch = item.h;

      // 外枠（床面）
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.stroke();

      // 便器本体（角丸長方形）
      const bx = cw * 0.2, by = ch * 0.15;
      const bw = cw * 0.6, bh = ch * 0.7;
      const r = Math.min(bw, bh) * 0.15;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.lineTo(bx + bw - r, by);
      ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
      ctx.lineTo(bx + bw, by + bh - r);
      ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
      ctx.lineTo(bx + r, by + bh);
      ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
      ctx.lineTo(bx, by + r);
      ctx.quadraticCurveTo(bx, by, bx + r, by);
      ctx.closePath();
      ctx.stroke();

      // 中の穴（小さい楕円）
      ctx.beginPath();
      ctx.ellipse(cw / 2, ch * 0.5, cw * 0.15, ch * 0.2, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 足場マーク
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cw * 0.05, ch * 0.3);
      ctx.lineTo(cw * 0.05, ch * 0.7);
      ctx.moveTo(cw * 0.95, ch * 0.3);
      ctx.lineTo(cw * 0.95, ch * 0.7);
      ctx.stroke();
    }

    // Text rendering
    if (item.type === 'text' && item.text) {
      ctx.fillStyle = item.color || '#333';
      ctx.font = `${item.fontSize || 13}px "Hiragino Sans", "Meiryo", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(item.text, 0, 0);
      // Update width based on actual text measurement
      const measured = ctx.measureText(item.text).width;
      if (Math.abs(item.w - measured) > 5) item.w = measured + 4;
    }

    // Line rendering (直線)
    if (item.type === 'line') {
      ctx.strokeStyle = item === selectedItem ? '#e94560' : (item.itemColor || item.color || '#333');
      const baseWidth = item.lineWidth || 3;
      ctx.lineWidth = item === selectedItem ? baseWidth + 1 : baseWidth;
      // Draw line from stored absolute coords relative to bounding box
      const lx1 = item.x1 - item.x;
      const ly1 = item.y1 - item.y;
      const lx2 = item.x2 - item.x;
      const ly2 = item.y2 - item.y;
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();
    }

    // Step/level difference rendering (段差記号 - クランク型: ┘└ のような段違い線)
    if (item.type === 'step-up') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // 左の縦線（上側の床レベル）
      ctx.moveTo(0, 0);
      ctx.lineTo(0, item.h * 0.5);
      // 横線（段差の壁面）
      ctx.lineTo(item.w, item.h * 0.5);
      // 右の縦線（下側の床レベル）
      ctx.lineTo(item.w, item.h);
      ctx.stroke();
    }

    // Bath step rendering (浴槽段差 - 片側凹凸)
    if (item.type === 'bath-step') {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w * 0.3, item.h * 0.5);
      ctx.lineTo(item.w * 0.3, 0);
      ctx.lineTo(item.w * 0.6, 0);
      ctx.lineTo(item.w * 0.6, item.h * 0.5);
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
    }

    // Handrail rendering (手すり - colored line + end caps)
    const railColor = item.itemColor || '#e94560';
    if (item.type === 'rail-h') {
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
      ctx.fillStyle = railColor;
      ctx.beginPath();
      ctx.arc(0, item.h * 0.5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(item.w, item.h * 0.5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (item.type === 'rail-v') {
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 2;
      ctx.fillStyle = '#fff';
      const r = Math.min(item.w, item.h) * 0.4;
      ctx.beginPath();
      ctx.arc(item.w * 0.5, item.h * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (item.type === 'rail-l') {
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(item.w * 0.5, 0);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
      ctx.fillStyle = railColor;
      ctx.beginPath();
      ctx.arc(item.w * 0.5, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(item.w, item.h * 0.5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Handrail number display (circled number - ①②③ style)
    if (item.type && item.type.startsWith('rail-') && item.railNumber) {
      const nx = (item.numberOffsetX || 0);
      const ny = (item.numberOffsetY || -20);
      const numX = item.w / 2 + nx;
      const numY = item.h / 2 + ny;
      // Use Unicode circled numbers if possible
      const circledNums = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
      const numIdx = parseInt(item.railNumber) - 1;
      const displayText = (numIdx >= 0 && numIdx < circledNums.length) ? circledNums[numIdx] : item.railNumber;
      ctx.fillStyle = '#e94560';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayText, numX, numY);
    }

    // Door rendering - CAD standard symbols (JIS style)
    // White background under door area to ensure visibility over wall lines

    if (item.type === 'door-swing') {
      // White background under the arc area
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, item.h);
      ctx.arc(0, item.h, item.w + 1, -Math.PI / 2, 0);
      ctx.closePath();
      ctx.fill();
      // Door panel line (from hinge point)
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, item.h);
      ctx.lineTo(0, item.h - item.w);
      ctx.stroke();
      // Swing arc (90°)
      ctx.beginPath();
      ctx.arc(0, item.h, item.w, -Math.PI / 2, 0);
      ctx.stroke();
    }

    if (item.type === 'door-swing-r') {
      // White background under the arc area
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(item.w, item.h);
      ctx.arc(item.w, item.h, item.w + 1, -Math.PI, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      // Door panel line
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.w, item.h);
      ctx.lineTo(item.w, item.h - item.w);
      ctx.stroke();
      // Swing arc
      ctx.beginPath();
      ctx.arc(item.w, item.h, item.w, -Math.PI, -Math.PI / 2);
      ctx.stroke();
    }

    if (item.type === 'door-slide') {
      // 片引き戸: 実線パネル＋破線で戸袋位置
      // White background to cover wall lines underneath
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
      // Door panel (solid thick line, right side = open position)
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(item.w * 0.5, item.h * 0.5);
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
      // Pocket (dashed, left side = stored position)
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (item.type === 'door-slide2') {
      // 引違い戸: 破線2本で間口全幅を表現
      // White background to cover wall lines underneath
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.3);
      ctx.lineTo(item.w, item.h * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.7);
      ctx.lineTo(item.w, item.h * 0.7);
      ctx.stroke();
      // Dashed lines
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.3);
      ctx.lineTo(item.w, item.h * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.7);
      ctx.lineTo(item.w, item.h * 0.7);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (item.type === 'door-double') {
      // 両開き戸: 左右の扉板線＋各1/4円弧
      const halfW = item.w / 2;
      // White background under both arcs
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, item.h);
      ctx.arc(0, item.h, halfW + 1, -Math.PI / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(item.w, item.h);
      ctx.arc(item.w, item.h, halfW + 1, -Math.PI, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      // Draw door lines
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      // Left panel + arc
      ctx.beginPath();
      ctx.moveTo(0, item.h);
      ctx.lineTo(0, item.h - halfW);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, item.h, halfW, -Math.PI / 2, 0);
      ctx.stroke();
      // Right panel + arc
      ctx.beginPath();
      ctx.moveTo(item.w, item.h);
      ctx.lineTo(item.w, item.h - halfW);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(item.w, item.h, halfW, -Math.PI, -Math.PI / 2);
      ctx.stroke();
    }

    if (item.type === 'door-fold') {
      // 折れ戸: V字に折れたパネル
      // White background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, item.w, item.h);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w * 0.25, item.h * 0.1);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(item.w, item.h * 0.5);
      ctx.lineTo(item.w * 0.75, item.h * 0.1);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.stroke();
    }

    if (item.type === 'door-pocket') {
      // 引込み戸: 破線パネル（壁内に格納）
      // White background to cover wall lines underneath
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.stroke();
      // Dashed line
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      ctx.lineTo(item.w * 0.5, item.h * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (item.type === 'door-accordion') {
      // アコーディオン: ジグザグの連続線
      // White background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, item.w, item.h);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      const folds = 6;
      const foldW = item.w / folds;
      ctx.beginPath();
      ctx.moveTo(0, item.h * 0.5);
      for (let i = 0; i < folds; i++) {
        const x1 = foldW * i + foldW * 0.5;
        const y1 = (i % 2 === 0) ? item.h * 0.1 : item.h * 0.9;
        ctx.lineTo(x1, y1);
      }
      ctx.lineTo(item.w, item.h * 0.5);
      ctx.stroke();
    }

    if (item.type === 'door-open') {
      // 開口: 壁線を白で消して開口を表現
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, -2, item.w, item.h + 4);
    }

    // Label (not for custom-rendered items) - supports offset for repositioning
    const fontSize = Math.min(12, Math.min(item.w, item.h) * 0.5);
    if (fontSize >= 8 && !hasCustomRender && item.label) {
      const lblX = item.w / 2 + (item.labelOffsetX || 0);
      const lblY = item.h / 2 + (item.labelOffsetY || 0);
      ctx.fillStyle = '#333';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, lblX, lblY);
    }

    // Selection highlight: prominent dashed border + semi-transparent overlay
    if (item === selectedItem) {
      // Semi-transparent highlight background
      ctx.fillStyle = 'rgba(74, 158, 255, 0.08)';
      ctx.fillRect(-4, -4, item.w + 8, item.h + 8);
      // Dashed selection border
      ctx.strokeStyle = '#e94560';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(-4, -4, item.w + 8, item.h + 8);
      ctx.setLineDash([]);

      // Rotation handle (circle above the item)
      const rotY = -18;
      ctx.beginPath();
      ctx.arc(item.w / 2, rotY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#4a9eff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Line connecting to item
      ctx.beginPath();
      ctx.moveTo(item.w / 2, rotY + 6);
      ctx.lineTo(item.w / 2, 0);
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Show item label/type near the selection for clarity
      const infoText = item.label || (ITEM_DEFS[item.type] ? ITEM_DEFS[item.type].label : item.type) || '';
      if (infoText) {
        ctx.fillStyle = '#e94560';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(infoText, item.w / 2, -24);
      }

      // Resize handles (small squares at corners and edge midpoints)
      const hs = 5; // handle half-size
      const handlePositions = [
        { x: 0, y: 0 },              // top-left
        { x: item.w, y: 0 },         // top-right
        { x: 0, y: item.h },         // bottom-left
        { x: item.w, y: item.h },    // bottom-right
        { x: item.w / 2, y: 0 },     // top-center
        { x: item.w / 2, y: item.h },// bottom-center
        { x: 0, y: item.h / 2 },     // left-center
        { x: item.w, y: item.h / 2 },// right-center
      ];
      for (const hp of handlePositions) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hp.x - hs, hp.y - hs, hs * 2, hs * 2);
      }
    }
    ctx.restore();
  }

  // === Hit testing ===
  function getItemHandleAt(item, px, py) {
    // Convert to item's local coordinates (accounting for rotation)
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const angle = -(item.rotation || 0) * Math.PI / 180;
    const dx = px - cx, dy = py - cy;
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle) + item.w / 2;
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle) + item.h / 2;

    const hs = 10; // handle hit size (larger for easier grabbing)

    // Rotation handle (blue circle above item)
    if (Math.abs(lx - item.w / 2) < 12 && ly > -28 && ly < -6) return 'rotate';

    // Corner handles first (they take priority)
    if (Math.abs(lx - item.w) < hs && Math.abs(ly - item.h) < hs) return 'br';
    if (Math.abs(lx) < hs && Math.abs(ly) < hs) return 'tl';
    if (Math.abs(lx - item.w) < hs && Math.abs(ly) < hs) return 'tr';
    if (Math.abs(lx) < hs && Math.abs(ly - item.h) < hs) return 'bl';

    // Edge handles: for thin items, allow grabbing along the entire edge
    // Right edge: near right side
    if (Math.abs(lx - item.w) < hs && ly >= -hs && ly <= item.h + hs) return 'r';
    // Left edge: near left side
    if (Math.abs(lx) < hs && ly >= -hs && ly <= item.h + hs) return 'l';
    // Bottom edge: near bottom
    if (Math.abs(ly - item.h) < hs && lx >= -hs && lx <= item.w + hs) return 'b';
    // Top edge: near top
    if (Math.abs(ly) < hs && lx >= -hs && lx <= item.w + hs) return 't';

    return null;
  }

  function getItemAt(px, py) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const cx = item.x + item.w / 2;
      const cy = item.y + item.h / 2;
      const angle = -(item.rotation || 0) * Math.PI / 180;
      const dx = px - cx, dy = py - cy;
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle) + item.w / 2;
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle) + item.h / 2;
      // Add padding to make items easier to grab (especially doors)
      const pad = gridSize * 0.5;
      if (lx >= -pad && lx <= item.w + pad && ly >= -pad && ly <= item.h + pad) return item;
    }
    return null;
  }

  function getRoomAt(px, py) {
    for (let i = rooms.length - 1; i >= 0; i--) {
      if (pointInPolygon(px, py, rooms[i].points)) return rooms[i];
    }
    return null;
  }

  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // === Straighten freehand path ===
  function straightenPath(points) {
    if (points.length < 3) return points;
    const simplified = rdpSimplify(points, 15);
    const snapped = simplified.map(p => ({
      x: Math.round(p.x / gridSize) * gridSize,
      y: Math.round(p.y / gridSize) * gridSize,
    }));
    const straightened = [snapped[0]];
    for (let i = 1; i < snapped.length; i++) {
      const prev = straightened[straightened.length - 1];
      const curr = snapped[i];
      const dx = Math.abs(curr.x - prev.x);
      const dy = Math.abs(curr.y - prev.y);
      if (dy < gridSize * 1.5 && dx > gridSize) {
        straightened.push({ x: curr.x, y: prev.y });
      } else if (dx < gridSize * 1.5 && dy > gridSize) {
        straightened.push({ x: prev.x, y: curr.y });
      } else {
        straightened.push(curr);
      }
    }
    const result = [straightened[0]];
    for (let i = 1; i < straightened.length; i++) {
      const prev = result[result.length - 1];
      if (prev.x !== straightened[i].x || prev.y !== straightened[i].y) {
        result.push(straightened[i]);
      }
    }
    return result.length >= 3 ? result : points;
  }

  function rdpSimplify(points, tolerance) {
    if (points.length < 3) return points;
    function rdp(pts, start, end, tol) {
      let maxDist = 0, maxIdx = start;
      for (let i = start + 1; i < end; i++) {
        const d = perpDist(pts[i], pts[start], pts[end]);
        if (d > maxDist) { maxDist = d; maxIdx = i; }
      }
      if (maxDist > tol) {
        const left = rdp(pts, start, maxIdx, tol);
        const right = rdp(pts, maxIdx, end, tol);
        return left.slice(0, -1).concat(right);
      }
      return [pts[start], pts[end]];
    }
    function perpDist(pt, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx*dx + dy*dy;
      if (lenSq === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
      const t = Math.max(0, Math.min(1, ((pt.x-a.x)*dx + (pt.y-a.y)*dy) / lenSq));
      return Math.hypot(pt.x - (a.x + t*dx), pt.y - (a.y + t*dy));
    }
    return rdp(points, 0, points.length - 1, tolerance);
  }

  // === Double-click to toggle edit menu ===
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x: mx, y: my } = screenToWorld(screenX, screenY);
    // Check if double-clicking on a selected item or room
    const clickedItem = getItemAt(mx, my);
    const clickedRoom = getRoomAt(mx, my);
    if ((clickedItem && clickedItem === selectedItem) || (clickedRoom && clickedRoom === selectedRoom)) {
      toggleContextMenu();
    }
  });

  // === Mouse events ===
  canvas.addEventListener('mousedown', (e) => {
    // Middle button for panning
    if (e.button === 1) {
      e.preventDefault();
      isPanning = true;
      panStart = { x: e.clientX - viewOffsetX, y: e.clientY - viewOffsetY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    // Pan with space held
    if (spaceHeld) {
      isPanning = true;
      panStart = { x: e.clientX - viewOffsetX, y: e.clientY - viewOffsetY };
      canvas.style.cursor = 'grabbing';
      return;
    }

    contextMenuVisible = false;
    hideContextMenu();
    updateEditBtnVisibility();
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x: mx, y: my } = screenToWorld(screenX, screenY);

    // Edge toggle mode: click near an edge of the selected room to toggle visibility
    if (edgeToggleMode && selectedRoom) {
      const pts = selectedRoom.points;
      const tolerance = 10 / viewScale; // 10 screen pixels
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        // Distance from point to line segment
        const dx = b.x - a.x, dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        let dist;
        if (lenSq === 0) {
          dist = Math.hypot(mx - a.x, my - a.y);
        } else {
          const t = Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / lenSq));
          dist = Math.hypot(mx - (a.x + t * dx), my - (a.y + t * dy));
        }
        if (dist < tolerance) {
          saveState();
          if (!selectedRoom.hiddenEdges) selectedRoom.hiddenEdges = [];
          const idx = selectedRoom.hiddenEdges.indexOf(i);
          if (idx === -1) {
            selectedRoom.hiddenEdges.push(i);
            updateStatus(`辺${i + 1}を非表示にしました（再度クリックで表示）`);
          } else {
            selectedRoom.hiddenEdges.splice(idx, 1);
            updateStatus(`辺${i + 1}を再表示しました`);
          }
          draw();
          return;
        }
      }
      return;
    }

    // Line mode (drag to draw a straight line)
    if (lineMode) {
      isLineDragging = true;
      lineStart = { x: snap(mx), y: snap(my) };
      lineEnd = { x: snap(mx), y: snap(my) };
      return;
    }

    // Stamp mode (drag to size)
    if (stampMode && stampType && ITEM_DEFS[stampType]) {
      stampDragging = true;
      stampStart = { x: snap(mx), y: snap(my) };
      stampEnd = { x: snap(mx), y: snap(my) };
      return;
    }

    // Text placement mode (click to place)
    if (stampMode && stampType === '__text__' && canvas._pendingText) {
      const { text, size, color } = canvas._pendingText;
      saveState();
      const newItem = {
        type: 'text',
        x: mx,
        y: my,
        w: text.length * size * 0.7,
        h: size + 4,
        text,
        fontSize: size,
        color: color || '#333',
        label: '',
        rotation: 0,
      };
      items.push(newItem);
      selectedItem = newItem;
      selectedRoom = null;
      canvas._pendingText = null;
      cancelStampMode();
      updateStatus(`テキスト「${text}」を配置しました`);
      return;
    }

    // Rectangle mode
    if (rectMode) {
      isRectDragging = true;
      rectStart = { x: snap(mx), y: snap(my) };
      rectEnd = { x: snap(mx), y: snap(my) };
      return;
    }

    // Freehand draw mode
    if (drawMode) {
      if (!isTracing) {
        isTracing = true;
        currentRoomPoints = [{ x: mx, y: my }];
        updateStatus('マウスを動かして線を引きます。クリックで確定 / Escでキャンセル');
      } else {
        if (currentRoomPoints.length >= 10) finishRoom();
        else updateStatus('もう少し大きく囲んでからクリックしてください');
      }
      draw();
      return;
    }

    // Check if clicking on a room label (to drag it)
    if (selectedRoom && selectedRoom.label) {
      const center = getRoomCenter(selectedRoom);
      const lx = center.x + (selectedRoom.labelOffsetX || 0);
      const ly = center.y + (selectedRoom.labelOffsetY || 0);
      if (Math.abs(mx - lx) < 50 && Math.abs(my - ly) < 16) {
        draggingLabel = selectedRoom;
        return;
      }
    }

    // Check if clicking on rail number (to drag it)
    if (selectedItem && selectedItem.type && selectedItem.type.startsWith('rail-') && selectedItem.railNumber) {
      const cx = selectedItem.x + selectedItem.w / 2;
      const cy = selectedItem.y + selectedItem.h / 2;
      const numX = cx + (selectedItem.numberOffsetX || 0);
      const numY = cy + (selectedItem.numberOffsetY || -20);
      if (Math.hypot(mx - numX, my - numY) < 14) {
        draggingRailNumber = selectedItem;
        return;
      }
    }

    // Check if clicking on item label (to drag it)
    if (selectedItem && selectedItem.label && !selectedItem.type.startsWith('door-') && selectedItem.type !== 'toilet' && selectedItem.type !== 'text') {
      const cx = selectedItem.x + selectedItem.w / 2;
      const cy = selectedItem.y + selectedItem.h / 2;
      const lblX = cx + (selectedItem.labelOffsetX || 0);
      const lblY = cy + (selectedItem.labelOffsetY || 0);
      if (Math.abs(mx - lblX) < 30 && Math.abs(my - lblY) < 10) {
        draggingItemLabel = selectedItem;
        return;
      }
    }

    // Check if clicking on a resize/rotate handle of selected item
    if (selectedItem) {
      const iHandle = getItemHandleAt(selectedItem, mx, my);
      if (iHandle === 'rotate') {
        // Start free rotation
        saveState();
        rotatingItem = selectedItem;
        const cx = selectedItem.x + selectedItem.w / 2;
        const cy = selectedItem.y + selectedItem.h / 2;
        rotateStartAngle = Math.atan2(my - cy, mx - cx) - (selectedItem.rotation || 0) * Math.PI / 180;
        return;
      }
      if (iHandle) {
        saveState();
        resizingItem = selectedItem;
        itemResizeHandle = iHandle;
        itemResizeStart = { x: selectedItem.x, y: selectedItem.y, w: selectedItem.w, h: selectedItem.h, mx, my };
        return;
      }
    }

    // Check if clicking on a resize handle of selected room
    if (selectedRoom) {
      const handle = getHandleAt(selectedRoom, mx, my);
      if (handle) {
        saveState();
        resizingRoom = selectedRoom;
        resizeHandle = handle;
        resizeStartBounds = getRoomBounds(selectedRoom);
        resizeStartMouse = { x: mx, y: my };
        // Save original points for proportional resize
        resizingRoom._origPoints = resizingRoom.points.map(p => ({ ...p }));
        return;
      }
    }

    // Normal mode: check items first, then rooms
    const item = getItemAt(mx, my);
    if (item) {
      selectedItem = item;
      selectedRoom = null;
      draggingItem = item;
      saveState();
      dragOffset.x = mx - item.x;
      dragOffset.y = my - item.y;
      items = items.filter(i => i !== item);
      items.push(item);
      // Show selected item info in status bar
      const label = item.label || (ITEM_DEFS[item.type] ? ITEM_DEFS[item.type].label : item.type) || '';
      const overlapping = items.filter(it => {
        return !(it.x > item.x + item.w + gridSize || it.x + it.w < item.x - gridSize ||
                 it.y > item.y + item.h + gridSize || it.y + it.h < item.y - gridSize);
      });
      const overlapHint = overlapping.length > 1 ? `（重なり${overlapping.length}個 / Tabで切替）` : '';
      updateStatus(`選択中: ${label} ${overlapHint}【Escで選択解除】`);
    } else {
      const room = getRoomAt(mx, my);
      if (room) {
        selectedRoom = room;
        selectedItem = null;

        // Check if clicking near the label -> drag label instead of room
        if (room.label) {
          const center = getRoomCenter(room);
          const lx = center.x + (room.labelOffsetX || 0);
          const ly = center.y + (room.labelOffsetY || 0);
          if (Math.abs(mx - lx) < 50 && Math.abs(my - ly) < 16) {
            draggingLabel = room;
            draw();
            return;
          }
        }

        draggingRoom = room;
        saveState();
        const center = getRoomCenter(room);
        roomDragOffset.x = mx - center.x;
        roomDragOffset.y = my - center.y;
      } else {
        selectedItem = null;
        selectedRoom = null;
        contextMenuVisible = false;
        hideContextMenu();
        updateEditBtnVisibility();
        updateStatus('部品をドラッグ＆ドロップで配置してください');
      }
    }
    draw();
  });

  canvas.addEventListener('mousemove', (e) => {
    // Handle panning
    if (isPanning) {
      viewOffsetX = e.clientX - panStart.x;
      viewOffsetY = e.clientY - panStart.y;
      draw();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { x: mx, y: my } = screenToWorld(screenX, screenY);
    mousePos.x = mx;
    mousePos.y = my;
    document.getElementById('status-pos').textContent = `X: ${Math.round(mx)}, Y: ${Math.round(my)} (${Math.round(viewScale * 100)}%)`;

    // Rectangle mode
    if (rectMode && isRectDragging) {
      rectEnd = { x: snap(mx), y: snap(my) };
      draw();
      return;
    }

    // Line mode dragging
    if (lineMode && isLineDragging) {
      lineEnd = { x: snap(mx), y: snap(my) };
      draw();
      return;
    }

    // Stamp mode dragging (drag to set size)
    if (stampMode && stampDragging) {
      stampEnd = { x: snap(mx), y: snap(my) };
      draw();
      return;
    }

    // Freehand draw mode
    if (drawMode && isTracing) {
      const last = currentRoomPoints[currentRoomPoints.length - 1];
      if (Math.hypot(mx - last.x, my - last.y) > 5) {
        currentRoomPoints.push({ x: mx, y: my });
      }
      draw();
      return;
    }

    // Rotating an item
    if (rotatingItem) {
      const cx = rotatingItem.x + rotatingItem.w / 2;
      const cy = rotatingItem.y + rotatingItem.h / 2;
      const currentAngle = Math.atan2(my - cy, mx - cx);
      let degrees = (currentAngle - rotateStartAngle) * 180 / Math.PI;
      // Round to 1 degree
      degrees = Math.round(degrees);
      rotatingItem.rotation = degrees;
      draw();
      return;
    }

    // Resizing an item (free pixel-level resizing, no grid snap)
    if (resizingItem) {
      const s = itemResizeStart;
      const dx = mx - s.mx;
      const dy = my - s.my;
      const minSize = 4; // minimum size in pixels

      switch (itemResizeHandle) {
        case 'r':
          resizingItem.w = Math.max(minSize, s.w + dx); break;
        case 'l':
          resizingItem.x = s.x + dx; resizingItem.w = Math.max(minSize, s.w - dx); break;
        case 'b':
          resizingItem.h = Math.max(minSize, s.h + dy); break;
        case 't':
          resizingItem.y = s.y + dy; resizingItem.h = Math.max(minSize, s.h - dy); break;
        case 'br':
          resizingItem.w = Math.max(minSize, s.w + dx); resizingItem.h = Math.max(minSize, s.h + dy); break;
        case 'tl':
          resizingItem.x = s.x + dx; resizingItem.w = Math.max(minSize, s.w - dx);
          resizingItem.y = s.y + dy; resizingItem.h = Math.max(minSize, s.h - dy); break;
        case 'tr':
          resizingItem.w = Math.max(minSize, s.w + dx);
          resizingItem.y = s.y + dy; resizingItem.h = Math.max(minSize, s.h - dy); break;
        case 'bl':
          resizingItem.x = s.x + dx; resizingItem.w = Math.max(minSize, s.w - dx);
          resizingItem.h = Math.max(minSize, s.h + dy); break;
      }
      draw();
      return;
    }

    // Resizing a room
    if (resizingRoom) {
      const dx = snap(mx) - snap(resizeStartMouse.x);
      const dy = snap(my) - snap(resizeStartMouse.y);
      const ob = resizeStartBounds;
      let newBounds = { x: ob.x, y: ob.y, w: ob.w, h: ob.h };

      switch (resizeHandle) {
        case 'br': newBounds.w = Math.max(gridSize, ob.w + dx); newBounds.h = Math.max(gridSize, ob.h + dy); break;
        case 'bl': newBounds.x = ob.x + dx; newBounds.w = Math.max(gridSize, ob.w - dx); newBounds.h = Math.max(gridSize, ob.h + dy); break;
        case 'tr': newBounds.w = Math.max(gridSize, ob.w + dx); newBounds.y = ob.y + dy; newBounds.h = Math.max(gridSize, ob.h - dy); break;
        case 'tl': newBounds.x = ob.x + dx; newBounds.w = Math.max(gridSize, ob.w - dx); newBounds.y = ob.y + dy; newBounds.h = Math.max(gridSize, ob.h - dy); break;
        case 'r': newBounds.w = Math.max(gridSize, ob.w + dx); break;
        case 'l': newBounds.x = ob.x + dx; newBounds.w = Math.max(gridSize, ob.w - dx); break;
        case 'b': newBounds.h = Math.max(gridSize, ob.h + dy); break;
        case 't': newBounds.y = ob.y + dy; newBounds.h = Math.max(gridSize, ob.h - dy); break;
      }

      resizeRoomTo(resizingRoom, newBounds, resizeStartBounds, resizingRoom._origPoints);
      draw();
      return;
    }

    // Dragging a room label
    if (draggingLabel) {
      const center = getRoomCenter(draggingLabel);
      draggingLabel.labelOffsetX = mx - center.x;
      draggingLabel.labelOffsetY = my - center.y;
      draw();
      return;
    }

    // Dragging a rail number
    if (draggingRailNumber) {
      const cx = draggingRailNumber.x + draggingRailNumber.w / 2;
      const cy = draggingRailNumber.y + draggingRailNumber.h / 2;
      draggingRailNumber.numberOffsetX = mx - cx;
      draggingRailNumber.numberOffsetY = my - cy;
      draw();
      return;
    }

    // Dragging an item label
    if (draggingItemLabel) {
      const cx = draggingItemLabel.x + draggingItemLabel.w / 2;
      const cy = draggingItemLabel.y + draggingItemLabel.h / 2;
      draggingItemLabel.labelOffsetX = mx - cx;
      draggingItemLabel.labelOffsetY = my - cy;
      draw();
      return;
    }

    // Dragging a room (move)
    if (draggingRoom) {
      const center = getRoomCenter(draggingRoom);
      const targetX = mx - roomDragOffset.x;
      const targetY = my - roomDragOffset.y;
      const dx = snap(targetX) - snap(center.x);
      const dy = snap(targetY) - snap(center.y);
      if (dx !== 0 || dy !== 0) {
        moveRoom(draggingRoom, dx, dy);
      }
      draw();
      return;
    }

    // Dragging an item (smooth pixel movement, snap on release)
    if (draggingItem) {
      draggingItem.x = mx - dragOffset.x;
      draggingItem.y = my - dragOffset.y;
      draw();
      return;
    }

    // Cursor hint for handles
    if (selectedItem && !drawMode && !rectMode) {
      const iHandle = getItemHandleAt(selectedItem, mx, my);
      if (iHandle) {
        const cursorMap = { l: 'w-resize', r: 'e-resize', t: 'n-resize', b: 's-resize', tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize', rotate: 'crosshair' };
        canvas.style.cursor = cursorMap[iHandle] || 'default';
      } else {
        canvas.style.cursor = 'default';
      }
    } else if (selectedRoom && !drawMode && !rectMode) {
      // Check label hover
      if (selectedRoom.label) {
        const center = getRoomCenter(selectedRoom);
        const lx = center.x + (selectedRoom.labelOffsetX || 0);
        const ly = center.y + (selectedRoom.labelOffsetY || 0);
        if (Math.abs(mx - lx) < 50 && Math.abs(my - ly) < 16) {
          canvas.style.cursor = 'grab';
          return;
        }
      }
      const handle = getHandleAt(selectedRoom, mx, my);
      if (handle) {
        canvas.style.cursor = getCursorForHandle(handle);
      } else if (pointInPolygon(mx, my, selectedRoom.points)) {
        canvas.style.cursor = 'move';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    // End panning
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = spaceHeld ? 'grab' : 'default';
      return;
    }

    // Line mode: finish line
    if (lineMode && isLineDragging) {
      isLineDragging = false;
      const rect = canvas.getBoundingClientRect();
      const { x: mx, y: my } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      lineEnd = { x: snap(mx), y: snap(my) };
      const len = Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y);
      if (len > gridSize / 2) {
        saveState();
        // Store line as an item with type 'line'
        const currentLineWidth = parseInt(document.getElementById('line-width').value) || 3;
        const newItem = {
          type: 'line',
          x: Math.min(lineStart.x, lineEnd.x),
          y: Math.min(lineStart.y, lineEnd.y),
          w: Math.abs(lineEnd.x - lineStart.x) || 1,
          h: Math.abs(lineEnd.y - lineStart.y) || 1,
          x1: lineStart.x, y1: lineStart.y,
          x2: lineEnd.x, y2: lineEnd.y,
          color: '#333',
          lineWidth: currentLineWidth,
          label: '',
          rotation: 0,
        };
        items.push(newItem);
        selectedItem = newItem;
        // Auto-exit line mode after drawing
        cancelLineMode();
        draw();
        updateStatus('直線を描きました');
      }
      lineStart = null;
      lineEnd = null;
      return;
    }

    // Stamp mode: finish dragging to create item
    if (stampMode && stampDragging) {
      stampDragging = false;
      const rect = canvas.getBoundingClientRect();
      const { x: mx, y: my } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      stampEnd = { x: snap(mx), y: snap(my) };

      const x = Math.min(stampStart.x, stampEnd.x);
      const y = Math.min(stampStart.y, stampEnd.y);
      const w = Math.abs(stampEnd.x - stampStart.x);
      const h = Math.abs(stampEnd.y - stampStart.y);

      if (w >= gridSize || h >= gridSize) {
        const def = ITEM_DEFS[stampType];
        const isDoorType = stampType && stampType.startsWith('door-');
        saveState();

        let itemW, itemH, rotation;

        if (isDoorType) {
          // Doors: use drag direction to determine orientation
          // Drag is primarily horizontal → door is horizontal (width = drag length)
          // Drag is primarily vertical → door is vertical (rotated 90°)
          const dragW = Math.max(gridSize, w);
          const dragH = Math.max(gridSize, h);

          if (dragW >= dragH) {
            // Horizontal drag → horizontal door
            itemW = dragW;
            itemH = Math.max(gridSize, dragW * (def.h / def.w));
            rotation = 0;
          } else {
            // Vertical drag → rotate door 90°
            itemW = dragH;
            itemH = Math.max(gridSize, dragH * (def.h / def.w));
            rotation = 90;
          }
        } else {
          // Non-door items: use drag size directly
          itemW = Math.max(gridSize, w);
          itemH = Math.max(gridSize, h);
          rotation = 0;
        }

        const newItem = {
          type: stampType,
          x, y,
          w: itemW,
          h: itemH,
          color: def.color,
          label: def.label,
          rotation,
        };
        items.push(newItem);
        selectedItem = newItem;
        selectedRoom = null;

        // Save type before cancel clears it
        const placedType = stampType;
        cancelStampMode();

        // Auto-prompt for number if it's a handrail
        if (placedType && placedType.startsWith('rail-')) {
          const num = prompt('手すりの番号を入力してください（例：1, 2, 3…）', '');
          if (num) {
            newItem.railNumber = num;
            newItem.numberOffsetX = 0;
            newItem.numberOffsetY = -20;
          }
          updateRailLegend();
          draw();
        }

        updateStatus(`${def.label}を配置しました。ドラッグで移動、ハンドルでサイズ変更できます。`);
      } else {
        stampStart = null;
        stampEnd = null;
        draw();
        updateStatus('ドラッグしてサイズを決めてください');
      }
      return;
    }

    if (rectMode && isRectDragging) {
      isRectDragging = false;
      const rect = canvas.getBoundingClientRect();
      const { x: mx, y: my } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      rectEnd = { x: snap(mx), y: snap(my) };
      const w = Math.abs(rectEnd.x - rectStart.x);
      const h = Math.abs(rectEnd.y - rectStart.y);
      if (w > gridSize && h > gridSize) finishRectRoom();
      else { rectStart = null; rectEnd = null; draw(); updateStatus('もう少し大きくドラッグしてください'); }
      return;
    }
    if (rotatingItem) {
      rotatingItem = null;
      canvas.style.cursor = 'default';
    }
    if (resizingItem) {
      resizingItem = null;
      itemResizeHandle = null;
      itemResizeStart = null;
      canvas.style.cursor = 'default';
    }
    if (resizingRoom) {
      delete resizingRoom._origPoints;
      resizingRoom = null;
      resizeHandle = null;
      canvas.style.cursor = 'default';
    }
    // No snap on release - place item exactly where the user drops it
    if (draggingItem) {
      draw();
    }
    draggingLabel = null;
    draggingItemLabel = null;
    draggingRailNumber = null;
    draggingRoom = null;
    draggingItem = null;
  });

  canvas.addEventListener('mouseleave', () => {
    if (rectMode && isRectDragging) {
      isRectDragging = false; rectStart = null; rectEnd = null; draw();
    }
    if (resizingItem) { resizingItem = null; itemResizeHandle = null; }
    if (resizingRoom) { delete resizingRoom._origPoints; resizingRoom = null; }
    draggingLabel = null;
    draggingItemLabel = null;
    draggingRailNumber = null;
    draggingRoom = null;
    draggingItem = null;
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (drawMode) { cancelDrawMode(); return; }
    if (rectMode) { cancelRectMode(); return; }
    if (stampMode) { cancelStampMode(); return; }

    // Right-click selects item/room (menu auto-shows via draw)
    const rect = canvas.getBoundingClientRect();
    const { x: mx, y: my } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const item = getItemAt(mx, my);
    if (item) {
      selectedItem = item; selectedRoom = null; draw();
    } else {
      const room = getRoomAt(mx, my);
      if (room) {
        selectedRoom = room; selectedItem = null; draw();
      }
    }
  });

  // === Room drawing functions ===
  function startDrawMode() {
    if (rectMode) cancelRectMode();
    drawMode = true; isTracing = false; currentRoomPoints = [];
    selectedItem = null; selectedRoom = null;
    canvas.style.cursor = 'crosshair';
    updateStatus('部屋描画モード：クリックで描き始め → マウスを動かして囲む → もう一度クリックで確定');
    document.getElementById('btn-draw-room').classList.add('active');
    draw();
  }

  function finishRoom() {
    if (currentRoomPoints.length >= 10) {
      saveState();
      const straightened = straightenPath(currentRoomPoints);
      const label = prompt('部屋名を入力してください（空欄で無地）', '');
      const room = { points: straightened, color: 'rgba(255,255,255,0)', label: label || '' };
      rooms.push(room); roomColorIndex++; selectedRoom = room;
      updateStatus(`「${room.label}」を作成しました`);
    }
    currentRoomPoints = []; isTracing = false;
    // Auto-exit draw mode after finishing
    cancelDrawMode();
    draw();
  }

  function cancelDrawMode() {
    drawMode = false; isTracing = false; currentRoomPoints = [];
    canvas.style.cursor = 'default';
    document.getElementById('btn-draw-room').classList.remove('active');
    draw(); updateStatus('描画モードを終了しました');
  }

  // === Rectangle room functions ===
  function startRectMode() {
    if (drawMode) cancelDrawMode();
    rectMode = true; isRectDragging = false; rectStart = null; rectEnd = null;
    selectedItem = null; selectedRoom = null;
    canvas.style.cursor = 'crosshair';
    updateStatus('四角モード：ドラッグで四角い部屋を作成');
    document.getElementById('btn-rect-room').classList.add('active');
    draw();
  }

  function finishRectRoom() {
    saveState();
    const x1 = Math.min(rectStart.x, rectEnd.x), y1 = Math.min(rectStart.y, rectEnd.y);
    const x2 = Math.max(rectStart.x, rectEnd.x), y2 = Math.max(rectStart.y, rectEnd.y);
    const points = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
    const label = prompt('部屋名を入力してください（空欄で無地）', '');
    const room = { points, color: 'rgba(255,255,255,0)', label: label || '' };
    rooms.push(room); roomColorIndex++; selectedRoom = room;
    rectStart = null; rectEnd = null;
    // Auto-exit rect mode after drawing
    cancelRectMode();
    draw();
    updateStatus(`「${room.label}」を作成しました`);
  }

  function cancelRectMode() {
    rectMode = false; isRectDragging = false; rectStart = null; rectEnd = null;
    canvas.style.cursor = 'default';
    document.getElementById('btn-rect-room').classList.remove('active');
    draw(); updateStatus('四角モードを終了しました');
  }

  // === Line drawing mode ===
  function startLineMode() {
    if (drawMode) cancelDrawMode();
    if (rectMode) cancelRectMode();
    if (stampMode) cancelStampMode();
    lineMode = true;
    isLineDragging = false;
    lineStart = null;
    lineEnd = null;
    selectedItem = null;
    selectedRoom = null;
    canvas.style.cursor = 'crosshair';
    document.getElementById('btn-draw-line').classList.add('active');
    updateStatus('直線モード：ドラッグで直線を描画 / Escで終了');
    draw();
  }

  function cancelLineMode() {
    lineMode = false;
    isLineDragging = false;
    lineStart = null;
    lineEnd = null;
    canvas.style.cursor = 'default';
    document.getElementById('btn-draw-line').classList.remove('active');
    draw();
    updateStatus('直線モードを終了しました');
  }

  // === Stamp mode (click to place) ===
  function startStampMode(type) {
    if (drawMode) cancelDrawMode();
    if (rectMode) cancelRectMode();
    stampMode = true;
    stampType = type;
    selectedItem = null;
    selectedRoom = null;
    canvas.style.cursor = 'crosshair';
    const def = ITEM_DEFS[type];
    updateStatus(`「${def.label}」配置モード：図面をクリックで配置 / Escで終了`);
    // Highlight active item
    document.querySelectorAll('.submenu-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.palette-click').forEach(el => el.classList.remove('active-stamp'));
    const activeSubEl = document.querySelector(`.submenu-item[data-type="${type}"]`);
    if (activeSubEl) activeSubEl.classList.add('active');
    const activePalEl = document.querySelector(`.palette-click[data-type="${type}"]`);
    if (activePalEl) activePalEl.classList.add('active-stamp');
    draw();
  }

  function cancelStampMode() {
    stampMode = false;
    stampType = null;
    canvas.style.cursor = 'default';
    document.querySelectorAll('.submenu-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.palette-click').forEach(el => el.classList.remove('active-stamp'));
    draw();
    updateStatus('配置モードを終了しました');
  }

  // === Submenus and click-to-place ===
  const doorTrigger = document.getElementById('door-trigger');
  const doorSubmenu = document.getElementById('door-submenu');
  const stairsTrigger = document.getElementById('stairs-trigger');
  const stairsSubmenu = document.getElementById('stairs-submenu');

  function closeAllSubmenus() {
    doorSubmenu.classList.add('hidden');
    stairsSubmenu.classList.add('hidden');
  }

  doorTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    stairsSubmenu.classList.add('hidden');
    doorSubmenu.classList.toggle('hidden');
  });

  stairsTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    doorSubmenu.classList.add('hidden');
    stairsSubmenu.classList.toggle('hidden');
  });

  // Submenu items (doors and stairs) -> start stamp mode
  document.querySelectorAll('.submenu-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = el.dataset.type;
      closeAllSubmenus();
      startStampMode(type);
    });
  });

  // All palette-click items -> start stamp mode on click
  document.querySelectorAll('.palette-click').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = el.dataset.type;
      if (type && ITEM_DEFS[type]) {
        closeAllSubmenus();
        startStampMode(type);
      }
    });
  });

  // Close submenus when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!doorTrigger.contains(e.target) && !doorSubmenu.contains(e.target) &&
        !stairsTrigger.contains(e.target) && !stairsSubmenu.contains(e.target)) {
      closeAllSubmenus();
    }
  });

  // === Drag & Drop from palette (keep as fallback) ===
  document.querySelectorAll('.palette-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      if (!el.dataset.type) return;
      e.dataTransfer.setData('text/plain', el.dataset.type);
    });
  });
  canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    if (drawMode || rectMode || stampMode) return;
    const type = e.dataTransfer.getData('text/plain');
    if (!type || !ITEM_DEFS[type]) return;
    const rect = canvas.getBoundingClientRect();
    const { x: mx, y: my } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const def = ITEM_DEFS[type];
    const w = def.w * gridSize, h = def.h * gridSize;
    const newItem = { type, x: snap(mx - w/2), y: snap(my - h/2), w, h, color: def.color, label: def.label, rotation: 0 };
    saveState();
    items.push(newItem); selectedItem = newItem; draw();
    updateStatus(`${def.label}を配置しました`);
  });

  // === Context menu ===
  function showContextMenu(x, y) {
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
    // Update label controls visibility and values
    const labelControls = document.getElementById('ctx-label-controls');
    if (selectedRoom) {
      labelControls.style.display = 'flex';
      document.getElementById('ctx-label-size-display').textContent = selectedRoom.labelFontSize || 13;
    } else {
      labelControls.style.display = 'none';
    }
    // Update line width controls visibility
    const lineWidthControls = document.getElementById('ctx-line-width-controls');
    if (selectedItem && selectedItem.type === 'line') {
      lineWidthControls.style.display = 'flex';
      document.getElementById('ctx-line-width-display').textContent = selectedItem.lineWidth || 3;
    } else {
      lineWidthControls.style.display = 'none';
    }
  }
  function hideContextMenu() { contextMenu.classList.add('hidden'); contextMenuUserMoved = false; }

  // === Context menu drag functionality ===
  (function() {
    const dragHandle = document.getElementById('ctx-drag-handle');
    let isDraggingMenu = false;
    let menuDragStart = { x: 0, y: 0 };
    let menuStartPos = { x: 0, y: 0 };

    function startDrag(clientX, clientY) {
      isDraggingMenu = true;
      menuDragStart = { x: clientX, y: clientY };
      menuStartPos = {
        x: parseInt(contextMenu.style.left) || 0,
        y: parseInt(contextMenu.style.top) || 0
      };
    }

    function moveDrag(clientX, clientY) {
      if (!isDraggingMenu) return;
      const dx = clientX - menuDragStart.x;
      const dy = clientY - menuDragStart.y;
      contextMenu.style.left = (menuStartPos.x + dx) + 'px';
      contextMenu.style.top = (menuStartPos.y + dy) + 'px';
      contextMenuUserMoved = true;
    }

    function endDrag() {
      isDraggingMenu = false;
    }

    // Mouse events
    dragHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => { moveDrag(e.clientX, e.clientY); });
    document.addEventListener('mouseup', () => { if (isDraggingMenu) endDrag(); });

    // Touch events - directly on dragHandle to avoid conflicts with menu scroll
    dragHandle.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.touches[0];
      startDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    dragHandle.addEventListener('touchmove', function(e) {
      if (!isDraggingMenu) return;
      e.preventDefault();
      e.stopPropagation();
      const touch = e.touches[0];
      moveDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    dragHandle.addEventListener('touchend', function(e) {
      if (isDraggingMenu) {
        e.preventDefault();
        e.stopPropagation();
        endDrag();
      }
    }, { passive: false });
  })();

  // Context menu is now hidden by default; shown only on demand
  let contextMenuVisible = false;
  let contextMenuUserMoved = false; // Track if user manually moved the menu

  function updateContextMenuPosition() {
    // Only show if explicitly toggled on AND something is selected
    if (!contextMenuVisible) {
      hideContextMenu();
      contextMenuUserMoved = false;
      return;
    }
    // If user has manually moved the menu, keep it in place (just ensure it's visible)
    if (contextMenuUserMoved) {
      if (selectedItem || selectedRoom) {
        contextMenu.classList.remove('hidden');
        // Update line width and label controls visibility
        const labelControls = document.getElementById('ctx-label-controls');
        const lineWidthControls = document.getElementById('ctx-line-width-controls');
        if (selectedRoom) {
          labelControls.style.display = 'flex';
          document.getElementById('ctx-label-size-display').textContent = selectedRoom.labelFontSize || 13;
        } else {
          labelControls.style.display = 'none';
        }
        if (selectedItem && selectedItem.type === 'line') {
          lineWidthControls.style.display = 'flex';
          document.getElementById('ctx-line-width-display').textContent = selectedItem.lineWidth || 3;
        } else {
          lineWidthControls.style.display = 'none';
        }
      } else {
        hideContextMenu();
        contextMenuVisible = false;
        contextMenuUserMoved = false;
      }
      return;
    }
    const menuW = 130;
    const menuH = 220;
    if (selectedItem) {
      const canvasRect = canvas.parentElement.getBoundingClientRect();
      // Convert world coords to screen coords
      const screenLeft = selectedItem.x * viewScale + viewOffsetX;
      const screenTop = selectedItem.y * viewScale + viewOffsetY;
      const screenRight = (selectedItem.x + selectedItem.w) * viewScale + viewOffsetX;
      const screenBottom = (selectedItem.y + selectedItem.h) * viewScale + viewOffsetY;
      const screenCenterX = (screenLeft + screenRight) / 2;

      let finalX, finalY;

      // Try below with generous gap
      if (screenBottom + 30 + menuH < canvasRect.height) {
        finalX = screenCenterX - menuW / 2;
        finalY = screenBottom + 30;
      }
      // Try above
      else if (screenTop - menuH - 30 > 0) {
        finalX = screenCenterX - menuW / 2;
        finalY = screenTop - menuH - 30;
      }
      // Try to the left
      else if (screenLeft - menuW - 20 > 0) {
        finalX = screenLeft - menuW - 20;
        finalY = screenTop;
      }
      // Try to the right
      else {
        finalX = screenRight + 20;
        finalY = screenTop;
      }

      finalX = Math.max(5, Math.min(finalX, canvasRect.width - menuW - 5));
      finalY = Math.max(5, Math.min(finalY, canvasRect.height - menuH - 5));
      showContextMenu(finalX, finalY);
    } else if (selectedRoom) {
      const b = getRoomBounds(selectedRoom);
      const canvasRect = canvas.parentElement.getBoundingClientRect();
      // Convert world coords to screen coords
      const screenLeft = b.x * viewScale + viewOffsetX;
      const screenTop = b.y * viewScale + viewOffsetY;
      const screenRight = (b.x + b.w) * viewScale + viewOffsetX;
      const screenBottom = (b.y + b.h) * viewScale + viewOffsetY;

      let finalX = screenRight + 20;
      let finalY = screenTop;
      // If right side overflows, put on left
      if (finalX + menuW > canvasRect.width) finalX = screenLeft - menuW - 20;
      // If still overflow, put below
      if (finalX < 5) { finalX = (screenLeft + screenRight) / 2 - menuW / 2; finalY = screenBottom + 30; }
      finalX = Math.max(5, Math.min(finalX, canvasRect.width - menuW - 5));
      finalY = Math.max(5, Math.min(finalY, canvasRect.height - menuH - 5));
      showContextMenu(finalX, finalY);
    } else {
      hideContextMenu();
      contextMenuVisible = false;
    }
  }

  // Toggle context menu visibility (for the edit button and double-click)
  function toggleContextMenu() {
    if (selectedItem || selectedRoom) {
      contextMenuVisible = !contextMenuVisible;
      updateContextMenuPosition();
      updateEditBtnVisibility();
    }
  }

  // Update edit button visibility
  function updateEditBtnVisibility() {
    const editBtn = document.getElementById('btn-edit-item');
    if (editBtn) {
      editBtn.style.display = (selectedItem || selectedRoom) ? 'block' : 'none';
      editBtn.textContent = contextMenuVisible ? '✏️ 編集を閉じる' : '✏️ 編集';
    }
  }

  document.getElementById('ctx-rotate').addEventListener('click', () => {
    if (selectedItem) { saveState(); selectedItem.rotation = ((selectedItem.rotation||0) + 90) % 360; draw(); updateContextMenuPosition(); }
  });
  document.getElementById('ctx-flip-h').addEventListener('click', () => {
    if (selectedItem) { saveState(); selectedItem.flipH = !selectedItem.flipH; draw(); }
  });
  document.getElementById('ctx-flip-v').addEventListener('click', () => {
    if (selectedItem) { saveState(); selectedItem.flipV = !selectedItem.flipV; draw(); }
  });
  document.getElementById('ctx-resize-up').addEventListener('click', () => {
    if (selectedItem && selectedItem.type === 'text') {
      saveState();
      selectedItem.fontSize = (selectedItem.fontSize || 13) + 2;
      selectedItem.h = selectedItem.fontSize + 4;
      draw(); updateContextMenuPosition();
    } else if (selectedItem) { saveState(); selectedItem.w += gridSize; selectedItem.h += gridSize; draw(); updateContextMenuPosition(); }
    else if (selectedRoom) {
      saveState();
      const b = getRoomBounds(selectedRoom);
      const origPts = selectedRoom.points.map(p => ({...p}));
      const newB = { x: b.x - gridSize/2, y: b.y - gridSize/2, w: b.w + gridSize, h: b.h + gridSize };
      resizeRoomTo(selectedRoom, newB, b, origPts); draw(); updateContextMenuPosition();
    }
  });
  document.getElementById('ctx-resize-down').addEventListener('click', () => {
    if (selectedItem && selectedItem.type === 'text') {
      saveState();
      selectedItem.fontSize = Math.max(8, (selectedItem.fontSize || 13) - 2);
      selectedItem.h = selectedItem.fontSize + 4;
      draw(); updateContextMenuPosition();
    } else if (selectedItem) {
      saveState();
      if (selectedItem.w > gridSize) selectedItem.w -= gridSize;
      if (selectedItem.h > gridSize) selectedItem.h -= gridSize;
      draw(); updateContextMenuPosition();
    } else if (selectedRoom) {
      const b = getRoomBounds(selectedRoom);
      if (b.w > gridSize*2 && b.h > gridSize*2) {
        saveState();
        const origPts = selectedRoom.points.map(p => ({...p}));
        const newB = { x: b.x + gridSize/2, y: b.y + gridSize/2, w: b.w - gridSize, h: b.h - gridSize };
        resizeRoomTo(selectedRoom, newB, b, origPts); draw(); updateContextMenuPosition();
      }
    }
  });

  document.getElementById('ctx-hatch').addEventListener('click', () => {
    if (selectedRoom) {
      selectedRoom.hatching = !selectedRoom.hatching;
      draw();
    }
  });

  // Toggle edge visibility mode
  document.getElementById('ctx-toggle-edge').addEventListener('click', () => {
    if (selectedRoom) {
      edgeToggleMode = !edgeToggleMode;
      if (edgeToggleMode) {
        updateStatus('辺選択モード：部屋の辺をクリックで表示/非表示を切替。Escまたは再度ボタンで終了');
        canvas.style.cursor = 'crosshair';
      } else {
        updateStatus('辺選択モードを終了しました');
        canvas.style.cursor = 'default';
      }
      draw();
    }
  });

  // Color selection for items and rooms
  document.querySelectorAll('.ctx-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      if (selectedItem) {
        saveState();
        selectedItem.itemColor = color;
        draw();
      } else if (selectedRoom) {
        saveState();
        selectedRoom.lineColor = color;
        draw();
      }
    });
  });

  // Line width controls for line items
  document.getElementById('ctx-line-thin').addEventListener('click', () => {
    if (selectedItem && selectedItem.type === 'line') {
      saveState();
      selectedItem.lineWidth = Math.max(1, (selectedItem.lineWidth || 3) - 1);
      document.getElementById('ctx-line-width-display').textContent = selectedItem.lineWidth;
      draw();
    }
  });
  document.getElementById('ctx-line-thick').addEventListener('click', () => {
    if (selectedItem && selectedItem.type === 'line') {
      saveState();
      selectedItem.lineWidth = Math.min(20, (selectedItem.lineWidth || 3) + 1);
      document.getElementById('ctx-line-width-display').textContent = selectedItem.lineWidth;
      draw();
    }
  });

  // === Room label size & vertical toggle ===
  document.getElementById('ctx-label-size-up').addEventListener('click', () => {
    if (selectedRoom) {
      saveState();
      selectedRoom.labelFontSize = Math.min(48, (selectedRoom.labelFontSize || 13) + 2);
      document.getElementById('ctx-label-size-display').textContent = selectedRoom.labelFontSize;
      draw();
    }
  });
  document.getElementById('ctx-label-size-down').addEventListener('click', () => {
    if (selectedRoom) {
      saveState();
      selectedRoom.labelFontSize = Math.max(8, (selectedRoom.labelFontSize || 13) - 2);
      document.getElementById('ctx-label-size-display').textContent = selectedRoom.labelFontSize;
      draw();
    }
  });
  document.getElementById('ctx-label-vertical').addEventListener('click', () => {
    if (selectedRoom) {
      saveState();
      selectedRoom.labelVertical = !selectedRoom.labelVertical;
      draw();
    }
  });

  document.getElementById('ctx-rename').addEventListener('click', () => {
    if (selectedItem) {
      if (selectedItem.type && selectedItem.type.startsWith('rail-')) {
        // 手すりの場合は番号を変更
        const num = prompt('手すりの番号を入力してください', selectedItem.railNumber || '');
        if (num !== null) {
          selectedItem.railNumber = num;
          updateRailLegend();
          draw();
        }
      } else {
        const name = prompt('名称を入力してください', selectedItem.label || '');
        if (name !== null) { selectedItem.label = name; draw(); }
      }
    } else if (selectedRoom) {
      const name = prompt('新しい部屋名を入力してください', selectedRoom.label || '');
      if (name !== null) { selectedRoom.label = name; draw(); }
    }
  });

  // === Bring to front / Send to back ===
  document.getElementById('ctx-bring-front').addEventListener('click', () => {
    if (selectedItem) {
      saveState();
      items = items.filter(i => i !== selectedItem);
      items.push(selectedItem);
      draw();
    } else if (selectedRoom) {
      saveState();
      rooms = rooms.filter(r => r !== selectedRoom);
      rooms.push(selectedRoom);
      draw();
    }
  });
  document.getElementById('ctx-send-back').addEventListener('click', () => {
    if (selectedItem) {
      saveState();
      items = items.filter(i => i !== selectedItem);
      items.unshift(selectedItem);
      draw();
    } else if (selectedRoom) {
      saveState();
      rooms = rooms.filter(r => r !== selectedRoom);
      rooms.unshift(selectedRoom);
      draw();
    }
  });

  document.getElementById('ctx-duplicate').addEventListener('click', () => {
    if (selectedItem) {
      saveState();
      const copy = { ...selectedItem, x: selectedItem.x + gridSize, y: selectedItem.y + gridSize };
      items.push(copy); selectedItem = copy; draw(); updateContextMenuPosition();
    } else if (selectedRoom) {
      saveState();
      const copy = { points: selectedRoom.points.map(p => ({ x: p.x + gridSize*2, y: p.y + gridSize*2 })), color: selectedRoom.color, label: selectedRoom.label + '(複製)' };
      rooms.push(copy); selectedRoom = copy; draw(); updateContextMenuPosition();
    }
  });
  document.getElementById('ctx-delete').addEventListener('click', () => {
    saveState();
    if (selectedItem) { items = items.filter(i => i !== selectedItem); selectedItem = null; draw(); }
    else if (selectedRoom) { rooms = rooms.filter(r => r !== selectedRoom); selectedRoom = null; draw(); }
    contextMenuVisible = false;
    hideContextMenu();
    updateEditBtnVisibility();
  });

  // Edit button click handler
  document.getElementById('btn-edit-item').addEventListener('click', () => {
    toggleContextMenu();
  });

  // Context menu is hidden by default; opened by double-click or the edit button

  // === Keyboard shortcuts ===
  document.addEventListener('keydown', (e) => {
    // Space for panning
    if (e.key === ' ' && !e.repeat && !e.target.matches('input, textarea')) {
      e.preventDefault();
      spaceHeld = true;
      canvas.style.cursor = 'grab';
      return;
    }

    // Reset view with Ctrl+0
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      resetView();
      return;
    }

    // Undo/Redo
    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault(); undo(); return;
    }
    if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault(); redo(); return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); redo(); return;
    }

    if (e.key === 'Escape') {
      if (edgeToggleMode) { edgeToggleMode = false; canvas.style.cursor = 'default'; updateStatus('辺選択モードを終了しました'); draw(); return; }
      if (stampMode) { cancelStampMode(); return; }
      if (drawMode) { cancelDrawMode(); return; }
      if (rectMode) { cancelRectMode(); return; }
      if (lineMode) { cancelLineMode(); return; }
      // Deselect any selected item or room
      if (selectedItem || selectedRoom) {
        selectedItem = null;
        selectedRoom = null;
        contextMenuVisible = false;
        hideContextMenu();
        updateEditBtnVisibility();
        draw();
        updateStatus('選択を解除しました');
        return;
      }
    }

    // Tab key: cycle through overlapping items at the same position
    if (e.key === 'Tab' && !e.target.matches('input, textarea')) {
      e.preventDefault();
      if (selectedItem) {
        // Find all items that overlap with the selected item's bounding box
        const sel = selectedItem;
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        const overlapping = items.filter(it => {
          const ix = it.x, iy = it.y, iw = it.w, ih = it.h;
          // Check if centers are close or bounding boxes overlap
          return !(ix > sel.x + sel.w + gridSize || ix + iw < sel.x - gridSize ||
                   iy > sel.y + sel.h + gridSize || iy + ih < sel.y - gridSize);
        });
        if (overlapping.length > 1) {
          const currentIdx = overlapping.indexOf(selectedItem);
          const nextIdx = e.shiftKey
            ? (currentIdx - 1 + overlapping.length) % overlapping.length
            : (currentIdx + 1) % overlapping.length;
          selectedItem = overlapping[nextIdx];
          selectedRoom = null;
          draw();
          const label = selectedItem.label || (ITEM_DEFS[selectedItem.type] ? ITEM_DEFS[selectedItem.type].label : selectedItem.type) || '';
          updateStatus(`選択: ${label}（Tab で切替 ${nextIdx + 1}/${overlapping.length}）`);
        }
      }
      return;
    }

    if (selectedItem) {
      switch (e.key) {
        case 'Delete': case 'Backspace':
          saveState(); items = items.filter(i => i !== selectedItem); selectedItem = null; draw(); break;
        case 'r': case 'R':
          saveState(); selectedItem.rotation = ((selectedItem.rotation||0) + 90) % 360; draw(); break;
        case 'ArrowUp': e.preventDefault(); saveState(); selectedItem.y -= gridSize; draw(); break;
        case 'ArrowDown': e.preventDefault(); saveState(); selectedItem.y += gridSize; draw(); break;
        case 'ArrowLeft': e.preventDefault(); saveState(); selectedItem.x -= gridSize; draw(); break;
        case 'ArrowRight': e.preventDefault(); saveState(); selectedItem.x += gridSize; draw(); break;
      }
    } else if (selectedRoom) {
      switch (e.key) {
        case 'Delete': case 'Backspace':
          saveState(); rooms = rooms.filter(r => r !== selectedRoom); selectedRoom = null; draw(); break;
        case 'ArrowUp': e.preventDefault(); saveState(); moveRoom(selectedRoom, 0, -gridSize); draw(); break;
        case 'ArrowDown': e.preventDefault(); saveState(); moveRoom(selectedRoom, 0, gridSize); draw(); break;
        case 'ArrowLeft': e.preventDefault(); saveState(); moveRoom(selectedRoom, -gridSize, 0); draw(); break;
        case 'ArrowRight': e.preventDefault(); saveState(); moveRoom(selectedRoom, gridSize, 0); draw(); break;
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceHeld = false;
      if (!isPanning) {
        canvas.style.cursor = 'default';
      }
    }
  });

  // === Toolbar actions ===
  document.getElementById('btn-undo').addEventListener('click', () => { undo(); });
  document.getElementById('btn-redo').addEventListener('click', () => { redo(); });

  document.getElementById('btn-draw-room').addEventListener('click', () => {
    if (rectMode) cancelRectMode();
    if (drawMode) cancelDrawMode(); else startDrawMode();
  });
  document.getElementById('btn-rect-room').addEventListener('click', () => {
    if (drawMode) cancelDrawMode();
    if (lineMode) cancelLineMode();
    if (rectMode) cancelRectMode(); else startRectMode();
  });

  document.getElementById('btn-draw-line').addEventListener('click', () => {
    if (drawMode) cancelDrawMode();
    if (rectMode) cancelRectMode();
    if (lineMode) cancelLineMode(); else startLineMode();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const data = JSON.stringify({ gridSize, items, rooms }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'floorplan.json'; a.click();
    URL.revokeObjectURL(url);
    updateStatus('平面図を保存しました');
    showPenguinMessage();
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.items) items = data.items;
        if (data.rooms) rooms = data.rooms;
        if (data.gridSize) { gridSize = data.gridSize; document.getElementById('grid-size').value = gridSize; }
        selectedItem = null; selectedRoom = null; draw();
        updateStatus('平面図を読み込みました');
      } catch (err) { updateStatus('読み込みに失敗しました'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    // Auto-backup: save JSON to LocalStorage before PDF export
    autoBackupBeforePDF();

    // Export as PDF - render everything including Japanese text onto a temp canvas, then embed as image
    // Temporarily deselect everything so selection highlights/dashes don't appear in PDF
    // Also hide background image from PDF
    const prevSelectedItem = selectedItem;
    const prevSelectedRoom = selectedRoom;
    selectedItem = null;
    selectedRoom = null;
    canvas._pdfExporting = true;
    // Save current view
    const prevScale = viewScale;
    const prevOffsetX = viewOffsetX;
    const prevOffsetY = viewOffsetY;

    // Calculate bounding box of all content (rooms + items)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const room of rooms) {
      for (const p of room.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    for (const item of items) {
      const ix = item.x, iy = item.y;
      const iw = item.w || 0, ih = item.h || 0;
      if (ix < minX) minX = ix;
      if (iy < minY) minY = iy;
      if (ix + iw > maxX) maxX = ix + iw;
      if (iy + ih > maxY) maxY = iy + ih;
    }

    // If no content, use default view
    if (!isFinite(minX)) {
      minX = 0; minY = 0; maxX = canvas.width; maxY = canvas.height;
    }

    // Add padding around content
    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const contentW = maxX - minX;
    const contentH = maxY - minY;

    // High-resolution rendering for crisp PDF output
    const hiresScale = 2;

    // Temporarily resize canvas to high resolution for sharp rendering
    const origCanvasW = canvas.width;
    const origCanvasH = canvas.height;
    canvas.width = origCanvasW * hiresScale;
    canvas.height = origCanvasH * hiresScale;

    // Fit content to high-res canvas
    const fitScaleX = canvas.width / contentW;
    const fitScaleY = canvas.height / contentH;
    viewScale = Math.min(fitScaleX, fitScaleY);
    viewOffsetX = -minX * viewScale + (canvas.width - contentW * viewScale) / 2;
    viewOffsetY = -minY * viewScale + (canvas.height - contentH * viewScale) / 2;

    draw();

    const userName = document.getElementById('user-name').value || '';
    const userZip = document.getElementById('user-zip').value || '';
    const userAddress = document.getElementById('user-address').value || '';
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`;

    // Create temp canvas with header info + floor plan
    const margin = 60;
    const headerH = 80;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width + margin * 2 * hiresScale;
    tempCanvas.height = canvas.height + headerH * hiresScale + margin * 2 * hiresScale;
    const tCtx = tempCanvas.getContext('2d');

    // White background
    tCtx.fillStyle = '#fff';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Scale text rendering for hi-res
    tCtx.save();
    tCtx.scale(hiresScale, hiresScale);
    const logicalW = tempCanvas.width / hiresScale;
    const logicalH = tempCanvas.height / hiresScale;

    // Title (right side of header)
    tCtx.fillStyle = '#000';
    tCtx.font = 'bold 24px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.textAlign = 'right';
    tCtx.fillText('平面図', logicalW - 60, 36);

    // User info (top-left)
    tCtx.font = 'bold 16px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.textAlign = 'left';
    tCtx.fillStyle = '#000';
    let infoY = 30;
    if (userName) { tCtx.fillText(`名前: ${userName}`, 60, infoY); infoY += 22; }
    if (userZip) { tCtx.fillText(`〒 ${userZip}`, 60, infoY); infoY += 22; }
    if (userAddress) { tCtx.fillText(`住所: ${userAddress}`, 60, infoY); infoY += 22; }

    // 記入欄の内容 (center of header, wraps to next column if too many lines)
    if (railLegendText) {
      tCtx.textAlign = 'left';
      tCtx.font = 'bold 16px "Hiragino Sans", "Meiryo", sans-serif';
      tCtx.fillStyle = '#e94560';
      const legendStartX = logicalW * 0.35;
      const columnWidth = logicalW * 0.2;
      const maxLinesPerColumn = 3;
      const lineHeight = 22;
      let col = 0;
      let row = 0;
      const lines = railLegendText.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          const lx = legendStartX + col * columnWidth;
          const ly = 30 + row * lineHeight;
          tCtx.fillText(line, lx, ly);
          row++;
          if (row >= maxLinesPerColumn) {
            row = 0;
            col++;
          }
        }
      });
      tCtx.fillStyle = '#000';
    }

    // Date (top-right, below title)
    tCtx.textAlign = 'right';
    tCtx.font = '13px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.fillStyle = '#000';
    tCtx.fillText(`作成日: ${dateStr}`, logicalW - 60, 56);

    // Draw the floor plan canvas (high-res)
    tCtx.restore(); // Undo the scale for drawing the image at native resolution
    tCtx.drawImage(canvas, margin * hiresScale, headerH * hiresScale);

    // Border around the plan (at hi-res pixel coords)
    tCtx.strokeStyle = '#999';
    tCtx.lineWidth = 2;
    tCtx.strokeRect(margin * hiresScale, headerH * hiresScale, canvas.width, canvas.height);

    // Generate PDF using jsPDF with image
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const imgData = tempCanvas.toDataURL('image/jpeg', 0.92);
    // A4 landscape: 297 x 210 mm
    // Use uniform margins on all sides for clean centering
    const pdfPageW = 297;
    const pdfPageH = 210;
    const pdfMargin = 5; // mm margin on each side
    const availW = pdfPageW - pdfMargin * 2;
    const availH = pdfPageH - pdfMargin * 2;

    // Fit image to available area while maintaining aspect ratio
    const imgAspect = tempCanvas.width / tempCanvas.height;
    const availAspect = availW / availH;
    let finalW, finalH;
    if (imgAspect > availAspect) {
      finalW = availW;
      finalH = availW / imgAspect;
    } else {
      finalH = availH;
      finalW = availH * imgAspect;
    }

    // Center on page
    const imgX = (pdfPageW - finalW) / 2;
    const imgY = (pdfPageH - finalH) / 2;

    pdf.addImage(imgData, 'JPEG', imgX, imgY, finalW, finalH);
    pdf.save('floorplan.pdf');

    // Restore canvas size and view transform
    canvas.width = origCanvasW;
    canvas.height = origCanvasH;
    canvas._pdfExporting = false;
    viewScale = prevScale;
    viewOffsetX = prevOffsetX;
    viewOffsetY = prevOffsetY;
    selectedItem = prevSelectedItem;
    selectedRoom = prevSelectedRoom;
    draw();

    updateStatus('PDFを書き出しました');
    showPenguinMessage();
  });

  // === PDF export with current zoom/pan (拡大表示のままPDF化) ===
  document.getElementById('btn-export-zoom').addEventListener('click', () => {
    // Auto-backup: save JSON to LocalStorage before PDF export
    autoBackupBeforePDF();

    const prevSelectedItem = selectedItem;
    const prevSelectedRoom = selectedRoom;
    selectedItem = null;
    selectedRoom = null;
    canvas._pdfExporting = true;

    // High-res rendering: scale up canvas
    const hiresScale = 2;
    const origCanvasW = canvas.width;
    const origCanvasH = canvas.height;
    const prevScale = viewScale;
    const prevOffsetX = viewOffsetX;
    const prevOffsetY = viewOffsetY;

    canvas.width = origCanvasW * hiresScale;
    canvas.height = origCanvasH * hiresScale;
    viewScale = prevScale * hiresScale;
    viewOffsetX = prevOffsetX * hiresScale;
    viewOffsetY = prevOffsetY * hiresScale;
    draw();

    const userName = document.getElementById('user-name').value || '';
    const userZip = document.getElementById('user-zip').value || '';
    const userAddress = document.getElementById('user-address').value || '';
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`;

    const margin = 60;
    const headerH = 80;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width + margin * 2 * hiresScale;
    tempCanvas.height = canvas.height + headerH * hiresScale + margin * 2 * hiresScale;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.fillStyle = '#fff';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Scale for text rendering
    tCtx.save();
    tCtx.scale(hiresScale, hiresScale);
    const logicalW = tempCanvas.width / hiresScale;
    const logicalH = tempCanvas.height / hiresScale;

    tCtx.fillStyle = '#000';
    tCtx.font = 'bold 24px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.textAlign = 'right';
    tCtx.fillText(`平面図 (${Math.round(prevScale * 100)}%)`, logicalW - margin, 36);

    tCtx.font = 'bold 16px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.textAlign = 'left';
    tCtx.fillStyle = '#000';
    let infoY = 30;
    if (userName) { tCtx.fillText(`名前: ${userName}`, margin, infoY); infoY += 22; }
    if (userZip) { tCtx.fillText(`〒 ${userZip}`, margin, infoY); infoY += 22; }
    if (userAddress) { tCtx.fillText(`住所: ${userAddress}`, margin, infoY); infoY += 22; }

    if (railLegendText) {
      tCtx.textAlign = 'left';
      tCtx.font = 'bold 16px "Hiragino Sans", "Meiryo", sans-serif';
      tCtx.fillStyle = '#e94560';
      const legendStartX = logicalW * 0.35;
      const columnWidth = logicalW * 0.2;
      const maxLinesPerColumn = 3;
      const lineHeight = 22;
      let col = 0;
      let row = 0;
      const lines = railLegendText.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          const lx = legendStartX + col * columnWidth;
          const ly = 30 + row * lineHeight;
          tCtx.fillText(line, lx, ly);
          row++;
          if (row >= maxLinesPerColumn) { row = 0; col++; }
        }
      });
      tCtx.fillStyle = '#000';
    }

    tCtx.textAlign = 'right';
    tCtx.font = '13px "Hiragino Sans", "Meiryo", sans-serif';
    tCtx.fillStyle = '#000';
    tCtx.fillText(`作成日: ${dateStr}`, logicalW - margin, 56);
    tCtx.restore();

    // Draw high-res canvas
    tCtx.drawImage(canvas, margin * hiresScale, headerH * hiresScale);

    tCtx.strokeStyle = '#999';
    tCtx.lineWidth = 2;
    tCtx.strokeRect(margin * hiresScale, headerH * hiresScale, canvas.width, canvas.height);

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const imgData = tempCanvas.toDataURL('image/jpeg', 0.92);
    // A4 landscape: 297 x 210 mm - uniform centering
    const pdfPageW = 297;
    const pdfPageH = 210;
    const pdfMargin = 5;
    const availW = pdfPageW - pdfMargin * 2;
    const availH = pdfPageH - pdfMargin * 2;
    const imgAspect = tempCanvas.width / tempCanvas.height;
    const availAspect = availW / availH;
    let finalW, finalH;
    if (imgAspect > availAspect) {
      finalW = availW;
      finalH = availW / imgAspect;
    } else {
      finalH = availH;
      finalW = availH * imgAspect;
    }
    const imgX = (pdfPageW - finalW) / 2;
    const imgY = (pdfPageH - finalH) / 2;

    pdf.addImage(imgData, 'JPEG', imgX, imgY, finalW, finalH);
    pdf.save('floorplan_zoomed.pdf');

    // Restore canvas size and view
    canvas.width = origCanvasW;
    canvas.height = origCanvasH;
    canvas._pdfExporting = false;
    viewScale = prevScale;
    viewOffsetX = prevOffsetX;
    viewOffsetY = prevOffsetY;
    selectedItem = prevSelectedItem;
    selectedRoom = prevSelectedRoom;
    draw();

    updateStatus(`PDF（${Math.round(prevScale * 100)}%表示）を書き出しました`);
    showPenguinMessage();
  });

  // === Zoom (view transform) ===
  function zoomView(factor) {
    const oldScale = viewScale;
    viewScale *= factor;
    viewScale = Math.max(0.25, Math.min(viewScale, 5)); // Clamp 25%-500%
    const actualFactor = viewScale / oldScale;
    // Zoom towards center of canvas
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    viewOffsetX = cx - (cx - viewOffsetX) * actualFactor;
    viewOffsetY = cy - (cy - viewOffsetY) * actualFactor;
    draw();
    updateStatus(`表示倍率: ${Math.round(viewScale * 100)}%`);
  }

  function resetView() {
    viewScale = 1;
    viewOffsetX = 0;
    viewOffsetY = 0;
    draw();
    updateStatus('表示をリセットしました');
  }

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    zoomView(1.25);
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    zoomView(1 / 1.25);
  });
  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    resetView();
  });

  // Pan buttons (move view by 100px in each direction)
  const PAN_STEP = 100;
  document.getElementById('btn-pan-left').addEventListener('click', () => {
    viewOffsetX += PAN_STEP; draw();
  });
  document.getElementById('btn-pan-right').addEventListener('click', () => {
    viewOffsetX -= PAN_STEP; draw();
  });
  document.getElementById('btn-pan-up').addEventListener('click', () => {
    viewOffsetY += PAN_STEP; draw();
  });
  document.getElementById('btn-pan-down').addEventListener('click', () => {
    viewOffsetY -= PAN_STEP; draw();
  });

  // Mouse wheel zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const oldScale = viewScale;
    viewScale *= factor;
    viewScale = Math.max(0.25, Math.min(viewScale, 5));
    const actualFactor = viewScale / oldScale;
    // Zoom towards mouse position
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    viewOffsetX = mx - (mx - viewOffsetX) * actualFactor;
    viewOffsetY = my - (my - viewOffsetY) * actualFactor;
    draw();
  }, { passive: false });

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('平面図を全て消去しますか？')) {
      items = []; rooms = []; selectedItem = null; selectedRoom = null; draw();
      updateStatus('全消去しました');
    }
  });

  // === Background image (下絵) ===
  let bgImage = null;
  let bgOpacity = 0.3;
  let bgVisible = true;
  let bgRotation = 0; // 0, 90, 180, 270

  document.getElementById('btn-bg-image').addEventListener('click', () => {
    document.getElementById('bg-image-input').click();
  });

  document.getElementById('bg-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      // PDF読み込み: 最初のページを画像に変換
      const reader = new FileReader();
      reader.onload = (ev) => {
        const typedArray = new Uint8Array(ev.target.result);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        pdfjsLib.getDocument(typedArray).promise.then(pdf => {
          pdf.getPage(1).then(page => {
            const scale = 2;
            const viewport = page.getViewport({ scale });
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = viewport.width;
            tmpCanvas.height = viewport.height;
            const tmpCtx = tmpCanvas.getContext('2d');
            page.render({ canvasContext: tmpCtx, viewport }).promise.then(() => {
              const img = new Image();
              img.onload = () => {
                bgImage = img;
                document.getElementById('bg-controls').style.display = 'block';
                draw();
                updateStatus('PDFを下絵として読み込みました。');
              };
              img.src = tmpCanvas.toDataURL();
            });
          });
        }).catch(() => {
          updateStatus('PDFの読み込みに失敗しました');
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      // 画像ファイル読み込み
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          bgImage = img;
          document.getElementById('bg-controls').style.display = 'block';
          draw();
          updateStatus('下絵を読み込みました。上からなぞって図面を描いてください。');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  });

  document.getElementById('bg-opacity').addEventListener('input', (e) => {
    bgOpacity = parseInt(e.target.value) / 100;
    draw();
  });

  document.getElementById('btn-bg-toggle').addEventListener('click', () => {
    bgVisible = !bgVisible;
    draw();
    updateStatus(bgVisible ? '下絵を表示しました' : '下絵を非表示にしました');
  });

  document.getElementById('btn-bg-rotate').addEventListener('click', () => {
    bgRotation = (bgRotation + 90) % 360;
    draw();
    updateStatus(`下絵を${bgRotation}°回転しました`);
  });

  document.getElementById('btn-bg-remove').addEventListener('click', () => {
    bgImage = null;
    bgRotation = 0;
    document.getElementById('bg-controls').style.display = 'none';
    draw();
    updateStatus('下絵を削除しました');
  });

  // === Settings ===
  document.getElementById('chk-grid').addEventListener('change', (e) => { showGrid = e.target.checked; draw(); });
  document.getElementById('chk-snap').addEventListener('change', (e) => { snapToGrid = e.target.checked; });
  document.getElementById('grid-size').addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (val >= 10 && val <= 100) { gridSize = val; draw(); }
  });

  function updateStatus(msg) { document.getElementById('status-info').textContent = msg; }

  // Store legend text globally so it persists
  let railLegendText = localStorage.getItem('floorplan-legend-text') || '';

  function updateRailLegend() {
    const legend = document.getElementById('rail-legend');
    const rails = items.filter(it => it.type && it.type.startsWith('rail-') && it.railNumber);

    // If a new rail was added, append it to the text
    if (rails.length > 0) {
      const circledNums = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
      const labelMap = { 'rail-h': '横手すり', 'rail-v': '縦手すり', 'rail-l': 'L字手すり' };
      const sizeMap = { 'rail-h': 'L≒', 'rail-v': 'L≒', 'rail-l': 'L≒　×' };
      rails.forEach(r => {
        if (!r.legendText) {
          const numIdx = parseInt(r.railNumber) - 1;
          const circled = (numIdx >= 0 && numIdx < circledNums.length) ? circledNums[numIdx] : r.railNumber;
          const name = labelMap[r.type] || r.label;
          const size = sizeMap[r.type] || 'L≒';
          const newLine = `${circled} ${name}　${size}`;
          r.legendText = newLine;
          if (!railLegendText.includes(newLine)) {
            railLegendText += (railLegendText ? '\n' : '') + newLine;
          }
        }
      });
    }

    // Always show the textarea (記入欄)
    legend.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;color:#333;">記入欄</div>';
    const textarea = document.createElement('textarea');
    textarea.className = 'rail-legend-textarea';
    textarea.value = railLegendText;
    textarea.placeholder = '自由に記入できます';
    textarea.rows = Math.max(4, railLegendText.split('\n').length + 1);
    textarea.addEventListener('input', () => {
      railLegendText = textarea.value;
      localStorage.setItem('floorplan-legend-text', railLegendText);
    });
    legend.appendChild(textarea);
  }

  // === Season auto-detection (automatic, no manual switch) ===
  function getCurrentSeason() {
    const month = new Date().getMonth(); // 0-11
    if (month >= 2 && month <= 4) return 'spring';   // 3-5月
    if (month >= 5 && month <= 7) return 'summer';   // 6-8月
    if (month >= 8 && month <= 10) return 'autumn';  // 9-11月
    return 'winter'; // 12-2月
  }

  const currentSeason = getCurrentSeason();
  document.documentElement.setAttribute('data-season', currentSeason);

  // === Penguin toggle ===
  let penguinEnabled = localStorage.getItem('floorplan-penguin') !== 'off';
  const penguinCheckbox = document.getElementById('chk-penguin');
  penguinCheckbox.checked = penguinEnabled;
  penguinCheckbox.addEventListener('change', () => {
    penguinEnabled = penguinCheckbox.checked;
    localStorage.setItem('floorplan-penguin', penguinEnabled ? 'on' : 'off');
  });

  // === Penguin mascot messages ===
  const penguinMessages = {
    spring: [
      'お疲れさまです🌸 素敵な図面ですね！',
      '桜の季節に新しいお家、わくわくしますね🌷',
      '保存できました！ゆっくり休んでくださいね🌸',
      'いい感じ！春の風が吹いてきそうなお部屋ですね🦋',
      '窓を開けたら花の香りがしそう…🌸',
      'この間取り、なんだか春の訪れを感じます🌱',
      '新生活にぴったりのお部屋！応援してます📦',
      '豆知識：桜の花びらは毎年同じ木でも微妙に色が違うんですよ🌸',
      '…ペンギンも、いつかこんなお部屋に住みたいな🐧',
      'すべての部屋には物語がある。あなたはその作者です📖',
      'コツコツ頑張ってますね！その丁寧さ、図面に表れてます✨',
      'ひとつひとつ積み重ねてきた成果ですね。すごい！🌸',
      '今日もお疲れさま。あなたの頑張りにペンギン感動してます🐧💕',
      'ここまで作り込めるの、本当にすごいことですよ🌷',
      '細かいところまで気配りが行き届いていて感心します！',
      '休憩も大切に。お茶でも飲んでリフレッシュしてくださいね🍵',
      'こんなに丁寧な図面、住む人はきっと幸せですね🏠🌸',
      'あなたの努力は確実に形になっています。自信を持って！💪',
      '春は始まりの季節。新しい暮らしの第一歩を応援します🌱',
      '疲れた時は深呼吸。桜の香りをイメージしてみて🌸',
      'ペンギン、あなたの真剣な姿に惚れそうです…🐧💕',
      '春眠暁を覚えず…でも、あなたの図面は目が覚める出来です！',
      '花粉に負けず頑張ってますね！立派です🌼',
      'このお部屋に住んだら毎朝笑顔で起きられそう☀️',
      'あなたの設計力、めきめき上達してますよ📐✨',
      '菜の花畑みたいに明るい間取りですね🌼',
      '入学式のような、新鮮な気持ちになる図面です🎒',
      'つくしが顔を出すように、良いアイデアが次々と！🌱',
      'ペンギン予報：この図面、完成したら最高のお部屋になります🐧',
      '一生懸命って美しい。あなたを見てるとそう思います✨',
      'ここまで来たらもうちょっと！一緒に頑張りましょ🌸',
      '春風のように爽やかな動線設計ですね🌬️',
      '大変な作業も、あなたなら乗り越えられます💪🌷',
      'ペンギンの推し、あなたに決定しました🐧⭐',
      'ミモザの花言葉は「感謝」。あなたにぴったり🌼',
      'この間取り…天才では？🐧✨',
      '頑張り屋さんのあなたに、ペンギンからハイタッチ🐧🖐️',
      'いつの間にかこんなに作り上げて…成長がすごい！🌱',
      '満開の桜のように、図面も花盛りですね🌸🌸',
      '少し休憩して、また元気に戻ってきてください🐧☕',
      'あなたの図面を見ると、未来のお家が見えます🏡✨',
      '心を込めて作ってるのが伝わります。素敵です🌷',
      'ペンギンも応援団として全力で応援中📣🐧',
      '春の陽だまりみたいに、あったかい図面ですね☀️',
      'ここまで集中できるの、才能ですよ！🌸',
      '図面作り、楽しんでますか？楽しいのが一番！🐧🎵',
      '桜吹雪のように華やかな仕上がりですね🌸✨',
      'あなたの丁寧な仕事ぶり、ペンギン尊敬してます🐧🙏',
      '完成まであと少し！最後まで一緒に歩きましょう🌸🐧',
      'ペンギンからの伝言：「あなたは十分がんばっています」🐧💌',
    ],
    summer: [
      'お疲れさまです🍉 水分補給してくださいね！',
      '素敵な間取り！涼しいお部屋になりそう🌊',
      '保存完了！アイス食べて休憩しましょ🍦',
      '暑い中お疲れさま！エアコンの位置もバッチリ🌻',
      '風通しの良さそうな間取りですね🌬️',
      '夏の夜、この部屋で花火が見えたらいいな🎆',
      '豆知識：南向きの窓は冬に暖かく、夏は庇で日差しを防げます☀️',
      '豆知識：日本の住宅の平均寿命は約30年。大切に設計しましょう🏠',
      '…海の向こうに何があるか、考えたことありますか？🌊',
      'いい図面は、そこに住む人の笑顔を設計すること😊',
      '蝉の声が聞こえてきそうなお部屋ですね🌳',
      '暑い中よく頑張りましたね！今日のあなたは最高です🏖️',
      '集中力すごい！熱中症だけは気をつけてくださいね💧',
      'こまめに休憩とってますか？ 体も大事にしてくださいね🍹',
      '夏の暑さに負けない、あなたの情熱に脱帽です🌞',
      'エアコンの効いた部屋で図面作業…最高ですね🐧❄️',
      'ペンギンは寒いところが好きだけど、あなたの温かい図面も好きです💙',
      'ここまで細かく作れるなんて…プロ級ですよ！🏄',
      '一歩ずつ着実に進んでますね。その調子です！🌈',
      'この図面を見てると、住みたくなっちゃいます🏡',
      '朝顔みたいに、毎日ぐんぐん成長してますね🌺',
      'かき氷食べたい…じゃなくて、いい図面ですね！🍧',
      'ペンギン的にはこの図面、星5つです⭐⭐⭐⭐⭐',
      '入道雲みたいにモクモクとアイデアが湧いてますね☁️',
      '夏祭りの夜みたいに、わくわくする間取りです🏮',
      '汗水たらして頑張ったぶん、いい図面になりましたね💦✨',
      'ペンギンもプールに入りたい…あ、図面に集中します🐧🏊',
      'ひまわりみたいに、明るい気持ちになる図面ですね🌻',
      '夏バテしてませんか？ちゃんとごはん食べてくださいね🍚',
      'あなたの図面は、真夏の太陽みたいにキラキラしてます☀️✨',
      '麦茶でも飲んで、ほっと一息つきましょう🍵',
      'この部屋なら、夏の夜もぐっすり眠れそうですね🌙',
      '努力は裏切らない！ペンギン保証します🐧📜',
      '花火大会に負けない、華やかな図面ですね🎇',
      'そうめんみたいにスルスル作業が進んでますね🍜✨',
      'あなたの集中力、真夏の陽射しよりアツい！🔥',
      '海辺の別荘みたいな素敵な設計ですね🏖️',
      'あなたの図面力、この夏でかなり上達しましたね📈',
      '暑さも吹き飛ぶ、クールな間取りです😎',
      'ペンギンから夏のギフト：応援の気持ちをどうぞ🐧🎁',
      'あなたの丁寧さ、夏の清流みたいに気持ちいいです🏞️',
      'がんばるあなたにペンギン特製かき氷あげたい🍧🐧',
      '七夕の願い事：あなたの図面が最高の家になりますように🎋',
      'まだまだ暑い日が続くけど、あなたなら大丈夫！🌊💪',
      '今日も一日お疲れさま。ペンギンが癒しをお届けします🐧💕',
      'あなたの努力に、満天の星空を贈ります🌌✨',
      'スイカの種飛ばし大会…じゃなくて、いい出来です🍉😂',
    ],
    autumn: [
      'お疲れさまです🍁 いい図面ですね！',
      '秋の夜長に図面づくり、素敵ですね🌙',
      '保存しました！温かいお茶でもどうぞ🍵',
      'いい感じ！落ち着いた空間になりそう🍂',
      '読書コーナーがあると秋の夜長が楽しいですよ📚',
      '豆知識：畳1枚は約1.62㎡。6畳は約9.72㎡です🏠',
      '豆知識：日本では北側に水回りを配置する習慣がありますよ💧',
      '…紅葉って、なぜ終わりなのにあんなに美しいんでしょうね🍁',
      '家は3回建てないと理想にならない、とよく言いますが…あなたの図面は1回で素敵です✨',
      '食欲の秋！キッチンが広いと料理がはかどりますね🍳',
      '月が綺麗ですね…ってこれ意味深すぎました？🌕',
      'じっくり取り組んでいる姿、本当に素敵です🍂✨',
      '少しずつでも前に進んでいること、それが大切です🌙',
      'あなたの図面には"住む人への思いやり"が詰まっていますね🍁',
      '実りの秋ですね。あなたの努力も実を結びますよ🌰',
      '今日もよく頑張りました！自分を褒めてあげてください🎃',
      '焦らなくて大丈夫。いいものは時間をかけて生まれるもの📐',
      'ペンギン的にはこの間取り、100点満点です💯🐧',
      'こんな素敵な空間を考えられるって才能ですよ！🍁',
      '秋風に吹かれながら一息つきましょう。よく頑張ったね🍵',
      '芸術の秋！あなたの図面もまさにアートです🎨',
      '栗ご飯食べたい…あ、それより図面の話！🌰😋',
      '紅葉のグラデーションみたいに美しい動線ですね🍁',
      'コスモスのように可憐で素敵な設計です🌸',
      'お月見団子みたいにまるく収まった間取り🍡🌕',
      'あなたの図面を見てると心が落ち着きます🍂☕',
      'ペンギンの読書感想文：「この図面、とても良い」🐧📝',
      '金木犀の香りがしそうな、優しい空間ですね🧡',
      '今夜は十五夜。あなたの努力にお月さまも拍手してます🌕👏',
      '落ち葉を踏む音みたいに、心地よいリズムの図面ですね🍂',
      '運動の秋…じゃなくて設計の秋ですね！📐🍁',
      'さつまいも…いやいや、さすがの出来栄えです！🍠✨',
      'あなたの努力は枯れ葉じゃなくて常緑樹🌲ずっと輝いてる',
      'ハロウィンのお菓子より甘い、素敵な間取り🎃🍬',
      '銀杏並木みたいに真っ直ぐで美しい壁線ですね🌳',
      '焼き芋みたいにホクホクする出来栄え🍠😊',
      'あなたの真剣な表情、ペンギンこっそり見てます🐧👀',
      'いい意味で「沼」ですね。図面沼にハマってる！🍂',
      'ペンギン紅葉狩り行きたいけど、あなたの図面見るほうが楽しい🐧🍁',
      'トンボみたいにスイスイ作業が進んでますね🪻',
      '味覚の秋、あなたの図面は「旨味」があります😋',
      'ペンギンの推し活：あなたの図面づくりを見守ること🐧📣',
      '秋は夕暮れ。あなたの図面は黄金色に輝いています🌅',
      'どんぐりを拾うように、いいアイデアを集めてますね🌰✨',
      '今日のあなた、ちょっとカッコいいですよ🍁😎',
      'ペンギンの名言：「休憩してる時も、脳は働いてる」🐧💡',
      '深まる秋のように、あなたの実力も深まっています🍂📐',
    ],
    winter: [
      'お疲れさまです❄️ 暖かくしてますか？',
      '素敵な図面！あったかいお家になりそう⛄',
      '保存完了！ココアでも飲んで温まってね☕',
      'いい感じ！冬でもぽかぽかのお部屋ですね🎄',
      '断熱性能、大事ですよ！あったか設計🧣',
      '豆知識：窓の断熱性能はU値で測ります。低いほど高性能🪟',
      '豆知識：床暖房は低温やけどに注意。でも足元あったかい幸せ…🦶',
      '…雪が降ると世界が静かになる。そんな部屋もいいですね❄️',
      'この図面を見ていると…なぜだか温かい気持ちになります🐧',
      '冬至を過ぎれば日は長くなる。どんな時も、明るい未来は来ます☀️',
      'あなたが作る家に、いつか誰かの幸せな記憶が刻まれます🏠',
      '寒い中お疲れさま！手がかじかんでませんか？🧤',
      'ここまで完成させたのすごい！ペンギン拍手してます👏🐧',
      'あなたの粘り強さ、見習いたいです。本当にお疲れさま❄️',
      '温かいお部屋の設計は、住む人への最高のプレゼント🎁',
      'がんばり屋さんですね。でも無理しすぎないでくださいね⛄',
      '今日の成果を明日の自分が褒めてくれますよ🌟',
      'ペンギンは寒さに強いけど、あなたの優しさにはかないません💙',
      '冬空の下でも、あなたの図面には温もりがあります🏠❄️',
      'よくここまで！完成が楽しみですね。一緒に頑張りましょう⛄💪',
      'こたつでみかん食べたい…いや、あなたの図面を褒めたい🍊🐧',
      '雪の結晶みたいに繊細な設計ですね❄️✨',
      'ペンギンサンタからのプレゼント：あなたへの「お疲れさま」🎅🐧',
      '暖炉のある部屋って憧れますね…この図面も最高！🔥',
      'お鍋が似合いそうなキッチン！冬の醍醐味ですね🍲',
      'ペンギンは雪の上が得意ですが、図面は苦手…あなたすごい🐧📐',
      '冬のキリッとした空気みたいに、引き締まった図面です❄️',
      'もうすぐ春が来る…その前にこの図面を完成させましょう！🌸',
      'あなたの集中力は氷のように揺るがないですね🧊✨',
      '温泉に入りたい…あ、この浴室設計いいですね♨️🐧',
      'イルミネーションみたいにキラキラした間取りです🎄✨',
      '鍋焼きうどんみたいに、あったか〜い気持ちになる図面🍜',
      'ペンギン占い：今日のあなたのラッキーアイテムは「いい図面」🐧🔮',
      '雪だるま作りたいけど、あなたの図面見てるほうが楽しい⛄🐧',
      '湯たんぽみたいにじんわり温かい空間設計ですね🫖',
      'お年玉代わりに、ペンギンからのエールをどうぞ🐧🧧',
      '冬の星空みたいに澄んだ美しい図面ですね⭐',
      'マフラー巻いてあげたい…あなたの首が冷えてないか心配🐧🧣',
      'あなたの図面を見ると、冬でもぽかぽかになります🏠💕',
      'ホットチョコレートみたいに甘くて温かい設計…☕😊',
      'ペンギン日記：今日もあの人が頑張ってた。えらい。🐧📔',
      'クリスマスケーキより豪華な図面ですね🎂✨',
      '年末に向けて追い込み！ペンギンも全力応援です📣🐧',
      '冬ごもりにぴったりのお部屋。ペンギンも住みたい🐧🏠',
      'お正月にはこの図面を家族に見せましょう！きっと喜ばれます🎍',
      '粉雪のように軽やかに作業が進んでますね❄️🎵',
      'あなたの図面は、寒い冬を忘れさせてくれます🐧☀️',
      'この冬一番の力作ですね。ペンギン太鼓判です🐧👍❄️',
    ],
  };

  function showPenguinMessage() {
    if (!penguinEnabled) return;
    const season = document.documentElement.getAttribute('data-season') || 'spring';
    const msgs = penguinMessages[season];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'penguin-overlay';
    overlay.innerHTML = `
      <div class="penguin-dialog">
        <div class="penguin-character">🐧</div>
        <div class="penguin-bubble">
          <p>${msg}</p>
        </div>
        <button class="penguin-close">ありがとう！</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close on button or overlay click
    overlay.querySelector('.penguin-close').addEventListener('click', () => {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 300);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 300);
      }
    });
  }

  // === Saved plans (localStorage) ===
  const STORAGE_KEY = 'floorplan-saved-plans';

  function getSavedPlans() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
  }

  function savePlansList(plans) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }

  function renderSavedPlans() {
    const list = document.getElementById('saved-plans-list');
    const plans = getSavedPlans();
    list.innerHTML = '';
    if (plans.length === 0) {
      list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-light);padding:4px 0;">保存された図面はありません</div>';
    } else {
      plans.forEach((plan, idx) => {
        const el = document.createElement('div');
        el.className = 'saved-plan-item';
        el.innerHTML = `<span class="plan-name" title="${plan.name}">${plan.name}</span><span class="plan-date">${plan.date}</span><button class="plan-delete" title="削除">×</button>`;
        el.querySelector('.plan-name').addEventListener('click', () => {
          if (confirm(`「${plan.name}」を読み込みますか？\n（現在の図面は上書きされます）`)) {
            loadPlanData(plan.data);
            updateStatus(`「${plan.name}」を読み込みました`);
          }
        });
        el.querySelector('.plan-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`「${plan.name}」を削除しますか？`)) {
            const plans = getSavedPlans();
            plans.splice(idx, 1);
            savePlansList(plans);
            renderSavedPlans();
          }
        });
        list.appendChild(el);
      });
    }

    // Show auto-backups (from PDF export)
    const backupKeys = Object.keys(localStorage).filter(k => k.startsWith('floorplan_backup_')).sort().reverse();
    if (backupKeys.length > 0) {
      const header = document.createElement('div');
      header.style.cssText = 'font-size:0.72rem;color:var(--text-light);margin-top:10px;padding:2px 0;border-top:1px solid var(--border);';
      header.textContent = '📦 自動バックアップ（PDF書出時）';
      list.appendChild(header);

      backupKeys.forEach(key => {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          const dateStr = data.backupTime ? new Date(data.backupTime).toLocaleString('ja-JP', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : key.replace('floorplan_backup_', '');
          const el = document.createElement('div');
          el.className = 'saved-plan-item';
          el.innerHTML = `<span class="plan-name" title="${key}">📦 ${dateStr}</span><button class="plan-delete" title="削除">×</button>`;
          el.querySelector('.plan-name').addEventListener('click', () => {
            if (confirm(`バックアップ（${dateStr}）を読み込みますか？\n（現在の図面は上書きされます）`)) {
              loadPlanData(data);
              updateStatus(`バックアップ（${dateStr}）を復元しました`);
            }
          });
          el.querySelector('.plan-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            localStorage.removeItem(key);
            renderSavedPlans();
          });
          list.appendChild(el);
        } catch(e) {}
      });
    }
  }

  function loadPlanData(data) {
    if (data.items) items = data.items;
    if (data.rooms) rooms = data.rooms;
    if (data.gridSize) {
      gridSize = data.gridSize;
      document.getElementById('grid-size').value = gridSize;
    }
    selectedItem = null;
    selectedRoom = null;
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
    draw();
  }

  // === Text tool ===
  // When text size is changed and a text item is selected, update it live
  document.getElementById('text-size').addEventListener('input', () => {
    if (selectedItem && selectedItem.type === 'text') {
      const newSize = parseInt(document.getElementById('text-size').value) || 13;
      saveState();
      selectedItem.fontSize = newSize;
      selectedItem.h = newSize + 4;
      draw();
    }
  });

  // When text color is changed and a text item is selected, update it live
  document.getElementById('text-color').addEventListener('input', () => {
    if (selectedItem && selectedItem.type === 'text') {
      saveState();
      selectedItem.color = document.getElementById('text-color').value;
      draw();
    }
  });

  document.getElementById('btn-place-text').addEventListener('click', () => {
    const text = document.getElementById('text-input').value.trim();
    if (!text) { updateStatus('文字を入力してください'); return; }
    const size = parseInt(document.getElementById('text-size').value) || 13;
    const color = document.getElementById('text-color').value || '#333333';
    // Start stamp mode with a special text type
    if (drawMode) cancelDrawMode();
    if (rectMode) cancelRectMode();
    if (stampMode) cancelStampMode();
    stampMode = true;
    stampType = '__text__';
    stampDragging = false;
    // Store text params temporarily
    canvas._pendingText = { text, size, color };
    canvas.style.cursor = 'crosshair';
    updateStatus(`「${text}」を配置します。図面をクリックしてください。`);
    draw();
  });

  // Sync color preset with color picker
  document.getElementById('text-color-preset').addEventListener('change', (e) => {
    document.getElementById('text-color').value = e.target.value;
  });
  document.getElementById('text-color').addEventListener('input', (e) => {
    // Deselect preset if manual color chosen
    const preset = document.getElementById('text-color-preset');
    const options = [...preset.options];
    const match = options.find(o => o.value === e.target.value);
    if (match) preset.value = match.value;
  });

  document.getElementById('btn-save-plan').addEventListener('click', () => {
    const name = prompt('図面の名前を入力してください', `図面 ${getSavedPlans().length + 1}`);
    if (!name) return;
    const plans = getSavedPlans();
    const now = new Date();
    const date = `${now.getMonth()+1}/${now.getDate()}`;
    plans.unshift({
      name,
      date,
      data: { gridSize, items, rooms },
    });
    if (plans.length > 20) plans.pop();
    savePlansList(plans);
    renderSavedPlans();
    updateStatus(`「${name}」を保存しました`);
    showPenguinMessage();
  });

  // === User info persistence ===
  const userNameEl = document.getElementById('user-name');
  const userZipEl = document.getElementById('user-zip');
  const userAddressEl = document.getElementById('user-address');

  // Load saved user info
  userNameEl.value = localStorage.getItem('floorplan-user-name') || '';
  userZipEl.value = localStorage.getItem('floorplan-user-zip') || '';
  userAddressEl.value = localStorage.getItem('floorplan-user-address') || '';

  // Auto-save on change
  userNameEl.addEventListener('input', () => localStorage.setItem('floorplan-user-name', userNameEl.value));
  userZipEl.addEventListener('input', () => {
    localStorage.setItem('floorplan-user-zip', userZipEl.value);
    // Auto-fill address from zipcode using zipcloud API
    const zip = userZipEl.value.replace('-', '').replace('ー', '');
    if (zip.length === 7 && /^\d{7}$/.test(zip)) {
      fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`)
        .then(res => res.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            const r = data.results[0];
            const address = r.address1 + r.address2 + r.address3;
            userAddressEl.value = address;
            localStorage.setItem('floorplan-user-address', address);
          }
        })
        .catch(() => {});
    }
  });
  userAddressEl.addEventListener('input', () => localStorage.setItem('floorplan-user-address', userAddressEl.value));

  // === Init ===
  // === Touch events for iPad/tablet support ===
  (function() {
    let lastTouchCount = 0;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panStartX = 0, panStartY = 0;
    let panStartOffsetX = 0, panStartOffsetY = 0;
    let touchStartTime = 0;
    let singleTouchTimer = null;

    // Prevent default browser touch behaviors on canvas
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });

    function getTouchPos(touch) {
      const rect = canvas.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    function getPinchDist(t1, t2) {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }

    function getPinchCenter(t1, t2) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (t1.clientX + t2.clientX) / 2 - rect.left,
        y: (t1.clientY + t2.clientY) / 2 - rect.top,
      };
    }

    canvas.addEventListener('touchstart', (e) => {
      const touches = e.touches;
      lastTouchCount = touches.length;

      if (touches.length === 2) {
        // Pinch zoom / 2-finger pan start
        pinchStartDist = getPinchDist(touches[0], touches[1]);
        pinchStartScale = viewScale;
        const center = getPinchCenter(touches[0], touches[1]);
        panStartX = center.x;
        panStartY = center.y;
        panStartOffsetX = viewOffsetX;
        panStartOffsetY = viewOffsetY;
        return;
      }

      if (touches.length === 1) {
        // Single finger: simulate mousedown
        const pos = getTouchPos(touches[0]);
        touchStartTime = Date.now();
        const mouseEvent = new MouseEvent('mousedown', {
          clientX: touches[0].clientX,
          clientY: touches[0].clientY,
          button: 0,
        });
        canvas.dispatchEvent(mouseEvent);
      }
    });

    canvas.addEventListener('touchmove', (e) => {
      const touches = e.touches;

      if (touches.length === 2) {
        // Pinch zoom
        const dist = getPinchDist(touches[0], touches[1]);
        const scale = pinchStartScale * (dist / pinchStartDist);
        const clampedScale = Math.max(0.25, Math.min(5, scale));

        // Pan with 2 fingers
        const center = getPinchCenter(touches[0], touches[1]);
        const dx = center.x - panStartX;
        const dy = center.y - panStartY;

        // Zoom towards pinch center
        const factor = clampedScale / viewScale;
        viewOffsetX = center.x - (center.x - viewOffsetX) * factor + dx * 0.5;
        viewOffsetY = center.y - (center.y - viewOffsetY) * factor + dy * 0.5;
        viewScale = clampedScale;

        panStartX = center.x;
        panStartY = center.y;
        draw();
        return;
      }

      if (touches.length === 1) {
        // Single finger: simulate mousemove
        const mouseEvent = new MouseEvent('mousemove', {
          clientX: touches[0].clientX,
          clientY: touches[0].clientY,
          button: 0,
        });
        canvas.dispatchEvent(mouseEvent);
      }
    });

    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        // All fingers lifted: simulate mouseup
        const touch = e.changedTouches[0];
        const mouseEvent = new MouseEvent('mouseup', {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
        });
        canvas.dispatchEvent(mouseEvent);

        // Double-tap detection for context menu
        const now = Date.now();
        if (singleTouchTimer && now - touchStartTime < 300) {
          // Double tap
          const dblEvent = new MouseEvent('dblclick', {
            clientX: touch.clientX,
            clientY: touch.clientY,
          });
          canvas.dispatchEvent(dblEvent);
          singleTouchTimer = null;
        } else {
          singleTouchTimer = setTimeout(() => { singleTouchTimer = null; }, 300);
        }
      }
      lastTouchCount = e.touches.length;
    });
  })();

  // === Deselect when clicking outside canvas (sidebar, toolbar, etc.) ===
  document.addEventListener('mousedown', (e) => {
    // Only deselect if clicking outside the canvas and context menu
    const isCanvas = canvas.contains(e.target);
    const isContextMenu = contextMenu.contains(e.target);
    const isEditBtn = e.target.id === 'btn-edit-item';
    if (!isCanvas && !isContextMenu && !isEditBtn) {
      if (selectedItem || selectedRoom) {
        selectedItem = null;
        selectedRoom = null;
        contextMenuVisible = false;
        hideContextMenu();
        updateEditBtnVisibility();
        draw();
      }
    }
  });

  resizeCanvas();
  updateUndoButtons();
  renderSavedPlans();
  updateRailLegend();
})();
