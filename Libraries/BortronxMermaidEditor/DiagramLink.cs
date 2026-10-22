using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace BortronxMermaidEditor;

public sealed record SharedDiagram(string Source, bool DataFlow);

public static class DiagramLink
{
    public const int MaxSourceBytes = 1024 * 1024;
    private const string Prefix = "#diagram=";
    private static readonly UTF8Encoding Utf8 = new(false, true);

    public static string Encode(string source, bool dataFlow = false)
    {
        var bytes = Utf8.GetBytes(source);
        if (bytes.Length > MaxSourceBytes)
            throw new FormatException("The diagram is too large to share (maximum 1 MiB of source).");

        using var output = new MemoryStream();
        using (var compressor = new ZLibStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
            compressor.Write(bytes);

        var compressed = output.ToArray();
        var useCompression = compressed.Length < bytes.Length;
        var payload = Convert.ToBase64String(useCompression ? compressed : bytes)
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return $"{Prefix}{(useCompression ? "z1" : "u1")}{(dataFlow ? "d" : "s")}.{payload}";
    }

    public static SharedDiagram? Decode(string fragment)
    {
        if (!fragment.StartsWith(Prefix, StringComparison.Ordinal))
            return null;

        var value = fragment[Prefix.Length..];
        if (value.Length < 4 || value.Length > MaxSourceBytes * 4 / 3 + 8 ||
            (value[..2] != "z1" && value[..2] != "u1") ||
            (value[2] != 's' && value[2] != 'd') || value[3] != '.' ||
            value[4..].Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-' && c != '_'))
            throw new FormatException("The diagram link is invalid or uses an unsupported version.");

        try
        {
            var payload = value[4..].Replace('-', '+').Replace('_', '/');
            var bytes = Convert.FromBase64String(payload.PadRight((payload.Length + 3) / 4 * 4, '='));
            if (value.StartsWith("z1", StringComparison.Ordinal))
            {
                if (bytes.Length < 6)
                    throw new FormatException("The diagram link contains incomplete compressed data.");
                var expectedChecksum = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(bytes.Length - 4));
                using var input = new MemoryStream(bytes);
                using var decompressor = new ZLibStream(input, CompressionMode.Decompress);
                using var output = new MemoryStream();
                var buffer = new byte[8192];
                int count;
                while ((count = decompressor.Read(buffer)) > 0)
                {
                    if (output.Length + count > MaxSourceBytes)
                        throw new FormatException("The diagram link exceeds the 1 MiB source limit.");
                    output.Write(buffer, 0, count);
                }
                bytes = output.ToArray();
                // ZLibStream can accept a truncated stream without its checksum trailer.
                uint a = 1, b = 0;
                foreach (var item in bytes)
                {
                    a = (a + item) % 65521;
                    b = (b + a) % 65521;
                }
                if ((b << 16 | a) != expectedChecksum)
                    throw new FormatException("The diagram link contains damaged or incomplete diagram data.");
            }

            if (bytes.Length > MaxSourceBytes)
                throw new FormatException("The diagram link exceeds the 1 MiB source limit.");
            return new SharedDiagram(Utf8.GetString(bytes), value[2] == 'd');
        }
        catch (Exception ex) when (ex is InvalidDataException or DecoderFallbackException)
        {
            throw new FormatException("The diagram link contains damaged diagram data.", ex);
        }
    }
}
