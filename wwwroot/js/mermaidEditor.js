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

    function init() {
        if (!initialized) {
            mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });
            initialized = true;
        }
    }

    async function render(source, showIds) {
        init();
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
            applyTransform();
        } catch (err) {
            target.innerHTML = "";
            showPreviewError(err?.message || String(err));
            appendConsoleError(source, err);
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

    return { render, zoomIn, zoomOut, resetZoom, clearErrors };
})();
