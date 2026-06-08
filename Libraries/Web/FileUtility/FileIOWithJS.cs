using Microsoft.JSInterop;
using System;
using System.Threading.Tasks;

namespace FileUtility
{
    public static class FileIOWithJS
    {
        public static ValueTask<object> SaveAs(this IJSRuntime js, string filename, byte[] data)
        => js.InvokeAsync<object>(
            "saveAsFile",
            filename,
            Convert.ToBase64String(data));
    }
}
