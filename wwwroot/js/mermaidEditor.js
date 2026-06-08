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
    let controlsVisible = true;
    let currentTheme = "default";
    let currentMode = "standard"; // "standard" | "dataflow"
    const connect = { active: false, fromId: "", x: 0, y: 0, startX: 0, startY: 0 };

    // Node types offered when dropping a connection into empty space. The "dataflow"
    // set is shown in Data Flow Diagram mode; "standard" is shown otherwise.
    const NODE_TYPES = {
        standard: [
            { label: "Rectangle", prefix: "n", open: "[\"", close: "\"]" },
            { label: "Rounded", prefix: "n", open: "(\"", close: "\")" },
            { label: "Stadium", prefix: "n", open: "([\"", close: "\"])" },
            { label: "Subroutine", prefix: "n", open: "[[\"", close: "\"]]" },
            { label: "Database", prefix: "n", open: "[(\"", close: "\")]" },
            { label: "Circle", prefix: "n", open: "((\"", close: "\"))" },
            { label: "Decision", prefix: "n", open: "{\"", close: "\"}" }
        ],
        dataflow: [
            { label: "Entity", prefix: "e", open: "[\"", close: "\"]" },
            { label: "Process", prefix: "p", open: "[[\"", close: "\"]]" },
            { label: "Data Store", prefix: "d", open: "[(\"", close: "\")]" }
        ]
    };

    let activeNodeModal = null;

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
        viewState.scale = 1;
        viewState.x = 0;
        viewState.y = 0;
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
        }

        return controlsVisible;
    }

    function toggleControls() {
        return setControlsVisible(!controlsVisible);
    }

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
        edges.forEach(edge => {
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
            layer.appendChild(el);
            edgeButtons.push({ from: edge.from, to: edge.to, el });
        });

        positionInteraction();
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

        edgeButtons.forEach(b => {
            const gf = map.get(b.from);
            const gt = map.get(b.to);
            if (!gf || !gt) {
                b.el.style.display = "none";
                return;
            }
            const c1 = centerOf(gf, vr);
            const c2 = centerOf(gt, vr);
            b.el.style.display = "block";
            b.el.style.left = `${(c1.x + c2.x) / 2}px`;
            b.el.style.top = `${(c1.y + c2.y) / 2}px`;
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
            b.textContent = t.label;
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
        document.body.appendChild(backdrop);
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
        source.split(/\r?\n/).forEach(line => {
            const edge = parseEdgeLine(line);
            if (edge) {
                edges.push(edge);
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
        after = after.replace(/^\s*\|[^|]*\|/, "").replace(/^\s*/, "");
        const to = after.match(/^([A-Za-z_][\w-]*)/);
        if (!to) {
            return null;
        }

        return { from: from[1], to: to[1] };
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
        const rx = new RegExp(`(^|[^\\w-])${esc}(\\[\\[|\\[\\(|\\{\\{|\\[\\/|\\[|\\(|\\{)([^\\]\\}\\)\\n]*?)(\\]\\]|\\)\\]|\\}\\}|\\/\\]|\\]|\\)|\\})`);
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
        const rx = new RegExp(`(^|[^\\w-])(${esc})(\\[\\[|\\[\\(|\\{\\{|\\[\\/|\\[|\\(|\\{)([^\\]\\}\\)\\n]*?)(\\]\\]|\\)\\]|\\}\\}|\\/\\]|\\]|\\)|\\})`);

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

            // Matches node labels after an optional connector, including:
            // A[Label], A(Label), A{Label}, A[[Label]], A[(Label)], A{{Label}}, A[/Label/]
            return line.replace(/(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_-]*)(\[\[|\[\(|\{\{|\[\/|\[|\(|\{)([^\]\}\)\n]*?)(\]\]|\)\]|\}\}|\/\]|\]|\)|\})/g,
                (match, prefix, id, open, label, close) => {
                    const cleanLabel = label.trim();
                    const hasQuotedLabel = cleanLabel.includes('"') || cleanLabel.includes("'");
                    if (!cleanLabel || hasQuotedLabel || cleanLabel.startsWith(id + ":") || cleanLabel.includes(`${id}<br/>`)) {
                        return match;
                    }
                    return `${prefix}${id}${open}${id}: ${label}${close}`;
                });
        }).join("\n");
    }

    return { render, zoomIn, zoomOut, resetZoom, clearErrors, setControlsVisible, toggleControls, setTheme, copyToClipboard, setMode };
})();
