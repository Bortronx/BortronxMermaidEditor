const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("every diagram error notifies the component and Clear resets the log", async () => {
    const script = fs.readFileSync(path.join(__dirname, "..", "Libraries",
        "BortronxMermaidEditor", "wwwroot", "js", "mermaidEditor.js"), "utf8");
    const consoleBox = { value: "", scrollHeight: 200, scrollTop: 0 };
    const context = {
        window: {},
        document: {
            addEventListener() {},
            removeEventListener() {},
            getElementById: id => id === "errorConsole" ? consoleBox : null
        }
    };
    vm.runInNewContext(script.replace("return { render,",
        "return { appendConsoleError, render,"), context);
    const editor = context.window.mermaidVariableEditor;
    const notifications = [];
    editor.registerUndoRedo({
        async invokeMethodAsync(method) { notifications.push(method); }
    });

    await editor.appendConsoleError("invalid diagram", new Error("Syntax error"));
    assert.match(consoleBox.value, /Syntax error/);
    assert.match(consoleBox.value, /Last attempted source:\ninvalid diagram/);
    assert.equal(consoleBox.scrollTop, 200);
    await editor.appendConsoleError("another invalid diagram", new Error("Another error"));
    assert.deepEqual(notifications, ["NotifyDiagramError", "NotifyDiagramError"]);

    editor.clearErrors();
    assert.equal(consoleBox.value, "");
    await editor.appendConsoleError("new invalid diagram", new Error("New error"));
    assert.doesNotMatch(consoleBox.value, /Syntax error|Another error/);
    assert.match(consoleBox.value, /New error/);
    assert.equal(notifications.length, 3);
});
