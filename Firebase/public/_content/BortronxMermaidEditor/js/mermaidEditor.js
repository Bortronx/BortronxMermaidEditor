window.mermaidVariableEditor = (() => {
    let initialized = false;
    const errorHistory = [];
    const viewState = {
        scale: 1,
        x: 0,
        y: 0,
        minScale: 0.02,
        maxScale: 100
    };

    let wheelBound = false;
    let pointerBound = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOriginX = 0;
    let dragOriginY = 0;

    // Interactive (Nodexr-style) editing state.
    let currentSource = "";
    let currentShowIds = false;
    let interactionBuilt = false;
    let nodeOverlays = []; // { id, el, g }
    let edgeButtons = [];  // { from, to, el }
    let edgeLabelButtons = []; // { from, to, el }, positioned in lockstep with edgeButtons
    let controlsVisible = true;
    let colorsVisible = true;
    let currentTheme = "default";
    let currentMode = "standard"; // "standard" | "dataflow"
    const connect = { active: false, fromId: "", x: 0, y: 0, startX: 0, startY: 0 };

    // Node types offered when dropping a connection into empty space. The "dataflow"
    // set is shown in Data Flow Diagram mode; "standard" is shown otherwise. Each entry's
    // "shape" selects a CSS preview icon (see .shape-preview.shape-* rules) that mimics the
    // rendered outline, shown in the create-node modal so the shape is obvious before creating.
    const NODE_TYPES = {
        standard: [
            { label: "Rectangle", prefix: "n", open: "[\"", close: "\"]", shape: "rect" },
            { label: "Rounded", prefix: "n", open: "(\"", close: "\")", shape: "round" },
            { label: "Stadium", prefix: "n", open: "([\"", close: "\"])", shape: "stadium" },
            { label: "Subroutine", prefix: "n", open: "[[\"", close: "\"]]", shape: "subroutine" },
            { label: "Database", prefix: "n", open: "[(\"", close: "\")]", shape: "cylinder" },
            { label: "Circle", prefix: "n", open: "((\"", close: "\"))", shape: "circle" },
            { label: "Double Circle", prefix: "n", open: "(((\"", close: "\")))", shape: "doublecircle" },
            { label: "Decision", prefix: "n", open: "{\"", close: "\"}", shape: "diamond" },
            { label: "Hexagon", prefix: "n", open: "{{\"", close: "\"}}", shape: "hexagon" },
            { label: "Parallelogram", prefix: "n", open: "[/\"", close: "\"/]", shape: "parallelogram" },
            { label: "Trapezoid", prefix: "n", open: "[/\"", close: "\"\\]", shape: "trapezoid" },
            { label: "Flag", prefix: "n", open: ">\"", close: "\"]", shape: "flag" }
        ],
        dataflow: [
            { label: "Entity", prefix: "e", open: "[/\"", close: "\"/]", shape: "parallelogram" },
            { label: "Process", prefix: "p", open: "[[\"", close: "\"]]", shape: "subroutine" },
            { label: "Data Store", prefix: "d", open: "[(\"", close: "\")]", shape: "cylinder" }
        ]
    };

    // Shared open/close bracket alternation used to find a node's shape delimiters (for
    // label read/write and the "show variable names" transform). Multi-character
    // combinations must be listed before shorter ones they'd otherwise be mistaken for,
    // e.g. the 3-paren double-circle "(((" before the 2-paren circle "((", and the
    // trapezoid's "\]" close before the plain "]" fallback.
    const NODE_OPEN_RE = "\\(\\(\\(|\\[\\[|\\[\\(|\\(\\[|\\(\\(|\\{\\{|\\[\\/|>|\\[|\\(|\\{";
    const NODE_CLOSE_RE = "\\]\\]|\\)\\]|\\]\\)|\\)\\)\\)|\\)\\)|\\}\\}|\\/\\]|\\\\\\]|\\]|\\)|\\}";

    // Number of entries in the .var-color-N palette (see mermaidEditor.css). Every node id
    // is hashed to one of these so the same id always gets the same color, both in the
    // "Show variable names" preview badge and in the source highlight overlay.
    const VAR_COLOR_COUNT = 16;

    // Simple deterministic string hash (djb2-ish), used only to pick a stable palette
    // slot per id -- not for anything security-sensitive.
    function hashStringToInt(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    // Unquoted attribute-safe (letters/digits/hyphens only) class name for the given id's
    // color slot.
    function varColorClass(id) {
        return `var-color-${hashStringToInt(id) % VAR_COLOR_COUNT}`;
    }

    let activeNodeModal = null;

    // Paint-bucket state: when a color is selected from the color bar, clicking a node
    // fills it with that color. Cleared back to normal right after one application.
    let paintColor = null;

    // The most recently selected color. Unlike paintColor, this is NOT cleared after
    // the bucket is applied, so the color bar always keeps that swatch outlined.
    let lastColor = null;

    function init() {
        if (!initialized) {
            mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: currentTheme });
            initialized = true;
        }
    }

    async function render(source, showIds) {
        init();
        currentSource = source;
        currentShowIds = showIds;
        const target = document.getElementById("diagramPreview");
        const viewport = document.getElementById("previewViewport");
        clearPreviewError();
        updateSourceHighlight(source);

        const diagramText = showIds ? addNodeIdsToLabels(source) : source;
        const renderId = "mermaid-" + Date.now();

        try {
            const result = await mermaid.render(renderId, diagramText);
            target.innerHTML = result.svg;
            if (result.bindFunctions) {
                result.bindFunctions(target);
            }
            bindPanZoom(viewport);
            buildInteractionLayer(viewport);
            applyTransform();
            refreshInteraction();
        } catch (err) {
            target.innerHTML = "";
            showPreviewError(err?.message || String(err));
            appendConsoleError(source, err);
            refreshInteraction();
        }
    }

    function clearPreviewError() {
        const errorBox = document.getElementById("errorBox");
        if (!errorBox) {
            return;
        }

        errorBox.style.display = "none";
        errorBox.textContent = "";
    }

    function showPreviewError(message) {
        const errorBox = document.getElementById("errorBox");
        if (!errorBox) {
            return;
        }

        errorBox.style.display = "block";
        errorBox.textContent = message;
    }

    function appendConsoleError(source, err) {
        const consoleBox = document.getElementById("errorConsole");
        if (!consoleBox) {
            return;
        }

        const message = err?.message || String(err);
        const time = new Date().toLocaleTimeString();
        const entry = `[${time}] ${message}`;

        errorHistory.push(entry);
        if (errorHistory.length > 100) {
            errorHistory.shift();
        }

        consoleBox.value = `${errorHistory.join("\n\n")}\n\nLast attempted source:\n${source}`;
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    function clearErrors() {
        errorHistory.length = 0;
        const consoleBox = document.getElementById("errorConsole");
        if (consoleBox) {
            consoleBox.value = "";
        }
    }

    // Copies the console's full text (used by the console bar's Copy button).
    async function copyConsoleOutput() {
        const consoleBox = document.getElementById("errorConsole");
        return copyToClipboard(consoleBox ? consoleBox.value : "");
    }

    // ----- Viewport-filling layout -----
    // The source/preview grid is sized (in px, via updateViewportLayout) to exactly fill
    // the space left in the viewport below the header (and, in Data Flow mode, its extra
    // bars) down to the *collapsed* console bar height, so everything above the console
    // fits in one screen with no scrolling. Only the collapsed bar's height is measured
    // (never the expanded textarea's), so expanding/collapsing the console never resizes
    // the grid -- it just adds/removes scrollable space below it, per design.
    let viewportResizeBound = false;

    function updateViewportLayout() {
        const page = document.querySelector(".mermaid-editor.page");
        const grid = document.querySelector(".grid");
        if (!page || !grid) {
            return;
        }

        // Below 900px (see the matching CSS media query) the source and preview panels
        // stack in one column and are meant to be reached by scrolling, not squeezed to
        // fit one screen -- so skip pinning the grid to a fixed viewport-filling height
        // and let each panel's own min-height (from CSS) size it instead.
        if (window.matchMedia("(max-width: 900px)").matches) {
            grid.style.height = "";
            return;
        }

        const pageStyle = getComputedStyle(page);
        let reserved = (parseFloat(pageStyle.paddingTop) || 0) + (parseFloat(pageStyle.paddingBottom) || 0);

        const addElementHeight = (el) => {
            if (!el) {
                return;
            }
            const cs = getComputedStyle(el);
            if (cs.display === "none") {
                return;
            }
            reserved += el.getBoundingClientRect().height;
            reserved += parseFloat(cs.marginTop) || 0;
            reserved += parseFloat(cs.marginBottom) || 0;
        };

        addElementHeight(page.querySelector(":scope > .header"));
        addElementHeight(page.querySelector(":scope > .dfd-bar"));
        addElementHeight(page.querySelector(":scope > .dfd-legend-panel"));

        const consolePanel = page.querySelector(":scope > .console-panel");
        if (consolePanel) {
            const consoleStyle = getComputedStyle(consolePanel);
            reserved += parseFloat(consoleStyle.marginTop) || 0;
            const bar = consolePanel.querySelector(".panel-header");
            if (bar) {
                reserved += bar.getBoundingClientRect().height;
            }
        }

        const available = window.innerHeight - reserved;
        grid.style.height = Math.max(available, 240) + "px";
    }

    function bindViewportResize() {
        if (viewportResizeBound) {
            return;
        }
        viewportResizeBound = true;
        window.addEventListener("resize", () => updateViewportLayout());
    }

    function bindPanZoom(viewport) {
        if (!viewport) {
            return;
        }

        if (!wheelBound) {
            viewport.addEventListener("wheel", onWheelZoom, { passive: false });
            wheelBound = true;
        }

        if (!pointerBound) {
            viewport.addEventListener("pointerdown", onPointerDown);
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            pointerBound = true;
        }
    }

    function getSvgElement() {
        return document.querySelector("#diagramPreview svg");
    }

    function applyTransform() {
        const svg = getSvgElement();
        if (!svg) {
            return;
        }

        const viewBox = ensureViewBox(svg);
        const scaledWidth = viewBox.width * viewState.scale;
        const scaledHeight = viewBox.height * viewState.scale;

        svg.style.position = "absolute";
        svg.style.left = `${viewState.x}px`;
        svg.style.top = `${viewState.y}px`;
        svg.style.width = `${scaledWidth}px`;
        svg.style.height = `${scaledHeight}px`;
        svg.style.maxWidth = "none";
        svg.style.transform = "none";

        svg.setAttribute("width", `${scaledWidth}`);
        svg.setAttribute("height", `${scaledHeight}`);

        positionInteraction();
    }

    function ensureViewBox(svg) {
        const existingViewBox = svg.getAttribute("viewBox");
        if (existingViewBox) {
            const parts = existingViewBox.trim().split(/\s+/).map(Number);
            if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
                return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
            }
        }

        const bbox = svg.getBBox();
        const fallback = {
            x: 0,
            y: 0,
            width: Math.max(1, bbox.width || 1),
            height: Math.max(1, bbox.height || 1)
        };

        svg.setAttribute("viewBox", `${fallback.x} ${fallback.y} ${fallback.width} ${fallback.height}`);
        return fallback;
    }

    function onWheelZoom(event) {
        const svg = getSvgElement();
        if (!svg) {
            return;
        }

        event.preventDefault();

        const viewportRect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - viewportRect.left;
        const py = event.clientY - viewportRect.top;

        const oldScale = viewState.scale;
        const zoomFactor = Math.exp(-event.deltaY * 0.0022);
        const newScale = clampScale(oldScale * zoomFactor);

        if (newScale === oldScale) {
            return;
        }

        const worldX = (px - viewState.x) / oldScale;
        const worldY = (py - viewState.y) / oldScale;

        viewState.scale = newScale;
        viewState.x = px - worldX * newScale;
        viewState.y = py - worldY * newScale;

        applyTransform();
    }

    function onPointerDown(event) {
        if (event.button !== 0) {
            return;
        }

        // Don't pan when interacting with nodes, connection handles, or the inline editor.
        if (connect.active) {
            return;
        }
        if (event.target.closest("#interactionLayer") || event.target.closest(".node-label-editor")) {
            return;
        }

        const svg = getSvgElement();
        if (!svg) {
            return;
        }

        isDragging = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragOriginX = viewState.x;
        dragOriginY = viewState.y;

        event.currentTarget.classList.add("dragging");
        event.currentTarget.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event) {
        if (!isDragging) {
            return;
        }

        viewState.x = dragOriginX + (event.clientX - dragStartX);
        viewState.y = dragOriginY + (event.clientY - dragStartY);
        applyTransform();
    }

    function onPointerUp(event) {
        if (!isDragging) {
            return;
        }

        isDragging = false;
        const viewport = document.getElementById("previewViewport");
        if (viewport) {
            viewport.classList.remove("dragging");
            if (event.pointerId !== undefined && viewport.hasPointerCapture(event.pointerId)) {
                viewport.releasePointerCapture(event.pointerId);
            }
        }
    }

    function clampScale(scale) {
        if (Number.isNaN(scale) || !Number.isFinite(scale)) {
            return viewState.scale;
        }

        if (scale < viewState.minScale) {
            return viewState.minScale;
        }

        if (scale > viewState.maxScale) {
            return viewState.maxScale;
        }

        return scale;
    }

    function zoomByFactor(factor) {
        const viewport = document.getElementById("previewViewport");
        if (!viewport) {
            return;
        }

        const rect = viewport.getBoundingClientRect();
        const px = rect.width / 2;
        const py = rect.height / 2;
        const oldScale = viewState.scale;
        const newScale = clampScale(oldScale * factor);

        if (newScale === oldScale) {
            return;
        }

        const worldX = (px - viewState.x) / oldScale;
        const worldY = (py - viewState.y) / oldScale;

        viewState.scale = newScale;
        viewState.x = px - worldX * newScale;
        viewState.y = py - worldY * newScale;

        applyTransform();
    }

    function zoomIn() {
        zoomByFactor(1.2);
    }

    function zoomOut() {
        zoomByFactor(1 / 1.2);
    }

    function resetZoom() {
        const svg = getSvgElement();
        const viewport = getViewport();
        if (!svg || !viewport) {
            viewState.scale = 1;
            viewState.x = 0;
            viewState.y = 0;
            applyTransform();
            return;
        }

        const viewBox = ensureViewBox(svg);
        // Available space inside the viewport (minus a little breathing room).
        const padding = 24;
        const availW = Math.max(1, viewport.clientWidth - padding * 2);
        const availH = Math.max(1, viewport.clientHeight - padding * 2);

        // Scale the diagram so it fits within the viewport, but never enlarge it
        // past its natural size (cap at 1) so small diagrams stay readable.
        const fitScale = Math.min(availW / viewBox.width, availH / viewBox.height, 1);
        viewState.scale = clampScale(fitScale);

        const scaledWidth = viewBox.width * viewState.scale;
        const scaledHeight = viewBox.height * viewState.scale;

        // Center the diagram both horizontally and vertically in the viewport.
        viewState.x = (viewport.clientWidth - scaledWidth) / 2;
        viewState.y = (viewport.clientHeight - scaledHeight) / 2;
        applyTransform();
    }

    // ---------------------------------------------------------------------
    // Nodexr-style interactive editing layer.
    // The Mermaid SVG is static, so we overlay interactive elements on top of
    // each rendered node and translate gestures into edits of the source text.
    // ---------------------------------------------------------------------

    function getViewport() {
        return document.getElementById("previewViewport");
    }

    function buildInteractionLayer(viewport) {
        if (interactionBuilt || !viewport) {
            return;
        }

        const layer = document.createElement("div");
        layer.id = "interactionLayer";

        const svgns = "http://www.w3.org/2000/svg";
        const noodleSvg = document.createElementNS(svgns, "svg");
        noodleSvg.id = "noodleSvg";
        const tempNoodle = document.createElementNS(svgns, "path");
        tempNoodle.id = "tempNoodle";
        noodleSvg.appendChild(tempNoodle);
        layer.appendChild(noodleSvg);

        // Paint-bucket color bar pinned to the bottom of the preview. Being a child of
        // the interaction layer, it is hidden automatically when controls are hidden.
        const colorBar = document.createElement("div");
        colorBar.id = "colorBar";
        colorBar.classList.toggle("colors-hidden", !colorsVisible);
        layer.appendChild(colorBar);

        viewport.appendChild(layer);
        layer.classList.toggle("controls-hidden", !controlsVisible);

        window.addEventListener("pointermove", onConnectMove);
        window.addEventListener("pointerup", onConnectUp);

        interactionBuilt = true;
    }

    // Show or hide the interactive editing controls (overlays, handles, edge buttons).
    function setControlsVisible(visible) {
        controlsVisible = !!visible;

        const layer = document.getElementById("interactionLayer");
        if (layer) {
            layer.classList.toggle("controls-hidden", !controlsVisible);
        }

        if (!controlsVisible) {
            // Cancel any in-progress connection or inline edit when hiding.
            connect.active = false;
            connect.fromId = "";
            const noodle = document.getElementById("noodleSvg");
            if (noodle) {
                noodle.style.display = "none";
            }
            closeNodeEditor();
            closeEdgeLabelEditor();
            clearPaint();
        }

        return controlsVisible;
    }

    function toggleControls() {
        return setControlsVisible(!controlsVisible);
    }

    // Show or hide just the paint-bucket color bar, independent of the other controls.
    // The bar still only appears when controls are visible (it lives inside the
    // interaction layer, which is hidden by setControlsVisible).
    function setColorsVisible(visible) {
        colorsVisible = !!visible;

        const colorBar = document.getElementById("colorBar");
        if (colorBar) {
            colorBar.classList.toggle("colors-hidden", !colorsVisible);
        }

        if (!colorsVisible) {
            clearPaint();
        }

        return colorsVisible;
    }

    // Toggle native fullscreen for the preview panel alone. After entering or leaving
    // fullscreen the diagram is re-laid-out so the SVG and overlays fit the new size.
    function toggleFullscreen(targetId) {
        const el = document.getElementById(targetId || "previewPanel");
        if (!el) {
            return;
        }

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => { });
        }
    }

    // Re-fit the diagram whenever fullscreen state changes (size of the panel changes).
    document.addEventListener("fullscreenchange", () => {
        const panel = document.getElementById("previewPanel");
        if (panel) {
            panel.classList.toggle("is-fullscreen", document.fullscreenElement === panel);
        }
        // Defer so the browser has applied the new dimensions first.
        requestAnimationFrame(() => {
            applyTransform();
            populateColorBar();
            positionInteraction();
        });
    });

    // Switch between light and dark themes (page + Mermaid diagram).
    function setTheme(dark) {
        currentTheme = dark ? "dark" : "default";
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

        // Force Mermaid to re-initialize with the new theme, then re-render.
        initialized = false;
        init();

        if (currentSource) {
            render(currentSource, currentShowIds);
        }

        return dark;
    }

    // Copy arbitrary text to the clipboard (used by the Data Flow legend copy button).
    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {
            // Fall through to the legacy approach below.
        }

        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();

        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (e) {
            ok = false;
        }
        ta.remove();
        return ok;
    }

    // Rebuild overlays + edge buttons from the current SVG and source.
    function refreshInteraction() {
        const layer = document.getElementById("interactionLayer");
        if (!layer) {
            return;
        }

        nodeOverlays.forEach(o => o.el.remove());
        nodeOverlays = [];
        edgeButtons.forEach(b => b.el.remove());
        edgeButtons = [];
        edgeLabelButtons.forEach(b => b.el.remove());
        edgeLabelButtons = [];

        const groups = document.querySelectorAll("#diagramPreview g.node");
        groups.forEach(g => {
            const id = nodeIdFromG(g);
            if (!id) {
                return;
            }

            const el = document.createElement("div");
            el.className = "node-overlay";
            el.dataset.nodeId = id;

            const del = document.createElement("button");
            del.type = "button";
            del.className = "node-delete";
            del.textContent = "\u00d7";
            del.title = `Delete node ${id}`;
            el.appendChild(del);

            el.addEventListener("pointerdown", e => onNodePointerDown(e, id));
            el.addEventListener("dblclick", e => onNodeDblClick(e, id, g));
            del.addEventListener("pointerdown", e => e.stopPropagation());
            del.addEventListener("click", e => {
                e.stopPropagation();
                e.preventDefault();
                applySource(deleteNode(currentSource, id));
            });

            layer.appendChild(el);
            nodeOverlays.push({ id, el, g });
        });

        const edges = parseEdges(currentSource);
        edges.forEach((edge, i) => {
            const el = document.createElement("button");
            el.type = "button";
            el.className = "edge-delete";
            el.textContent = "\u00d7";
            el.title = `Remove ${edge.from} \u2192 ${edge.to}`;
            el.addEventListener("pointerdown", e => e.stopPropagation());
            el.addEventListener("click", e => {
                e.stopPropagation();
                e.preventDefault();
                applySource(removeEdge(currentSource, edge.from, edge.to));
            });
            // Highlight the matching arrow while hovering its delete button.
            el.addEventListener("pointerenter", () => setEdgeHighlight(i, true));
            el.addEventListener("pointerleave", () => setEdgeHighlight(i, false));
            layer.appendChild(el);
            edgeButtons.push({ from: edge.from, to: edge.to, el });

            // Label pill: shows the current |label| text (or a "+" placeholder when there
            // isn't one). Click to open an inline editor; committing an empty value
            // removes the label entirely.
            const labelBtn = document.createElement("button");
            labelBtn.type = "button";
            labelBtn.className = "edge-label-btn";
            labelBtn.classList.toggle("empty", !edge.label);
            labelBtn.textContent = edge.label || "+";
            labelBtn.title = edge.label ? `Edit label "${edge.label}"` : "Add a label to this connection";
            labelBtn.addEventListener("pointerdown", e => e.stopPropagation());
            labelBtn.addEventListener("pointerenter", () => setEdgeHighlight(i, true));
            labelBtn.addEventListener("pointerleave", () => setEdgeHighlight(i, false));
            labelBtn.addEventListener("click", e => {
                e.stopPropagation();
                e.preventDefault();
                openEdgeLabelEditor(edge.lineIndex, edge.label, labelBtn);
            });
            layer.appendChild(labelBtn);
            edgeLabelButtons.push({ from: edge.from, to: edge.to, el: labelBtn });
        });

        buildEdgeHitPaths();
        populateColorBar();
        positionInteraction();
    }

    // Add a transparent, wide companion path over each rendered edge so the paint bucket
    // can target it. The hit paths live inside the SVG, so they scale/pan with the
    // diagram automatically. They only receive pointer events while a color is armed.
    function buildEdgeHitPaths() {
        const svg = getSvgElement();
        if (!svg) {
            return;
        }

        svg.querySelectorAll("path.edge-hit").forEach(p => p.remove());

        const realPaths = svg.querySelectorAll("g.edgePaths > path");
        realPaths.forEach((rp, i) => {
            const hit = rp.cloneNode(false);
            hit.setAttribute("class", "edge-hit");
            hit.removeAttribute("id");
            hit.style.fill = "none";
            hit.style.stroke = "transparent";
            hit.style.strokeWidth = "16px";
            hit.style.cursor = "crosshair";
            hit.style.pointerEvents = paintColor ? "stroke" : "none";
            hit.dataset.edgeIndex = String(i);

            // Use pointerdown (not click) so the paint applies before the viewport pan
            // handler can start a drag and steal the gesture.
            hit.addEventListener("pointerdown", e => {
                if (!paintColor) {
                    return;
                }
                e.stopPropagation();
                e.preventDefault();
                // Stay armed so multiple edges can be painted until the color is
                // deselected by clicking its swatch again.
                applySource(setEdgeColor(currentSource, i, paintColor));
            });

            rp.parentElement.appendChild(hit);
        });
    }

    // Toggle whether the edge hit paths capture pointer events (only while painting).
    function setEdgeHitActive(active) {
        const svg = getSvgElement();
        if (!svg) {
            return;
        }
        svg.querySelectorAll("path.edge-hit").forEach(p => {
            p.style.pointerEvents = active ? "stroke" : "none";
        });
    }

    // Highlight (pulse) the rendered arrow at the given index, e.g. while hovering
    // its delete button, so it's clear which connection will be removed.
    function setEdgeHighlight(index, on) {
        const svg = getSvgElement();
        if (!svg) {
            return;
        }
        const paths = svg.querySelectorAll("g.edgePaths > path:not(.edge-hit)");
        const path = paths[index];
        if (path) {
            path.classList.toggle("edge-highlight", on);
        }
    }

    // Keep overlays aligned with the SVG nodes (called on pan/zoom/render).
    function positionInteraction() {
        const viewport = getViewport();
        if (!viewport) {
            return;
        }

        const vr = viewport.getBoundingClientRect();
        const map = new Map();
        nodeOverlays.forEach(o => map.set(o.id, o.g));

        nodeOverlays.forEach(o => {
            if (!o.g.isConnected) {
                o.el.style.display = "none";
                return;
            }
            const r = o.g.getBoundingClientRect();
            o.el.style.display = "block";
            o.el.style.left = `${r.left - vr.left}px`;
            o.el.style.top = `${r.top - vr.top}px`;
            o.el.style.width = `${r.width}px`;
            o.el.style.height = `${r.height}px`;
        });

        edgeButtons.forEach((b, i) => {
            const labelBtn = edgeLabelButtons[i];
            const gf = map.get(b.from);
            const gt = map.get(b.to);
            if (!gf || !gt) {
                b.el.style.display = "none";
                if (labelBtn) {
                    labelBtn.el.style.display = "none";
                }
                return;
            }
            const c1 = centerOf(gf, vr);
            const c2 = centerOf(gt, vr);
            const midX = (c1.x + c2.x) / 2;
            const midY = (c1.y + c2.y) / 2;
            b.el.style.display = "flex";
            b.el.style.left = `${midX}px`;
            b.el.style.top = `${midY}px`;
            if (labelBtn) {
                labelBtn.el.style.display = "flex";
                labelBtn.el.style.left = `${midX}px`;
                labelBtn.el.style.top = `${midY}px`;
            }
        });

        if (connect.active) {
            updateNoodle();
        }
    }

    function centerOf(g, vr) {
        const r = g.getBoundingClientRect();
        return {
            x: r.left - vr.left + r.width / 2,
            y: r.top - vr.top + r.height / 2
        };
    }

    function nodeIdFromG(g) {
        const raw = g.getAttribute("id") || "";
        // Mermaid v11 ids look like: "mermaid-<ts>-flowchart-<id>-<index>"
        const m = raw.match(/flowchart-(.+?)-\d+$/);
        if (m) {
            return m[1];
        }
        const title = g.querySelector("title");
        return title && title.textContent ? title.textContent.trim() : "";
    }

    // ----- Connection dragging (the "noodle") -----

    function onNodePointerDown(event, id) {
        if (event.button !== 0 || event.target.closest(".node-delete")) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        // If a paint color is armed, clicking a node fills it instead of connecting.
        // The color stays armed so you can keep painting node after node until you
        // deselect it by clicking its swatch again.
        if (paintColor) {
            applySource(setNodeColor(currentSource, id, paintColor));
            return;
        }

        connect.active = true;
        connect.fromId = id;
        connect.x = event.clientX;
        connect.y = event.clientY;
        connect.startX = event.clientX;
        connect.startY = event.clientY;

        const svg = document.getElementById("noodleSvg");
        if (svg) {
            svg.style.display = "block";
        }
        updateNoodle();
    }

    function onConnectMove(event) {
        if (!connect.active) {
            return;
        }

        connect.x = event.clientX;
        connect.y = event.clientY;

        const target = document.elementFromPoint(event.clientX, event.clientY);
        const over = target ? target.closest(".node-overlay") : null;
        nodeOverlays.forEach(o => o.el.classList.toggle("connect-target", over === o.el && o.id !== connect.fromId));

        updateNoodle();
    }

    function onConnectUp(event) {
        if (!connect.active) {
            return;
        }

        const target = document.elementFromPoint(event.clientX, event.clientY);
        const over = target ? target.closest(".node-overlay") : null;
        const toId = over ? over.dataset.nodeId : "";
        const fromId = connect.fromId;

        const movedFar = Math.hypot(event.clientX - connect.startX, event.clientY - connect.startY) > 6;

        connect.active = false;
        connect.fromId = "";
        nodeOverlays.forEach(o => o.el.classList.remove("connect-target"));
        const svg = document.getElementById("noodleSvg");
        if (svg) {
            svg.style.display = "none";
        }

        if (fromId && toId && fromId !== toId) {
            // Dropped on another node: connect the two.
            applySource(addEdge(currentSource, fromId, toId));
        } else if (fromId && !toId && movedFar) {
            // Dropped in empty space: prompt for a node type + name, then connect.
            promptNewNode(fromId);
        }
    }

    function updateNoodle() {
        const path = document.getElementById("tempNoodle");
        const viewport = getViewport();
        if (!path || !viewport) {
            return;
        }

        const from = nodeOverlays.find(o => o.id === connect.fromId);
        if (!from) {
            return;
        }

        const vr = viewport.getBoundingClientRect();
        const c = centerOf(from.g, vr);
        const ex = connect.x - vr.left;
        const ey = connect.y - vr.top;
        path.setAttribute("d", noodlePath(c.x, c.y, ex, ey));
    }

    function noodlePath(x1, y1, x2, y2) {
        const ctrl = 5 + 0.4 * Math.abs(x2 - x1) + Math.min(0.2 * Math.abs(y2 - y1), 40);
        return `M ${x1} ${y1} C ${x1 + ctrl} ${y1} ${x2 - ctrl} ${y2} ${x2} ${y2}`;
    }

    // ----- Paint bucket (color bar) -----

    // Build a palette with a few neutrals followed by an evenly spaced hue spread,
    // sized to roughly fill the available width with distinct swatches.
    function buildColorPalette(count) {
        const neutrals = ["#ffffff", "#e5e7eb", "#9ca3af", "#4b5563", "#111827"];
        const hueCount = Math.max(8, count - neutrals.length);
        const hues = [];
        for (let i = 0; i < hueCount; i++) {
            const hue = Math.round((360 * i) / hueCount);
            hues.push(hslToHex(hue, 75, 62));
        }
        return neutrals.concat(hues);
    }

    // Fill the color bar with as many swatches as fit across its width.
    function populateColorBar() {
        const bar = document.getElementById("colorBar");
        if (!bar) {
            return;
        }
        const width = bar.clientWidth || (getViewport() ? getViewport().clientWidth : 700);
        const count = Math.max(12, Math.floor(width / 22));
        if (bar.dataset.count === String(count)) {
            return; // Already populated for this width.
        }
        bar.dataset.count = String(count);
        bar.innerHTML = "";

        buildColorPalette(count).forEach(color => {
            const sw = document.createElement("button");
            sw.type = "button";
            sw.className = "color-swatch";
            sw.style.background = color;
            sw.title = color;
            if (paintColor && color === paintColor) {
                sw.classList.add("selected");
            } else if (color === lastColor) {
                sw.classList.add("last-selected");
            }
            sw.addEventListener("pointerdown", e => e.stopPropagation());
            sw.addEventListener("click", e => {
                e.stopPropagation();
                e.preventDefault();
                selectPaintColor(color, sw);
            });
            bar.appendChild(sw);
        });
    }

    function selectPaintColor(color, swatchEl) {
        // Clicking the color that is already armed toggles painting back off.
        if (paintColor === color) {
            clearPaint();
            return;
        }
        paintColor = color;
        lastColor = color;
        const bar = document.getElementById("colorBar");
        if (bar) {
            // The armed swatch gets the black "selected" outline; clear any white
            // "last-selected" outline left over from a previously chosen color.
            bar.querySelectorAll(".color-swatch").forEach(s => {
                s.classList.toggle("selected", s === swatchEl);
                s.classList.remove("last-selected");
            });
        }
        const layer = document.getElementById("interactionLayer");
        if (layer) {
            layer.classList.add("painting");
        }
        setEdgeHitActive(true);
    }

    function clearPaint() {
        paintColor = null;
        const bar = document.getElementById("colorBar");
        if (bar) {
            // The just-deselected swatch drops its black "selected" outline and takes
            // on the white "last-selected" outline, so the bar still shows which
            // color was last used while making clear nothing is armed.
            bar.querySelectorAll(".color-swatch.selected").forEach(s => {
                s.classList.remove("selected");
                s.classList.add("last-selected");
            });
        }
        const layer = document.getElementById("interactionLayer");
        if (layer) {
            layer.classList.remove("painting");
        }
        setEdgeHitActive(false);
    }

    // Add or replace a `style <id> fill:...` line so the node renders in the chosen color.
    function setNodeColor(source, id, color) {
        const stroke = shadeColor(color, -22);
        const text = contrastColor(color);
        const styleLine = `style ${id} fill:${color},stroke:${stroke},color:${text}`;

        const esc = escapeRegExp(id);
        const rx = new RegExp(`^\\s*style\\s+${esc}\\b`);
        const lines = source.split(/\r?\n/);
        const idx = lines.findIndex(l => rx.test(l));
        if (idx >= 0) {
            lines[idx] = styleLine;
            return lines.join("\n");
        }
        let insertAt = lines.findIndex(l => /^\s*(classDef|class|linkStyle)\b/.test(l));
        if (insertAt < 0) {
            insertAt = lines.length;
        }
        lines.splice(insertAt, 0, styleLine);
        return lines.join("\n");
    }

    // Add or replace a `linkStyle <index> stroke:...` line so the arrow (edge) at that
    // index renders in the chosen color. Index follows edge definition order.
    function setEdgeColor(source, index, color) {
        const styleLine = `linkStyle ${index} stroke:${color},stroke-width:2px`;
        const rx = new RegExp(`^\\s*linkStyle\\s+${index}\\b`);
        const lines = source.split(/\r?\n/);
        const idx = lines.findIndex(l => rx.test(l));
        if (idx >= 0) {
            lines[idx] = styleLine;
            return lines.join("\n");
        }
        return lines.concat(styleLine).join("\n");
    }

    function hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
            return Math.round(255 * c).toString(16).padStart(2, "0");
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hexToRgb(hex) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
    }

    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
    }

    function shadeColor(hex, percent) {
        const c = hexToRgb(hex);
        if (!c) {
            return hex;
        }
        const t = percent < 0 ? 0 : 255;
        const p = Math.abs(percent) / 100;
        return rgbToHex((t - c.r) * p + c.r, (t - c.g) * p + c.g, (t - c.b) * p + c.b);
    }

    function contrastColor(hex) {
        const c = hexToRgb(hex);
        if (!c) {
            return "#111827";
        }
        const yiq = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
        return yiq >= 150 ? "#111827" : "#ffffff";
    }

    // ----- Create-connected-node prompt (drag into empty space) -----

    // Pick a fresh node id for the given prefix (e.g. "e3", "n5").
    function nextNodeId(source, prefix) {
        let max = 0;
        const re = new RegExp(`(^|[^\\w])${escapeRegExp(prefix)}(\\d+)\\b`, "g");
        let m;
        while ((m = re.exec(source)) !== null) {
            const n = parseInt(m[2], 10);
            if (n > max) {
                max = n;
            }
        }
        return `${prefix}${max + 1}`;
    }

    // Append a new node of the chosen type and connect the source node to it.
    function createConnectedNode(source, fromId, type, name) {
        const id = nextNodeId(source, type.prefix);
        const safeName = (name || type.label).replace(/"/g, "'").trim();
        const nodeLine = `${id}${type.open}${safeName}${type.close}`;

        const lines = source.split(/\r?\n/);
        let idx = lines.findIndex(l => /^\s*(classDef|class|style|linkStyle)\b/.test(l));
        if (idx < 0) {
            idx = lines.length;
        }
        lines.splice(idx, 0, nodeLine);

        return addEdge(lines.join("\n"), fromId, id);
    }

    function closeNodeModal() {
        if (activeNodeModal) {
            activeNodeModal.remove();
            activeNodeModal = null;
        }
    }

    function promptNewNode(fromId) {
        closeNodeModal();

        const types = NODE_TYPES[currentMode === "dataflow" ? "dataflow" : "standard"];
        let selected = types[0];

        const backdrop = document.createElement("div");
        backdrop.className = "node-modal-backdrop";

        const modal = document.createElement("div");
        modal.className = "node-modal";

        const title = document.createElement("div");
        title.className = "node-modal-title";
        title.textContent = "Create connected node";
        modal.appendChild(title);

        const typeWrap = document.createElement("div");
        typeWrap.className = "node-modal-types";
        const typeButtons = [];
        types.forEach(t => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "node-type-btn";
            b.title = t.label;

            const preview = document.createElement("span");
            preview.className = `shape-preview shape-${t.shape || "rect"}`;
            b.appendChild(preview);

            const labelEl = document.createElement("span");
            labelEl.className = "node-type-label";
            labelEl.textContent = t.label;
            b.appendChild(labelEl);

            if (t === selected) {
                b.classList.add("selected");
            }
            b.addEventListener("click", () => {
                selected = t;
                typeButtons.forEach(x => x.classList.toggle("selected", x === b));
                nameInput.focus();
            });
            typeButtons.push(b);
            typeWrap.appendChild(b);
        });
        modal.appendChild(typeWrap);

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "node-modal-name";
        nameInput.placeholder = "Node name";
        modal.appendChild(nameInput);

        const actions = document.createElement("div");
        actions.className = "node-modal-actions";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "node-modal-cancel";
        cancelBtn.textContent = "Cancel";
        const createBtn = document.createElement("button");
        createBtn.type = "button";
        createBtn.className = "node-modal-create";
        createBtn.textContent = "Create";
        actions.appendChild(cancelBtn);
        actions.appendChild(createBtn);
        modal.appendChild(actions);

        backdrop.appendChild(modal);
        // When the preview panel is fullscreen, only its subtree paints on top, so a
        // body-level modal would hide behind it. Mount the modal inside the active
        // fullscreen element (the palette CSS vars live on :root, so styling holds).
        (document.fullscreenElement || document.body).appendChild(backdrop);
        activeNodeModal = backdrop;
        nameInput.focus();

        function confirm() {
            const name = nameInput.value;
            closeNodeModal();
            applySource(createConnectedNode(currentSource, fromId, selected, name));
        }

        cancelBtn.addEventListener("click", closeNodeModal);
        createBtn.addEventListener("click", confirm);
        backdrop.addEventListener("pointerdown", e => {
            if (e.target === backdrop) {
                closeNodeModal();
            }
        });
        nameInput.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                confirm();
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeNodeModal();
            }
        });
    }

    // Tell the editor which app mode is active so the create-node prompt offers the
    // right node types (Data Flow types in "dataflow" mode, generic types otherwise).
    function setMode(mode) {
        currentMode = mode === "dataflow" ? "dataflow" : "standard";
        return currentMode;
    }

    // ----- Inline node text editing -----

    function onNodeDblClick(event, id, g) {
        event.preventDefault();
        event.stopPropagation();
        openNodeEditor(id, g);
    }

    function openNodeEditor(id, g) {
        closeNodeEditor();
        closeEdgeLabelEditor();

        const viewport = getViewport();
        if (!viewport) {
            return;
        }

        const vr = viewport.getBoundingClientRect();
        const r = g.getBoundingClientRect();

        const input = document.createElement("input");
        input.type = "text";
        input.className = "node-label-editor";
        input.value = getNodeLabel(currentSource, id) || labelFromSvg(g);
        input.style.left = `${r.left - vr.left}px`;
        input.style.top = `${r.top - vr.top}px`;
        input.style.width = `${Math.max(120, r.width)}px`;

        const commit = () => {
            if (input.dataset.committed === "1") {
                return;
            }
            input.dataset.committed = "1";
            const value = input.value.trim();
            closeNodeEditor();
            if (value) {
                applySource(setNodeLabel(currentSource, id, value));
            }
        };

        input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                input.dataset.committed = "1";
                closeNodeEditor();
            }
        });
        input.addEventListener("blur", commit);
        input.addEventListener("pointerdown", e => e.stopPropagation());

        viewport.appendChild(input);
        input.focus();
        input.select();
    }

    function closeNodeEditor() {
        const existing = document.querySelector("#previewViewport .node-label-editor");
        if (existing && existing.isConnected) {
            existing.remove();
        }
    }

    // ----- Inline edge label editing -----

    // Opens a small text input anchored on the edge's label pill so its |label| can be
    // typed/edited in place. Committing an empty value removes the label (falls back to
    // a plain, unlabeled arrow); Escape cancels without changing anything.
    function openEdgeLabelEditor(lineIndex, currentLabel, anchorEl) {
        closeNodeEditor();
        closeEdgeLabelEditor();

        const viewport = getViewport();
        if (!viewport) {
            return;
        }

        const vr = viewport.getBoundingClientRect();
        const r = anchorEl.getBoundingClientRect();

        const input = document.createElement("input");
        input.type = "text";
        input.className = "edge-label-editor";
        input.value = currentLabel || "";
        input.placeholder = "Edge label";
        input.style.left = `${r.left - vr.left + r.width / 2}px`;
        input.style.top = `${r.top - vr.top + r.height / 2}px`;

        const commit = () => {
            if (input.dataset.committed === "1") {
                return;
            }
            input.dataset.committed = "1";
            const value = input.value.trim();
            closeEdgeLabelEditor();
            applySource(setEdgeLabelAt(currentSource, lineIndex, value));
        };

        input.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                input.dataset.committed = "1";
                closeEdgeLabelEditor();
            }
        });
        input.addEventListener("blur", commit);
        input.addEventListener("pointerdown", e => e.stopPropagation());

        viewport.appendChild(input);
        input.focus();
        input.select();
    }

    function closeEdgeLabelEditor() {
        const existing = document.querySelector("#previewViewport .edge-label-editor");
        if (existing && existing.isConnected) {
            existing.remove();
        }
    }

    function labelFromSvg(g) {
        const fo = g.querySelector("foreignObject");
        if (fo && fo.textContent.trim()) {
            return fo.textContent.trim();
        }
        const text = g.querySelector("text");
        return text ? text.textContent.trim() : "";
    }

    // ----- Source text manipulation -----

    function applySource(newSource) {
        if (newSource === currentSource) {
            return;
        }

        currentSource = newSource;
        const textarea = document.getElementById("mermaidSourceInput");
        if (textarea) {
            // Update the bound textarea and let Blazor re-render the diagram.
            textarea.value = newSource;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    const LINK_OPS = ["-.->", "-.-", "==>", "===", "-->", "---", "--x", "--o", "x--x", "o--o"];

    function parseEdges(source) {
        const edges = [];
        source.split(/\r?\n/).forEach((line, lineIndex) => {
            const edge = parseEdgeLine(line);
            if (edge) {
                edges.push({ ...edge, lineIndex });
            }
        });
        return edges;
    }

    function parseEdgeLine(line) {
        const trimmed = line.trim();
        if (!trimmed ||
            trimmed.startsWith("%%") ||
            /^(classDef|class|style|linkStyle|subgraph|end|direction|click|flowchart|graph)\b/.test(trimmed)) {
            return null;
        }

        const from = trimmed.match(/^([A-Za-z_][\w-]*)/);
        if (!from) {
            return null;
        }

        let opIndex = -1;
        let op = null;
        for (const candidate of LINK_OPS) {
            const i = trimmed.indexOf(candidate);
            if (i >= 0 && (opIndex < 0 || i < opIndex)) {
                opIndex = i;
                op = candidate;
            }
        }
        if (!op) {
            return null;
        }

        let after = trimmed.slice(opIndex + op.length);
        const labelMatch = after.match(/^\s*\|([^|]*)\|/);
        const label = labelMatch ? labelMatch[1].trim() : "";
        after = after.replace(/^\s*\|[^|]*\|/, "").replace(/^\s*/, "");
        const to = after.match(/^([A-Za-z_][\w-]*)/);
        if (!to) {
            return null;
        }

        return { from: from[1], to: to[1], op, label };
    }

    function addEdge(source, from, to) {
        if (parseEdges(source).some(e => e.from === from && e.to === to)) {
            return source;
        }

        const lines = source.split(/\r?\n/);
        let idx = lines.findIndex(l => /^\s*(classDef|class|style|linkStyle)\b/.test(l));
        if (idx < 0) {
            idx = lines.length;
        }
        lines.splice(idx, 0, `${from} --> ${to}`);
        return lines.join("\n");
    }

    function removeEdge(source, from, to) {
        const lines = source.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const parsed = parseEdgeLine(lines[i]);
            if (parsed && parsed.from === from && parsed.to === to) {
                lines.splice(i, 1);
                return lines.join("\n");
            }
        }
        return source;
    }

    // Regex used to rewrite a specific edge line in place: captures leading indent, the
    // "from" id, the arrow operator, any existing |label|, the "to" id, and anything after
    // (trailing whitespace/semicolons), so a label can be added/edited/removed without
    // disturbing the rest of the line.
    function buildEdgeLineRegex() {
        const opsPattern = LINK_OPS.map(escapeRegExp).join("|");
        return new RegExp(`^(\\s*)([A-Za-z_][\\w-]*)\\s*(${opsPattern})\\s*(?:\\|[^|]*\\|)?\\s*([A-Za-z_][\\w-]*)(.*)$`);
    }

    // Sets (or clears, when text is empty) the |label| on the edge at the given source line
    // index. Used by the click-to-edit label pill in the preview.
    function setEdgeLabelAt(source, lineIndex, text) {
        const lines = source.split(/\r?\n/);
        const line = lines[lineIndex];
        if (line === undefined) {
            return source;
        }

        const m = line.match(buildEdgeLineRegex());
        if (!m) {
            return source;
        }

        const [, indent, from, op, to, rest] = m;
        const safe = text.replace(/\|/g, "").trim();
        const labelPart = safe ? `|${safe}|` : "";
        lines[lineIndex] = `${indent}${from} ${op}${labelPart} ${to}${rest}`;
        return lines.join("\n");
    }

    function deleteNode(source, id) {
        const esc = escapeRegExp(id);
        const token = new RegExp(`(^|[^\\w-])${esc}(?=[^\\w-]|$)`);
        const out = [];

        source.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();

            if (/^class\s+/.test(trimmed)) {
                const m = trimmed.match(/^class\s+([^\s;]+)\s+([^\s;]+);?\s*$/);
                if (m) {
                    const ids = m[1].split(",").map(s => s.trim()).filter(s => s && s !== id);
                    if (ids.length > 0) {
                        out.push(`class ${ids.join(",")} ${m[2]};`);
                    }
                    return;
                }
            }

            if (/^style\s+/.test(trimmed)) {
                const m = trimmed.match(/^style\s+([^\s]+)\b/);
                if (m && m[1] === id) {
                    return;
                }
            }

            if (/^classDef\b/.test(trimmed)) {
                out.push(line);
                return;
            }

            if (token.test(line)) {
                return; // edge or node definition referencing this node
            }

            out.push(line);
        });

        return out.join("\n");
    }

    function getNodeLabel(source, id) {
        const esc = escapeRegExp(id);
        const rx = new RegExp(`(^|[^\\w-])${esc}(${NODE_OPEN_RE})([^\\]\\}\\)\\n]*?)(${NODE_CLOSE_RE})`);
        const m = source.match(rx);
        if (!m) {
            return "";
        }
        let inner = m[3].trim();
        if (inner.startsWith("\"") && inner.endsWith("\"")) {
            inner = inner.slice(1, -1).replace(/&quot;/g, "\"");
        }
        return inner.replace(/<br\s*\/?>/gi, " ");
    }

    function setNodeLabel(source, id, text) {
        const esc = escapeRegExp(id);
        const safe = formatLabel(text);
        const rx = new RegExp(`(^|[^\\w-])(${esc})(${NODE_OPEN_RE})([^\\]\\}\\)\\n]*?)(${NODE_CLOSE_RE})`);

        if (rx.test(source)) {
            return source.replace(rx, (full, pre, nid, open, _old, close) => `${pre}${nid}${open}${safe}${close}`);
        }

        const lines = source.split(/\r?\n/);
        let idx = lines.findIndex(l => /^\s*(classDef|class|style|linkStyle)\b/.test(l));
        if (idx < 0) {
            idx = lines.length;
        }
        lines.splice(idx, 0, `${id}[${safe}]`);
        return lines.join("\n");
    }

    function formatLabel(text) {
        const t = text.replace(/\s+/g, " ").trim();
        if (/["'\[\]{}()|<>#]/.test(t)) {
            return "\"" + t.replace(/"/g, "&quot;") + "\"";
        }
        return t;
    }

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // ----- Source highlight overlay -----
    // Finds every id the current source defines/uses: node shape definitions (via the
    // same NODE_OPEN_RE used for labels) plus bare edge endpoints (e.g. the "B" in
    // "A --> B" before it's ever given its own shape).
    function extractNodeIds(source) {
        const ids = new Set();
        const nodeRx = new RegExp(`(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_-]*)(?:${NODE_OPEN_RE})`, "g");

        source.split(/\r?\n/).forEach(line => {
            let m;
            while ((m = nodeRx.exec(line)) !== null) {
                ids.add(m[2]);
            }
        });

        parseEdges(source).forEach(e => {
            ids.add(e.from);
            ids.add(e.to);
        });

        return ids;
    }

    function escapeHtml(text) {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    let sourceHighlightScrollBound = false;

    // Rebuilds the #mermaidSourceHighlight overlay so every known node id is wrapped in
    // its .var-color-N span, matching the color used for that id's badge in the preview.
    // Called on every render (i.e. every keystroke), so it always mirrors the textarea.
    function updateSourceHighlight(source) {
        const pre = document.getElementById("mermaidSourceHighlight");
        const textarea = document.getElementById("mermaidSourceInput");
        if (!pre) {
            return;
        }

        if (textarea && !sourceHighlightScrollBound) {
            textarea.addEventListener("scroll", () => {
                pre.scrollTop = textarea.scrollTop;
                pre.scrollLeft = textarea.scrollLeft;
            });
            sourceHighlightScrollBound = true;
        }

        const ids = extractNodeIds(source);
        const escaped = escapeHtml(source);

        if (ids.size === 0) {
            // A trailing newline keeps the overlay's last line height identical to the
            // textarea's when the source itself ends with one.
            pre.innerHTML = escaped + "\n";
            return;
        }

        const idPattern = Array.from(ids)
            .sort((a, b) => b.length - a.length)
            .map(escapeRegExp)
            .join("|");
        const rx = new RegExp(`(^|[^A-Za-z0-9_-])(${idPattern})(?=[^A-Za-z0-9_-]|$)`, "g");

        pre.innerHTML = escaped.replace(rx, (match, boundary, id) =>
            `${boundary}<span class="${varColorClass(id)}">${id}</span>`) + "\n";
    }

    // Adds node IDs to visible labels for common Mermaid flowchart syntax.
    // Original text in the editor is never changed; only the preview input is transformed.
    function addNodeIdsToLabels(source) {
        const lines = source.split(/\r?\n/);

        return lines.map(line => {
            const trimmed = line.trim();

            // Skip comments, directives, classes, styles, subgraphs, and non-node config lines.
            if (
                trimmed.startsWith("%%") ||
                trimmed.startsWith("---") ||
                /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart)\b/.test(trimmed) ||
                /^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/.test(trimmed)
            ) {
                return line;
            }

            // Matches node labels after an optional connector, including all shapes offered
            // in the create-node modal (rectangle, rounded, stadium, subroutine, database,
            // circle, double-circle, decision, hexagon, parallelogram, trapezoid, flag).
            return line.replace(new RegExp(`(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_-]*)(${NODE_OPEN_RE})([^\\]\\}\\)\\n]*?)(${NODE_CLOSE_RE})`, "g"),
                (match, prefix, id, open, label, close) => {
                    const cleanLabel = label.trim();
                    const hasQuotedLabel = cleanLabel.includes('"') || cleanLabel.includes("'");
                    if (!cleanLabel || hasQuotedLabel || cleanLabel.startsWith(id + ":") || cleanLabel.includes(`${id}<br/>`)) {
                        return match;
                    }
                    // Bold + monospace + a per-id color (no quoted attributes, so it can't
                    // confuse Mermaid's own text parsing) makes the id prefix visually pop
                    // out from the label, in the same color used for this id in the source.
                    return `${prefix}${id}${open}<code class=${varColorClass(id)}>${id}:</code> ${label}${close}`;
                });
        }).join("\n");
    }

    // Smallest width (px) the source panel may shrink to while dragging the divider.
    const MIN_PANEL_PX = 320;
    // The preview panel keeps at least twice that width so the diagram stays usable.
    const MIN_PREVIEW_PX = MIN_PANEL_PX * 2.5;
    let resizerBound = false;

    // Wires up the draggable divider between the source and preview panels. Dragging
    // sets --source-width on .grid so the two panels resize inversely. Clamped so
    // neither panel shrinks below MIN_PANEL_PX.
    function initResizer() {
        bindViewportResize();
        updateViewportLayout();

        if (resizerBound) return;
        const resizer = document.getElementById("gridResizer");
        const grid = resizer ? resizer.closest(".grid") : null;
        if (!resizer || !grid) return;
        resizerBound = true;

        let dragging = false;

        const onMove = (e) => {
            if (!dragging) return;
            const rect = grid.getBoundingClientRect();
            const styles = getComputedStyle(grid);
            const gap = parseFloat(styles.columnGap) || 0;
            const resizerWidth = resizer.offsetWidth;
            // Total width available for the two panels (excludes the resizer and both gaps).
            const usable = rect.width - resizerWidth - gap * 2;
            let left = e.clientX - rect.left - resizerWidth / 2 - gap;
            const max = usable - MIN_PREVIEW_PX;
            if (left < MIN_PANEL_PX) left = MIN_PANEL_PX;
            if (left > max) left = max;
            grid.style.setProperty("--source-width", left + "px");
            e.preventDefault();
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            resizer.classList.remove("dragging");
            document.body.classList.remove("grid-resizing");
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };

        resizer.addEventListener("pointerdown", (e) => {
            dragging = true;
            resizer.classList.add("dragging");
            document.body.classList.add("grid-resizing");
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            e.preventDefault();
        });
    }

    // ----- Undo / redo keyboard shortcuts -----
    // Bridges Ctrl+Z / Ctrl+Y (and the Cmd equivalents on macOS) to the Blazor
    // component's undo/redo history. Typing in unrelated fields (the legend or console
    // textareas) keeps native browser undo; only the main source editor and non-field
    // focus are routed to the diagram history.
    let undoRedoRef = null;

    function onUndoRedoKey(e) {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || !undoRedoRef) return;

        const key = (e.key || "").toLowerCase();
        if (key !== "z" && key !== "y") return;

        const target = e.target;
        const isOtherField = target &&
            (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
            target.id !== "mermaidSourceInput";
        if (isOtherField) return;

        const isRedo = key === "y" || (key === "z" && e.shiftKey);
        e.preventDefault();
        undoRedoRef.invokeMethodAsync(isRedo ? "RedoFromJs" : "UndoFromJs");
    }

    function registerUndoRedo(dotNetRef) {
        undoRedoRef = dotNetRef;
        document.removeEventListener("keydown", onUndoRedoKey, true);
        document.addEventListener("keydown", onUndoRedoKey, true);
    }

    function unregisterUndoRedo() {
        document.removeEventListener("keydown", onUndoRedoKey, true);
        undoRedoRef = null;
    }

    return { render, zoomIn, zoomOut, resetZoom, clearErrors, copyConsoleOutput, setControlsVisible, toggleControls, setColorsVisible, setTheme, copyToClipboard, setMode, toggleFullscreen, initResizer, updateViewportLayout, registerUndoRedo, unregisterUndoRedo };
})();
