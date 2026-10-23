const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "Libraries",
    "BortronxMermaidEditor", "wwwroot", "js", "mermaidEditor.js"), "utf8");
const context = { window: {}, document: { addEventListener() {} } };
vm.runInNewContext(script.replace("return { render,",
    "return { deleteNode, removeEdge, removeSubgraph, render,"), context);
const editor = context.window.mermaidVariableEditor;

test("deleting a styled edge removes its style and reindexes surviving styles", () => {
    const source = "flowchart TD\nA --> B\nB --> C\nC --> D\nlinkStyle 0 stroke:red\nlinkStyle 1,2 stroke:blue\nlinkStyle default stroke-width:2px";
    const result = editor.removeEdge(source, "A", "B");
    assert.equal(result, "flowchart TD\nB --> C\nC --> D\nlinkStyle 0,1 stroke:blue\nlinkStyle default stroke-width:2px");
});

test("deleting a node removes its node and incident edge styles", () => {
    const source = "flowchart TD\nA --> B\nB --> C\nC --> D\nstyle B fill:red\nstyle C fill:blue\nclass B,C highlighted\nlinkStyle 0,1 stroke:red\nlinkStyle 2 stroke:blue";
    const result = editor.deleteNode(source, "B");
    assert.equal(result, "flowchart TD\nC --> D\nstyle C fill:blue\nclass C highlighted;\nlinkStyle 0 stroke:blue");
});

test("ungrouping removes only the subgraph style and class membership", () => {
    const source = "flowchart TD\nsubgraph Group[Group]\n    A --> B\nend\nstyle Group fill:red\nstyle A fill:blue\nclass Group,A highlighted\nlinkStyle 0 stroke:green";
    const result = editor.removeSubgraph(source, "Group");
    assert.equal(result, "flowchart TD\nA --> B\nstyle A fill:blue\nclass A highlighted\nlinkStyle 0 stroke:green");
});
