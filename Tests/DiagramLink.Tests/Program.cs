using System.IO.Compression;
using BortronxMermaidEditor;

var examples = new[]
{
    "",
    "flowchart TD\n    Admin[\"Authorized administrator\"]",
    "\r\nflowchart TD\r\n    A[\"spaces & # % / + ? =\"] --> B\r\n",
    "flowchart LR\n    A[\"caf\u00e9 \u4e16\u754c \ud83d\ude80\"]\n",
    string.Join("\n", Enumerable.Range(0, 200).Select(i => $"    A{i}[\"Repeated administrator label\"] --> A{i + 1}"))
};

foreach (var source in examples)
foreach (var dataFlow in new[] { false, true })
{
    var encoded = DiagramLink.Encode(source, dataFlow);
    var decoded = DiagramLink.Decode(encoded);
    Check(decoded == new SharedDiagram(source, dataFlow), "Exact source and mode round trip");
    Check(!encoded.Contains('+') && !encoded.Contains('/') && !encoded[9..].Contains('='), "URL-safe payload");
    Check(new Uri("https://example.org/editor/" + encoded).Fragment == encoded, "Fragment survives URL parsing");
}

Check(DiagramLink.Encode("").StartsWith("#diagram=u1s."), "Tiny inputs avoid compression overhead");
var large = DiagramLink.Encode(examples[^1]);
Check(large.StartsWith("#diagram=z1s."), "Repeated source uses zlib");
Check(large.Length < Uri.EscapeDataString(examples[^1]).Length / 4, "Repeated source shrinks by at least 75%");
Reject(() => DiagramLink.Decode(large[..^6]), "Truncated compressed links are rejected");
Check(DiagramLink.Decode("#unrelated") is null, "Unrelated fragments are ignored");

foreach (var invalid in new[] { "#diagram=", "#diagram=z2s.AAAA", "#diagram=u1x.AAAA", "#diagram=u1s.*", "#diagram=u1s.A", "#diagram=u1s._w", "#diagram=z1s.____" })
    Reject(() => DiagramLink.Decode(invalid), "Invalid links are rejected");

Reject(() => DiagramLink.Encode(new string('a', DiagramLink.MaxSourceBytes + 1)), "Oversize source rejected");
Reject(() => DiagramLink.Encode(new string('\u4e16', DiagramLink.MaxSourceBytes / 3 + 1)), "Source limit measures UTF-8 bytes");
var atLimit = new string('a', DiagramLink.MaxSourceBytes);
Check(DiagramLink.Decode(DiagramLink.Encode(atLimit))?.Source == atLimit, "Exact source-size limit accepted");
using var output = new MemoryStream();
using (var compressor = new ZLibStream(output, CompressionLevel.SmallestSize, true))
    compressor.Write(new byte[DiagramLink.MaxSourceBytes + 1]);
var bomb = "#diagram=z1s." + Convert.ToBase64String(output.ToArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_');
Reject(() => DiagramLink.Decode(bomb), "Decompressed source limit enforced");
Console.WriteLine($"All diagram-link checks passed. Repeated sample: {examples[^1].Length} source characters -> {large.Length} fragment characters.");

static void Check(bool condition, string message)
{
    if (!condition)
        throw new Exception(message);
}

static void Reject(Action action, string message)
{
    try { action(); }
    catch (FormatException) { return; }
    throw new Exception(message);
}
