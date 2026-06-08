// Self-loading bootstrap for the Bortronx Mermaid editor.
// Ensures the editor stylesheet, the Mermaid library (from CDN) and the editor
// script are present in the host page before the Blazor component uses them.
// This lets the component be dropped into any Blazor app without editing index.html.

const CSS_HREF = "_content/BortronxMermaidEditor/css/mermaidEditor.css";
const EDITOR_JS = "_content/BortronxMermaidEditor/js/mermaidEditor.js";
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

let readyPromise = null;

function injectCss(href) {
    if (document.querySelector(`link[data-mermaid-editor="${href}"]`)) {
        return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-mermaid-editor", href);
    document.head.appendChild(link);
}

function loadScript(src, isReady) {
    return new Promise((resolve, reject) => {
        if (isReady()) {
            resolve();
            return;
        }

        // Reuse an existing tag for this src if one is already loading.
        let script = document.querySelector(`script[data-mermaid-editor="${src}"]`);
        if (script) {
            script.addEventListener("load", () => resolve());
            script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
            if (isReady()) {
                resolve();
            }
            return;
        }

        script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.setAttribute("data-mermaid-editor", src);
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
        document.head.appendChild(script);
    });
}

// Resolves once the editor's CSS, Mermaid, and the editor script are all available.
export function ensureLoaded() {
    if (readyPromise) {
        return readyPromise;
    }

    readyPromise = (async () => {
        injectCss(CSS_HREF);
        await loadScript(MERMAID_CDN, () => typeof window.mermaid !== "undefined");
        await loadScript(EDITOR_JS, () => typeof window.mermaidVariableEditor !== "undefined");
    })();

    return readyPromise;
}
