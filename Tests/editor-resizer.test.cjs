const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "Libraries",
    "BortronxMermaidEditor", "wwwroot", "js", "mermaidEditor.js"), "utf8");
const context = { window: {}, document: { addEventListener() {} } };
vm.runInNewContext(script.replace("return { render,",
    "return { clampSourceWidth, render,"), context);
const { clampSourceWidth } = context.window.mermaidVariableEditor;

test("narrow portrait layouts retain a usable divider drag range", () => {
    for (const usable of [860, 950, 1034, 1100, 1200]) {
        const min = clampSourceWidth(0, usable);
        const max = clampSourceWidth(usable, usable);
        assert.ok(min > 0);
        assert.ok(max < usable);
        assert.ok(max - min >= usable * 0.14);
        assert.equal(clampSourceWidth((min + max) / 2, usable), (min + max) / 2);
    }
});

test("wide layouts preserve the existing preferred minimum widths", () => {
    assert.equal(clampSourceWidth(0, 1800), 320);
    assert.equal(clampSourceWidth(1800, 1800), 1000);
    assert.equal(clampSourceWidth(750, 1800), 750);
});
