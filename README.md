# Bortronx Mermaid Editor

![Bortronx Mermaid Editor social preview](src/wwwroot/social-preview.png)

Bortronx Mermaid Editor is a Blazor-based Mermaid diagram editor with a live preview pane and a focused workflow for building standard Mermaid diagrams or data flow diagrams.

The repository contains:

- `Libraries/BortronxMermaidEditor`: a reusable Razor Class Library component.
- `src`: a Blazor WebAssembly app that hosts the editor.
- `Firebase/public`: the published static output, including the generated social preview image.

## Features

- Live Mermaid source editing with immediate preview updates.
- Standard mode and Data Flow Diagram mode.
- Data flow helpers for entities, processes, data stores, flows, and legend management.
- Interactive preview controls including zoom, fullscreen, and diagram editing helpers.
- Undo and redo support.
- Light and dark theme toggle.
- Error console for Mermaid parsing issues.

## Run locally

```bash
dotnet run --project src/BlazorMermaidEditor.csproj
```

## Use the component

Add a project or package reference to `BortronxMermaidEditor`, then render the component in a Razor page:

```razor
<MermaidEditor />
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).