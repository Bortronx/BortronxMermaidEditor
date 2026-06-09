using System.Runtime.InteropServices;
using Photino.NET;

namespace BortronxMermaidEditor.Desktop;

// Offline desktop wrapper for the Bortronx Mermaid Editor.
//
// It hosts the EXACT published Blazor WebAssembly output (bundled under wwwroot/) inside a
// single native window. Files are served from disk through a custom scheme handler, so the
// app runs fully offline with no web server and no live URL.
internal static class Program
{
    // Root of the bundled, published web app (copied next to the executable at build time).
    private static readonly string WebRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");

    // On Windows, WebView2 refuses top-level navigation to a custom scheme but CAN intercept
    // http:// requests, so we serve over http://localhost/. On Linux/macOS the system webview
    // cannot intercept http://, so a custom "app" scheme is required. This mirrors how
    // Photino.Blazor selects its scheme per platform.
    private static readonly bool IsWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
    private static readonly string Scheme = IsWindows ? "http" : "app";
    private static readonly string StartUrl = $"{Scheme}://localhost/";

    // Diagnostic log next to the executable; enabled when BMED_DEBUG is set.
    private static readonly bool DebugLog =
        Environment.GetEnvironmentVariable("BMED_DEBUG") is not null;
    private static readonly string LogPath = Path.Combine(AppContext.BaseDirectory, "bmed-debug.log");

    private static void Log(string message)
    {
        if (!DebugLog)
        {
            return;
        }

        try
        {
            File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff}  {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never affect the app.
        }
    }

    [STAThread]
    private static void Main(string[] args)
    {
        var window = new PhotinoWindow()
            .SetTitle("Bortronx Mermaid Editor")
            .SetUseOsDefaultSize(false)
            .SetSize(1400, 900)
            .Center()
            .SetResizable(true)
            // Serve the published app from disk. The handler is registered before Load().
            .RegisterCustomSchemeHandler(Scheme, ServeAppFile)
            .Load(new Uri(StartUrl));

        TrySetIcon(window);

        window.WaitForClose();
    }

    // Resolves an "app://" request to a file inside the bundled wwwroot.
    //
    // The document loads as app://index.html, so the webview keeps "index.html" as the URI
    // host and every sub-resource (e.g. /_framework/blazor.webassembly.js) arrives as the
    // URI's absolute path. We map that path onto the wwwroot folder. Requests for the root,
    // or for unknown extensionless paths (SPA client-side routes), fall back to index.html.
    private static Stream ServeAppFile(object sender, string scheme, string url, out string contentType)
    {
        string relativePath;
        try
        {
            relativePath = new Uri(url).AbsolutePath.TrimStart('/');
        }
        catch (UriFormatException)
        {
            relativePath = string.Empty;
        }

        // Drop any query string (e.g. "_framework/blazor.boot.json?v=...").
        var queryIndex = relativePath.IndexOf('?');
        if (queryIndex >= 0)
        {
            relativePath = relativePath[..queryIndex];
        }

        if (string.IsNullOrEmpty(relativePath))
        {
            relativePath = "index.html";
        }

        var fullPath = Path.GetFullPath(Path.Combine(WebRoot, relativePath));

        // Guard against path traversal escaping the web root.
        var rootPrefix = WebRoot.EndsWith(Path.DirectorySeparatorChar)
            ? WebRoot
            : WebRoot + Path.DirectorySeparatorChar;

        if (!fullPath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
        {
            // SPA fallback: extensionless routes are handled by the client router.
            if (!Path.HasExtension(relativePath))
            {
                fullPath = Path.Combine(WebRoot, "index.html");
            }
        }

        if (!File.Exists(fullPath))
        {
            Log($"MISS  scheme={scheme}  url={url}  -> {fullPath}");
            contentType = "text/plain";
            return new MemoryStream(System.Text.Encoding.UTF8.GetBytes("404 Not Found"));
        }

        contentType = GetContentType(fullPath);
        Log($"OK    url={url}  -> {relativePath}  ({contentType})");
        return File.OpenRead(fullPath);
    }

    private static string GetContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" or ".htm" => "text/html",
        ".js" or ".mjs" => "text/javascript",
        ".css" => "text/css",
        ".wasm" => "application/wasm",
        ".json" => "application/json",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        ".webp" => "image/webp",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".eot" => "application/vnd.ms-fontobject",
        ".txt" => "text/plain",
        ".xml" => "application/xml",
        ".map" => "application/json",
        ".dll" => "application/octet-stream",
        ".dat" or ".blat" => "application/octet-stream",
        _ => "application/octet-stream",
    };

    // Sets the window icon when a platform-appropriate icon ships alongside the executable.
    // Wrapped in a try/catch so a missing or unsupported icon never prevents launch.
    private static void TrySetIcon(PhotinoWindow window)
    {
        try
        {
            var iconName = OperatingSystem.IsWindows() ? "app.ico" : "app.png";
            var iconPath = Path.Combine(AppContext.BaseDirectory, iconName);
            if (File.Exists(iconPath))
            {
                window.SetIconFile(iconPath);
            }
        }
        catch
        {
            // Icon is cosmetic; ignore any failure.
        }
    }
}
